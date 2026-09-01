"""The ten-engine sweep (section 7, stage 3). This is the ONLY place searches are spent.

Runs as a FastAPI BackgroundTask. A `scan_engines` row is written as each engine
completes, so the frontend polling `GET /scan/{id}` every 500ms sees live progress.

Search plan, and why it costs what it costs:

  google              1 search per prefilter survivor  — is this lookalike indexed?
  google_ai_overview  1-2 searches, brand-level         — the differentiator
  google_ai_mode      1 search, brand-level
  the other seven     1 search each, brand-level

So a sweep costs roughly (survivors + 9). DEMO_MAX_PERMUTATIONS caps the survivors,
which is what keeps a demo sweep inside the free tier.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterator
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from ..config import settings
from ..db import SessionLocal
from ..models import Activity, Evidence, Finding, PortfolioDomain, Scan, ScanEngine
from ..security import utcnow
from . import permutations, prefilter, scoring
from .prefilter import DnsUnavailable, PrefilterResult
from .serpapi import ENGINES, BudgetExhausted, SerpApiClient, SerpApiError

log = logging.getLogger("ceasefire.sweep")

# Engine states the frontend understands: idle | running | done | cached | error | skipped
STATE_IDLE = "idle"
STATE_DONE = "done"
STATE_CACHED = "cached"
STATE_ERROR = "error"
STATE_SKIPPED = "skipped"

AI_ENGINES = {"google_ai_overview", "google_ai_mode"}


@dataclass
class Hit:
    """One piece of evidence tying a suspect domain to a search surface."""

    domain: str
    engine: str
    url: str
    snippet: str


@dataclass
class EngineOutcome:
    engine_id: str
    state: str = STATE_IDLE
    hits: list[Hit] = field(default_factory=list)
    searches_spent: int = 0
    cache_hit: bool = False
    ms: int = 0
    error: str | None = None


# ── Reading results out of ten different response shapes ───────────────────


def _walk(node: Any) -> Iterator[dict]:
    """Every dict anywhere in a SerpApi payload."""
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from _walk(value)
    elif isinstance(node, list):
        for item in node:
            yield from _walk(item)


def host_of(url: str) -> str:
    try:
        host = urlparse(url).hostname or ""
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def _candidate_domains(record: dict) -> list[str]:
    """Domains a single result record points at.

    Citation `link` values are often Google redirectors (google.com/goto?url=...),
    with the real domain only in `source`. Measured in Phase 2 — matching on `link`
    alone would miss every redirected citation.
    """
    found = []
    for key in ("source", "displayed_link", "domain", "website"):
        value = record.get(key)
        if isinstance(value, str) and value:
            found.append(host_of(value) if "://" in value else value.lower().strip())
    for key in ("link", "url", "product_link", "serpapi_link"):
        value = record.get(key)
        if isinstance(value, str) and value:
            host = host_of(value)
            if host and host not in ("www.google.com", "google.com", "serpapi.com"):
                found.append(host)
    return [d for d in found if d]


def _snippet_of(record: dict) -> str:
    for key in ("snippet", "title", "name", "description", "displayed_link"):
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return " ".join(value.split())[:400]
    return ""


def _url_of(record: dict, fallback_domain: str) -> str:
    for key in ("link", "url", "product_link"):
        value = record.get(key)
        if isinstance(value, str) and value.startswith("http"):
            return value
    return f"https://{fallback_domain}"


def extract_hits(payload: dict, engine_id: str, suspects: dict[str, str]) -> list[Hit]:
    """Find suspect domains anywhere in a payload. `suspects` maps ascii domain -> display."""
    hits: dict[str, Hit] = {}
    for record in _walk(payload):
        if not isinstance(record, dict):
            continue
        for domain in _candidate_domains(record):
            display = suspects.get(domain)
            if display is None:
                continue
            if display in hits:
                continue
            hits[display] = Hit(
                domain=display,
                engine=engine_id,
                url=_url_of(record, domain),
                snippet=_snippet_of(record) or f"Referenced on {engine_id}.",
            )
    return list(hits.values())


# ── The engines ────────────────────────────────────────────────────────────

# Brand-level engines: one search each, params per SerpApi's engine docs.
BRAND_ENGINE_PARAMS: dict[str, Any] = {
    "google_ai_mode": lambda brand, domain: {"q": brand},
    "google_play": lambda brand, domain: {"q": brand, "store": "apps"},
    "apple_app_store": lambda brand, domain: {"term": brand},
    "google_shopping": lambda brand, domain: {"q": brand},
    "google_maps": lambda brand, domain: {"q": brand, "type": "search"},
    "youtube": lambda brand, domain: {"search_query": brand},
    "google_images": lambda brand, domain: {"q": brand},
    "google_trends": lambda brand, domain: {"q": brand, "data_type": "TIMESERIES"},
}


async def _run_google(
    client: SerpApiClient, user_id: str, suspects: dict[str, str], survivors: list
) -> EngineOutcome:
    """One search per survivor: is this lookalike actually indexed?"""
    outcome = EngineOutcome("google")
    for result in survivors:
        ascii_domain = result.candidate.ascii_domain
        payload = await client.search("google", {"q": ascii_domain}, user_id)
        outcome.searches_spent += 1
        outcome.hits.extend(
            extract_hits(payload, "google", {ascii_domain: result.candidate.domain})
        )
    outcome.state = STATE_DONE
    return outcome


async def _run_ai_overview(
    client: SerpApiClient, user_id: str, brand: str, suspects: dict[str, str]
) -> EngineOutcome:
    """The differentiator: is an impersonator cited as a source for the brand?

    no_cache throughout — a cached citation is a missed detection.
    """
    outcome = EngineOutcome("google_ai_overview")
    before = client.budget(user_id)["spent"]
    payload = await client.google_with_ai_overview(brand, user_id)
    outcome.searches_spent = client.budget(user_id)["spent"] - before

    from .serpapi import ai_overview_references

    references = ai_overview_references(payload)
    for record in references:
        for domain in _candidate_domains(record):
            display = suspects.get(domain)
            if display and not any(h.domain == display for h in outcome.hits):
                outcome.hits.append(
                    Hit(
                        domain=display,
                        engine="google_ai_overview",
                        url=_url_of(record, domain),
                        snippet=_snippet_of(record)
                        or f'Cited as a source in the AI Overview for "{brand}".',
                    )
                )
    log.info(
        "ai_overview: %d citations, %d matched a suspect domain",
        len(references),
        len(outcome.hits),
    )
    outcome.state = STATE_DONE
    return outcome


async def _run_brand_engine(
    client: SerpApiClient, user_id: str, engine_id: str, brand: str,
    domain: str, suspects: dict[str, str],
) -> EngineOutcome:
    outcome = EngineOutcome(engine_id)
    params = BRAND_ENGINE_PARAMS[engine_id](brand, domain)
    no_cache = engine_id in AI_ENGINES
    before = client.budget(user_id)
    payload = await client.search(engine_id, params, user_id, no_cache=no_cache)
    after = client.budget(user_id)
    outcome.searches_spent = after["spent"] - before["spent"]
    outcome.cache_hit = after["cacheHits"] > before["cacheHits"]
    outcome.hits = extract_hits(payload, engine_id, suspects)
    outcome.state = STATE_CACHED if outcome.cache_hit else STATE_DONE
    return outcome


# ── Persistence helpers ────────────────────────────────────────────────────


def _set_state(db: DbSession, scan: Scan, state: str) -> None:
    scan.state = state
    db.commit()
    log.info("scan %s -> %s", scan.id, state)


def _seed_engine_rows(db: DbSession, scan_id: str) -> dict[str, ScanEngine]:
    existing = {
        row.engine_id: row
        for row in db.execute(
            select(ScanEngine).where(ScanEngine.scan_id == scan_id)
        ).scalars()
    }
    for position, meta in enumerate(ENGINES):
        if meta["id"] not in existing:
            row = ScanEngine(
                scan_id=scan_id,
                engine_id=meta["id"],
                position=position,
                state=STATE_IDLE,
            )
            db.add(row)
            existing[meta["id"]] = row
    db.commit()
    return existing


def _record_engine(db: DbSession, row: ScanEngine, outcome: EngineOutcome) -> None:
    """Written the moment an engine finishes — this is what makes polling live."""
    row.state = outcome.state
    row.findings_count = len(outcome.hits)
    row.searches_spent = outcome.searches_spent
    row.cache_hit = outcome.cache_hit
    row.ms = outcome.ms
    db.commit()


def _activity(db: DbSession, user_id: str, kind: str, text: str, emphasis: bool = False) -> None:
    db.add(Activity(user_id=user_id, kind=kind, text=text, emphasis=emphasis, at=utcnow()))
    db.commit()


# ── The sweep ──────────────────────────────────────────────────────────────


async def run_sweep(scan_id: str) -> None:
    """Entry point for the BackgroundTask. Owns its own DB session."""
    db = SessionLocal()
    started = time.monotonic()
    try:
        scan = db.get(Scan, scan_id)
        if scan is None:
            log.error("sweep started for unknown scan %s", scan_id)
            return
        await _sweep(db, scan)
    except BudgetExhausted as exc:
        _fail(db, scan_id, str(exc))
    except DnsUnavailable as exc:
        _fail(db, scan_id, f"DNS is unavailable, so no candidate could be checked: {exc}")
    except Exception as exc:  # a sweep must never leave the scan hanging
        log.exception("sweep %s failed", scan_id)
        _fail(db, scan_id, f"The sweep failed: {exc}")
    finally:
        log.info("sweep %s finished in %.1fs", scan_id, time.monotonic() - started)
        db.close()


def _fail(db: DbSession, scan_id: str, message: str) -> None:
    scan = db.get(Scan, scan_id)
    if scan is None:
        return
    scan.state = "error"
    scan.error = message
    scan.completed_at = utcnow()
    db.commit()
    log.error("scan %s -> error: %s", scan_id, message)


async def _sweep(db: DbSession, scan: Scan) -> None:
    client = SerpApiClient(db)

    # [1] PERMUTATIONS — free
    _set_state(db, scan, "generating")
    candidates = permutations.generate(scan.domain)
    scan.prefilter_generated = len(candidates)
    db.commit()

    # [2] PREFILTER — free
    _set_state(db, scan, "prefiltering")
    funnel = await prefilter.run(candidates, scan.domain)
    scan.prefilter_generated = funnel.generated
    scan.prefilter_dns = funnel.survived_dns
    scan.prefilter_mail = funnel.mail_capable
    scan.prefilter_http = funnel.survived_http
    db.commit()
    _activity(
        db,
        scan.user_id,
        "sweep",
        f"{scan.brand}: {funnel.generated} permutations narrowed to "
        f"{len(funnel.survivors)} candidates without spending a search.",
    )

    survivors: list[PrefilterResult] = funnel.survivors
    # ascii domain -> display domain, for matching search results back to candidates
    suspects = {r.candidate.ascii_domain: r.candidate.domain for r in survivors}
    for r in survivors:
        suspects.setdefault(r.candidate.domain, r.candidate.domain)

    # [3] SWEEP — searches are spent from here
    _set_state(db, scan, "sweeping")
    engine_rows = _seed_engine_rows(db, scan.id)
    outcomes: dict[str, EngineOutcome] = {}

    for meta in ENGINES:
        engine_id = meta["id"]
        row = engine_rows[engine_id]
        if row.state in (STATE_DONE, STATE_CACHED):
            continue  # resumed scan — do not re-spend

        if not survivors and engine_id == "google":
            row.state = STATE_SKIPPED
            db.commit()
            outcomes[engine_id] = EngineOutcome(engine_id, state=STATE_SKIPPED)
            continue

        row.state = "running"
        db.commit()
        engine_started = time.monotonic()
        try:
            if engine_id == "google":
                outcome = await _run_google(client, scan.user_id, suspects, survivors)
            elif engine_id == "google_ai_overview":
                outcome = await _run_ai_overview(client, scan.user_id, scan.brand, suspects)
            else:
                outcome = await _run_brand_engine(
                    client, scan.user_id, engine_id, scan.brand, scan.domain, suspects
                )
        except BudgetExhausted:
            row.state = STATE_ERROR
            db.commit()
            raise
        except (SerpApiError, asyncio.TimeoutError) as exc:
            # One surface failing must not sink the sweep.
            outcome = EngineOutcome(engine_id, state=STATE_ERROR, error=str(exc))
            log.warning("engine %s failed: %s", engine_id, exc)

        outcome.ms = int((time.monotonic() - engine_started) * 1000)
        outcomes[engine_id] = outcome
        _record_engine(db, row, outcome)  # persisted immediately — live progress

        scan.searches_spent = sum(o.searches_spent for o in outcomes.values())
        db.commit()

    # [4] SCORE
    _set_state(db, scan, "scoring")
    all_hits = [hit for outcome in outcomes.values() for hit in outcome.hits]
    scored = scoring.score(survivors, all_hits)

    for item in scored:
        finding = Finding(
            scan_id=scan.id,
            user_id=scan.user_id,
            domain=item.domain,
            tier=item.tier,
            reason=item.reason,
            technique=item.technique,
            mail_capable=item.mail_capable,
            live=item.live,
            registered=item.registered,
            ai_overview_cited=item.ai_overview_cited,
            created_at=utcnow(),
        )
        db.add(finding)
        db.flush()
        for hit in item.evidence:
            db.add(
                Evidence(
                    finding_id=finding.id,
                    engine=hit.engine,
                    url=hit.url,
                    snippet=hit.snippet,
                    fetched_at=utcnow(),
                )
            )
    db.commit()

    _record_portfolio(db, scan.user_id, scored)

    criticals = [i for i in scored if i.tier == "CRITICAL"]
    if criticals:
        _activity(
            db,
            scan.user_id,
            "finding",
            f"{len(criticals)} CRITICAL: "
            + ", ".join(i.domain for i in criticals[:3])
            + " cited in Google's AI answers for the brand.",
            emphasis=True,
        )

    # [5] COMPLETE
    budget = client.budget(scan.user_id)
    scan.cache_hits = sum(1 for o in outcomes.values() if o.cache_hit)
    scan.completed_at = utcnow()
    _set_state(db, scan, "complete")
    _activity(
        db,
        scan.user_id,
        "sweep",
        f"{scan.brand}: sweep complete — {len(scored)} findings, "
        f"{scan.searches_spent} searches spent ({budget['spent']}/{budget['total']} this month).",
    )


def _record_portfolio(db: DbSession, user_id: str, scored: list) -> None:
    """Carry findings into the domain portfolio.

    Only domains we ACTUALLY resolved are written here, as hostile or watchlist.
    A candidate that did not resolve is NOT written as `available`: DNS silence is
    not proof a name can be bought. `available` is set only by an answered name.com
    availability check, and `protected` only by a completed registration.
    """
    for item in scored:
        if not item.registered:
            continue
        status_value = "hostile" if item.tier in ("CRITICAL", "HIGH") else "watchlist"
        row = db.execute(
            select(PortfolioDomain).where(
                PortfolioDomain.user_id == user_id,
                PortfolioDomain.domain == item.domain,
            )
        ).scalar_one_or_none()
        if row is None:
            row = PortfolioDomain(
                user_id=user_id, domain=item.domain, first_seen=utcnow()
            )
            db.add(row)
        # A registration we made ourselves outranks anything the sweep observes.
        if row.status != "protected":
            row.status = status_value
        row.technique = item.technique
        row.mail_capable = item.mail_capable
    db.commit()


def elapsed_ms(started_at: datetime | None, completed_at: datetime | None) -> int | None:
    if started_at is None:
        return None
    from ..security import as_utc

    start = as_utc(started_at)
    end = as_utc(completed_at) or utcnow()
    return int((end - start).total_seconds() * 1000)
