"""The SerpApi layer: cache, token bucket, backoff, budget enforcement (section 6).

No live calls here — the network is a MockTransport so the accounting rules are
proven without spending any of the 250 monthly searches.
"""

import httpx
import pytest

from app.config import settings
from app.models import SearchBudget, SerpCache
from app.services.serpapi import (
    ENGINE_IDS,
    ENGINES,
    BudgetExhausted,
    SerpApiClient,
    SerpApiError,
    TokenBucket,
    ai_overview_references,
    params_hash,
)

# asyncio_mode=auto in pytest.ini picks up the async tests below.
FAST_BUCKET = lambda: TokenBucket(rate_per_hour=3_600_000, burst=100)  # noqa: E731


def _client(db, handler, bucket=None):
    return SerpApiClient(
        db, bucket=bucket or FAST_BUCKET(), transport=httpx.MockTransport(handler)
    )


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    monkeypatch.setattr(settings, "serpapi_key", "test-key-not-real")


# ── The ten engines ────────────────────────────────────────────────────────


def test_ten_engines_in_ui_order():
    assert len(ENGINES) == 10
    assert ENGINE_IDS == [
        "google",
        "google_ai_overview",
        "google_ai_mode",
        "google_play",
        "apple_app_store",
        "google_shopping",
        "google_maps",
        "youtube",
        "google_images",
        "google_trends",
    ]
    assert [e["id"] for e in ENGINES if e["headline"]] == [
        "google_ai_overview",
        "google_ai_mode",
    ]


def test_params_hash_is_order_independent_and_excludes_the_key():
    a = params_hash("google", {"q": "acme", "hl": "en"})
    b = params_hash("google", {"hl": "en", "q": "acme"})
    assert a == b and len(a) == 64
    assert a != params_hash("google_ai_overview", {"q": "acme", "hl": "en"})


# ── Cache ──────────────────────────────────────────────────────────────────


async def test_cache_hit_spends_no_search(db, user):
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(200, json={"organic_results": [{"link": "https://a.example"}]})

    client = _client(db, handler)
    first = await client.search("google", {"q": "acme"}, user.id)
    second = await client.search("google", {"q": "acme"}, user.id)

    assert first == second
    assert calls["n"] == 1, "second call must be served from serp_cache"

    budget = db.query(SearchBudget).one()
    assert budget.spent == 1
    assert budget.cache_hits == 1
    assert db.query(SerpCache).one().hit_count == 1


async def test_no_cache_bypasses_the_cache_entirely(db, user):
    """Threat-verification paths must never be served a stale result."""
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(200, json={"n": calls["n"]})

    client = _client(db, handler)
    await client.search("google", {"q": "acme"}, user.id, no_cache=True)
    await client.search("google", {"q": "acme"}, user.id, no_cache=True)

    assert calls["n"] == 2
    assert db.query(SearchBudget).one().spent == 2


async def test_stale_cache_rows_are_ignored_on_read(db, user, monkeypatch):
    def handler(request):
        return httpx.Response(200, json={"ok": True})

    client = _client(db, handler)
    await client.search("google", {"q": "acme"}, user.id)
    monkeypatch.setattr(settings, "serp_cache_ttl_hours", 0)
    await client.search("google", {"q": "acme"}, user.id)

    assert db.query(SearchBudget).one().spent == 2


# ── Budget ─────────────────────────────────────────────────────────────────


async def test_budget_ceiling_raises_before_the_call(db, user, monkeypatch):
    monkeypatch.setattr(settings, "search_budget_total", 2)
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(200, json={"i": calls["n"]})

    client = _client(db, handler)
    await client.search("google", {"q": "a"}, user.id)
    await client.search("google", {"q": "b"}, user.id)

    with pytest.raises(BudgetExhausted) as exc:
        await client.search("google", {"q": "c"}, user.id)

    assert "2/2" in str(exc.value)
    assert calls["n"] == 2, "the third search must not reach the network"


async def test_budget_is_per_user_and_per_month(db, user):
    def handler(request):
        return httpx.Response(200, json={"ok": True})

    client = _client(db, handler)
    await client.search("google", {"q": "a"}, user.id)
    await client.search("google", {"q": "b"}, "some-other-user-id")

    rows = {r.user_id: r.spent for r in db.query(SearchBudget).all()}
    assert rows == {user.id: 1, "some-other-user-id": 1}


# ── Backoff ────────────────────────────────────────────────────────────────


async def test_429_backs_off_then_succeeds(db, user, monkeypatch):
    monkeypatch.setattr("app.services.serpapi.BASE_BACKOFF_SECONDS", 0.001)
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(429)
        return httpx.Response(200, json={"ok": True})

    result = await _client(db, handler).search("google", {"q": "acme"}, user.id)
    assert result == {"ok": True}
    assert calls["n"] == 3
    assert db.query(SearchBudget).one().spent == 1, "one search, not one per retry"


async def test_gives_up_after_four_attempts(db, user, monkeypatch):
    monkeypatch.setattr("app.services.serpapi.BASE_BACKOFF_SECONDS", 0.001)
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(429)

    with pytest.raises(SerpApiError) as exc:
        await _client(db, handler).search("google", {"q": "acme"}, user.id)

    assert calls["n"] == 4
    assert "after 4 attempts" in str(exc.value)


async def test_api_error_payload_is_surfaced(db, user):
    def handler(request):
        return httpx.Response(200, json={"error": "Invalid API key"})

    with pytest.raises(SerpApiError) as exc:
        await _client(db, handler).search("google", {"q": "acme"}, user.id)
    assert "Invalid API key" in str(exc.value)


# ── Token bucket ───────────────────────────────────────────────────────────


async def test_bucket_allows_burst_then_throttles():
    bucket = TokenBucket(rate_per_hour=3600, burst=3)  # 1/sec, burst 3
    for _ in range(3):
        assert await bucket.acquire() == 0.0  # burst is free
    assert await bucket.acquire() > 0.0  # the fourth waits


# ── page_token, inline ─────────────────────────────────────────────────────


async def test_ai_overview_page_token_is_fetched_inline(db, user):
    """The token expires in under 60s, so the follow-up is the very next call."""
    seen: list[str] = []

    def handler(request):
        engine = request.url.params.get("engine")
        seen.append(engine)
        if engine == "google":
            return httpx.Response(
                200, json={"ai_overview": {"page_token": "tok_abc123"}}
            )
        assert request.url.params.get("page_token") == "tok_abc123"
        return httpx.Response(
            200,
            json={
                "ai_overview": {
                    "references": [
                        {"title": "Northwind", "link": "https://northwind-supply.com", "index": 1}
                    ]
                }
            },
        )

    payload = await _client(db, handler).google_with_ai_overview("northwind supply", user.id)

    assert seen == ["google", "google_ai_overview"], "no other call in between"
    assert ai_overview_references(payload)[0]["link"] == "https://northwind-supply.com"
    # Both legs are threat verification: no_cache, so both are metered.
    assert db.query(SearchBudget).one().spent == 2


async def test_no_page_token_means_no_second_call(db, user):
    seen: list[str] = []

    def handler(request):
        seen.append(request.url.params.get("engine"))
        return httpx.Response(200, json={"organic_results": []})

    payload = await _client(db, handler).google_with_ai_overview("acme", user.id)
    assert seen == ["google"]
    assert ai_overview_references(payload) == []
