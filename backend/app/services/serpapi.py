"""The SerpApi layer (section 6).

Every SerpApi call in this application goes through this module. There are no direct
httpx calls to serpapi.com anywhere else.

Free tier: 250 searches/month, 50/hour. That is the tightest constraint in the system,
so the order of operations in `search()` matters — cache before bucket, bucket before
budget, budget before network.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import random
import time
from datetime import timedelta
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from ..config import settings
from ..models import SearchBudget, SerpCache
from ..security import as_utc, utcnow

log = logging.getLogger("ceasefire.serpapi")

SERPAPI_URL = "https://serpapi.com/search.json"

MAX_ATTEMPTS = 4  # on 429 / 5xx
BASE_BACKOFF_SECONDS = 1.0


class BudgetExhausted(Exception):
    """The monthly search budget is spent. The scan ends in state 'error'."""


class SerpApiError(Exception):
    """SerpApi refused or failed the request."""


# The ten engines, copied verbatim from Frontend/lib/types.ts ENGINES so the UI text
# matches exactly. Order is the fixed UI order and is persisted as scan_engines.position.
ENGINES: list[dict[str, Any]] = [
    {
        "id": "google",
        "label": "Google Search",
        "purpose": "Verifies each generated permutation is indexed and live",
        "headline": False,
    },
    {
        "id": "google_ai_overview",
        "label": "AI Overview",
        "purpose": "Whether Google's own AI cites an impersonator as a source for the brand",
        "headline": True,
    },
    {
        "id": "google_ai_mode",
        "label": "AI Mode",
        "purpose": "Same check in the conversational surface, across multiple turns",
        "headline": True,
    },
    {
        "id": "google_play",
        "label": "Google Play",
        "purpose": "Fake Android apps using the brand name or logo",
        "headline": False,
    },
    {
        "id": "apple_app_store",
        "label": "App Store",
        "purpose": "The same impersonation on iOS",
        "headline": False,
    },
    {
        "id": "google_shopping",
        "label": "Shopping",
        "purpose": "Counterfeit listings with structured seller and price data",
        "headline": False,
    },
    {
        "id": "google_maps",
        "label": "Maps / Local",
        "purpose": "Fake business listings occupying the local pack",
        "headline": False,
    },
    {
        "id": "youtube",
        "label": "YouTube",
        "purpose": "Impersonation channels — the vector behind most brand-impersonation fraud",
        "headline": False,
    },
    {
        "id": "google_images",
        "label": "Images / Lens",
        "purpose": "Logo and brand-asset misuse, found by reverse image search",
        "headline": False,
    },
    {
        "id": "google_trends",
        "label": "Trends",
        "purpose": "Whether search demand for the lookalike is rising — an urgency signal",
        "headline": False,
    },
]

ENGINE_IDS = [e["id"] for e in ENGINES]


def params_hash(engine: str, params: dict[str, Any]) -> str:
    """sha256(engine + sorted params). The api_key is never part of the hash."""
    payload = engine + json.dumps(params, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class TokenBucket:
    """50 searches/hour with a burst of 10. Shared process-wide."""

    def __init__(self, rate_per_hour: int, burst: int) -> None:
        self.refill_rate = rate_per_hour / 3600.0  # tokens per second
        self.capacity = float(burst)
        self._tokens = float(burst)
        self._updated = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self) -> float:
        """Take one token, waiting if the bucket is empty. Returns seconds waited."""
        async with self._lock:
            waited = 0.0
            while True:
                now = time.monotonic()
                self._tokens = min(
                    self.capacity, self._tokens + (now - self._updated) * self.refill_rate
                )
                self._updated = now
                if self._tokens >= 1.0:
                    self._tokens -= 1.0
                    return waited
                sleep_for = (1.0 - self._tokens) / self.refill_rate
                waited += sleep_for
                log.info("token bucket empty, waiting %.1fs", sleep_for)
                await asyncio.sleep(sleep_for)


# One bucket for the whole process — the quota is per API key, not per request.
_bucket = TokenBucket(settings.serpapi_rate_per_hour, settings.serpapi_burst)


class SerpApiClient:
    """Cache-first, bucket-limited, budget-enforced SerpApi access."""

    REFILL_RATE = settings.serpapi_rate_per_hour / 3600.0
    BURST = settings.serpapi_burst

    def __init__(
        self,
        db: DbSession,
        bucket: TokenBucket | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.db = db
        self.bucket = bucket or _bucket
        # `transport` is a test seam only; production leaves it None.
        self.transport = transport

    # ── budget ─────────────────────────────────────────────────────────────

    def _budget_row(self, user_id: str) -> SearchBudget:
        period = utcnow().strftime("%Y-%m")
        row = self.db.execute(
            select(SearchBudget).where(
                SearchBudget.user_id == user_id, SearchBudget.period == period
            )
        ).scalar_one_or_none()
        if row is None:
            row = SearchBudget(user_id=user_id, period=period, spent=0, cache_hits=0)
            self.db.add(row)
            try:
                self.db.commit()
            except IntegrityError:  # concurrent sweep created it first
                self.db.rollback()
                row = self.db.execute(
                    select(SearchBudget).where(
                        SearchBudget.user_id == user_id, SearchBudget.period == period
                    )
                ).scalar_one()
        return row

    def budget(self, user_id: str) -> dict[str, int]:
        row = self._budget_row(user_id)
        return {
            "total": settings.search_budget_total,
            "spent": row.spent,
            "cacheHits": row.cache_hits,
        }

    # ── cache ──────────────────────────────────────────────────────────────

    def _cache_get(self, engine: str, digest: str) -> dict[str, Any] | None:
        row = self.db.execute(
            select(SerpCache).where(
                SerpCache.engine == engine, SerpCache.params_hash == digest
            )
        ).scalar_one_or_none()
        if row is None:
            return None
        fetched = as_utc(row.fetched_at)
        if fetched is None or fetched < utcnow() - timedelta(
            hours=settings.serp_cache_ttl_hours
        ):
            return None  # stale rows are ignored on read, not deleted
        row.hit_count += 1
        self.db.commit()
        return json.loads(row.response_json)

    def _cache_put(self, engine: str, digest: str, payload: dict[str, Any]) -> None:
        row = self.db.execute(
            select(SerpCache).where(
                SerpCache.engine == engine, SerpCache.params_hash == digest
            )
        ).scalar_one_or_none()
        if row is None:
            row = SerpCache(engine=engine, params_hash=digest)
            self.db.add(row)
        row.response_json = json.dumps(payload)
        row.fetched_at = utcnow()
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()

    # ── the one entry point ────────────────────────────────────────────────

    async def search(
        self,
        engine: str,
        params: dict[str, Any],
        user_id: str,
        no_cache: bool = False,
        markdown: bool = False,
    ) -> dict[str, Any]:
        """One metered SerpApi search.

        `no_cache=True` on threat-verification paths — a cached result there is a
        missed detection. Caching stays on for trend queries where staleness is
        harmless.

        `markdown=True` asks for output=md on engines that support it. The sweep
        leaves it off, because citations are read out of the structured JSON.
        """
        call_params = dict(params)
        if markdown:
            call_params["output"] = "md"
        digest = params_hash(engine, call_params)

        # 1-2. Cache first. A hit spends no search.
        if not no_cache:
            cached = self._cache_get(engine, digest)
            if cached is not None:
                row = self._budget_row(user_id)
                row.cache_hits += 1
                self.db.commit()
                log.info("serpapi cache hit engine=%s hash=%s", engine, digest[:12])
                return cached

        # 3. Token bucket.
        await self.bucket.acquire()

        # 4. Budget ceiling — checked before the call, so we never overspend.
        row = self._budget_row(user_id)
        if row.spent >= settings.search_budget_total:
            raise BudgetExhausted(
                f"Monthly search budget exhausted ({row.spent}/{settings.search_budget_total}). "
                "The sweep stopped rather than overspending."
            )

        if not settings.serpapi_key:
            raise SerpApiError("SERPAPI_KEY is not configured.")

        # 5-6. Call, with backoff on 429/5xx.
        payload = await self._call(engine, call_params)

        # 7. Persist and account.
        self._cache_put(engine, digest, payload)
        row = self._budget_row(user_id)
        row.spent += 1
        self.db.commit()
        if row.spent >= settings.search_budget_alert_at:
            log.warning(
                "search budget at %s/%s", row.spent, settings.search_budget_total
            )
        return payload

    async def _call(self, engine: str, call_params: dict[str, Any]) -> dict[str, Any]:
        query = {**call_params, "engine": engine, "api_key": settings.serpapi_key}
        last_error = ""

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(30.0), transport=self.transport
        ) as client:
            for attempt in range(1, MAX_ATTEMPTS + 1):
                try:
                    response = await client.get(SERPAPI_URL, params=query)
                except httpx.HTTPError as exc:
                    last_error = str(exc)
                    log.warning("serpapi transport error engine=%s: %s", engine, exc)
                    response = None

                if response is not None:
                    if response.status_code == 429 or response.status_code >= 500:
                        last_error = f"HTTP {response.status_code}"
                    elif response.status_code == 401:
                        raise SerpApiError("SerpApi rejected the API key (401).")
                    elif response.status_code >= 400:
                        raise SerpApiError(
                            f"SerpApi returned {response.status_code} for engine={engine}"
                        )
                    else:
                        payload = response.json()
                        if isinstance(payload, dict) and payload.get("error"):
                            raise SerpApiError(f"SerpApi error: {payload['error']}")
                        return payload

                if attempt == MAX_ATTEMPTS:
                    break
                # Exponential backoff with jitter.
                delay = BASE_BACKOFF_SECONDS * (2 ** (attempt - 1))
                delay += random.uniform(0, delay * 0.5)
                log.warning(
                    "serpapi retry %d/%d engine=%s in %.1fs (%s)",
                    attempt,
                    MAX_ATTEMPTS,
                    engine,
                    delay,
                    last_error,
                )
                await asyncio.sleep(delay)

        raise SerpApiError(
            f"SerpApi failed after {MAX_ATTEMPTS} attempts for engine={engine}: {last_error}"
        )

    # ── AI Overview: the differentiator ────────────────────────────────────

    async def google_with_ai_overview(self, query: str, user_id: str) -> dict[str, Any]:
        """Google, then the AI Overview behind its page_token.

        `ai_overview.page_token` expires in under 60 seconds, so it is fetched inline,
        immediately, per result. Never batch tokens for a later pass.
        """
        base = await self.search("google", {"q": query}, user_id, no_cache=True)
        token = (base.get("ai_overview") or {}).get("page_token")
        if token:
            # Must be immediate. Do not await anything else between these two lines.
            ao = await self.search(
                "google_ai_overview", {"page_token": token}, user_id, no_cache=True
            )
            base["ai_overview_full"] = ao
        return base


def ai_overview_references(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Pull the citation list out of an AI Overview response.

    SerpApi returns citations either inline on the google response (`ai_overview`)
    or on the page_token follow-up (`ai_overview_full`). Both shapes carry
    `references`; text blocks carry `reference_indexes` pointing into it.
    """
    for key in ("ai_overview_full", "ai_overview"):
        block = payload.get(key) or {}
        if key == "ai_overview_full":
            block = block.get("ai_overview") or block
        references = block.get("references")
        if references:
            return references
    return []
