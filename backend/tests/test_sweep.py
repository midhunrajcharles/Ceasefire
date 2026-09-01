"""The sweep and the scoring heuristic (sections 7.3, 8 Phase 4).

The whole sweep runs here against a faked SerpApi and faked DNS, so state
transitions, scan_engines writes, tiering and search accounting are all proven
without spending a single real search.
"""

import httpx
import pytest

from app.config import settings
from app.models import Evidence, Finding, Scan, ScanEngine, SearchBudget
from app.services import prefilter, sweep
from app.services.permutations import Candidate
from app.services.prefilter import Funnel, PrefilterResult
from app.services.scoring import CRITICAL, HIGH, LOW, MEDIUM, score
from app.services.sweep import Hit, extract_hits, host_of

# asyncio_mode=auto in pytest.ini picks up the async tests below.


def result(domain, *, live=False, mail=False, resolves=True, technique="Combosquat"):
    r = PrefilterResult(candidate=Candidate(domain, technique, domain))
    r.addresses = ["1.2.3.4"] if resolves else []
    r.live = live
    r.mail_capable = mail
    return r


# ── Reading suspects out of ten different payload shapes ───────────────────


def test_host_of_strips_www():
    assert host_of("https://www.okta-login.com/path") == "okta-login.com"
    assert host_of("not a url") == ""


def test_extract_hits_matches_on_source_when_link_is_a_redirector():
    """Measured in Phase 2: AI Overview links are often google.com/goto redirectors."""
    payload = {
        "ai_overview": {
            "references": [
                {
                    "source": "okta-login.com",
                    "link": "https://www.google.com/goto?url=CAESYAHrOzAV",
                    "snippet": "Reset your Okta password here",
                }
            ]
        }
    }
    hits = extract_hits(payload, "google_ai_overview", {"okta-login.com": "okta-login.com"})
    assert len(hits) == 1
    assert hits[0].domain == "okta-login.com"
    assert "password" in hits[0].snippet


def test_extract_hits_ignores_the_redirector_host_itself():
    payload = {"organic_results": [{"link": "https://www.google.com/goto?url=x"}]}
    assert extract_hits(payload, "google", {"google.com": "google.com"}) == []


def test_extract_hits_finds_nested_results():
    payload = {"shopping_results": [{"link": "https://shop-acme.com/p/1", "title": "Acme Widget"}]}
    hits = extract_hits(payload, "google_shopping", {"shop-acme.com": "shop-acme.com"})
    assert hits[0].url == "https://shop-acme.com/p/1"
    assert hits[0].snippet == "Acme Widget"


def test_extract_hits_deduplicates_per_domain():
    payload = {"organic_results": [{"link": "https://a.com/1"}, {"link": "https://a.com/2"}]}
    assert len(extract_hits(payload, "google", {"a.com": "a.com"})) == 1


def test_extract_hits_ignores_unrelated_domains():
    payload = {"organic_results": [{"link": "https://wikipedia.org/wiki/Acme"}]}
    assert extract_hits(payload, "google", {"acme-login.com": "acme-login.com"}) == []


# ── The tiering heuristic (section 7.3) ────────────────────────────────────


def test_ai_overview_citation_is_critical():
    hits = [Hit("a.com", "google_ai_overview", "https://a.com", "cited")]
    f = score([result("a.com")], hits)[0]
    assert f.tier == CRITICAL
    assert f.ai_overview_cited is True
    assert "AI Overview" in f.reason


def test_ai_mode_citation_is_also_critical_but_not_ai_overview_cited():
    hits = [Hit("a.com", "google_ai_mode", "https://a.com", "cited")]
    f = score([result("a.com")], hits)[0]
    assert f.tier == CRITICAL
    assert f.ai_overview_cited is False, "the aiOverviewCited flag must stay literal"


def test_live_plus_mx_is_high():
    f = score([result("a.com", live=True, mail=True)], [])[0]
    assert f.tier == HIGH
    assert f.reason == "Live page with MX records configured — mail-capable"


def test_app_store_listing_is_high():
    hits = [Hit("a.com", "google_play", "https://a.com", "app")]
    assert score([result("a.com")], hits)[0].tier == HIGH


def test_local_pack_is_medium():
    hits = [Hit("a.com", "google_maps", "https://a.com", "listing")]
    assert score([result("a.com")], hits)[0].tier == MEDIUM


def test_commerce_listing_is_medium():
    hits = [Hit("a.com", "google_shopping", "https://a.com", "listing")]
    assert score([result("a.com")], hits)[0].tier == MEDIUM


def test_registered_and_parked_is_low():
    f = score([result("a.com")], [])[0]
    assert f.tier == LOW
    assert "defensive-registration" in f.reason


def test_critical_outranks_everything_else():
    """A domain that is live, mail-capable AND cited is CRITICAL, not HIGH."""
    hits = [Hit("a.com", "google_ai_overview", "https://a.com", "cited")]
    assert score([result("a.com", live=True, mail=True)], hits)[0].tier == CRITICAL


def test_findings_are_sorted_by_tier():
    survivors = [result("low.com"), result("crit.com"), result("high.com", live=True, mail=True)]
    hits = [Hit("crit.com", "google_ai_overview", "https://crit.com", "cited")]
    assert [f.tier for f in score(survivors, hits)] == [CRITICAL, HIGH, LOW]


def test_only_survivors_become_findings():
    """Unregistered candidates are portfolio opportunities, not findings."""
    assert score([], [Hit("ghost.com", "google", "https://ghost.com", "x")]) == []


def test_every_reason_names_a_measurement():
    for f in score([result("a.com", live=True, mail=True), result("b.com")], []):
        assert f.reason and not f.reason.endswith("."), f.reason
        assert "%" not in f.reason, "no invented confidence numbers"


# ── The whole sweep, faked end to end ──────────────────────────────────────


@pytest.fixture
def fake_world(monkeypatch, db):
    """One live+mail-capable lookalike, cited in AI Overview. No network at all."""
    survivor = result("acme-login.com", live=True, mail=True, technique="Combosquat")

    async def fake_prefilter(candidates, original_domain, cap=None):
        return Funnel(
            generated=126,
            survived_dns=3,
            mail_capable=2,
            survived_http=1,
            survivors=[survivor],
            resolved=[survivor],
        )

    monkeypatch.setattr(prefilter, "run", fake_prefilter)
    monkeypatch.setattr(settings, "serpapi_key", "test-key")
    monkeypatch.setattr(sweep, "SessionLocal", lambda: db)
    monkeypatch.setattr(db, "close", lambda: None)

    calls: list[str] = []

    def handler(request):
        engine = request.url.params.get("engine")
        calls.append(engine)
        if engine == "google":
            if request.url.params.get("q") == "Acme":
                return httpx.Response(200, json={"ai_overview": {"page_token": "tok"}})
            return httpx.Response(
                200, json={"organic_results": [{"link": "https://acme-login.com/signin",
                                                "snippet": "Sign in to Acme"}]}
            )
        if engine == "google_ai_overview":
            return httpx.Response(
                200,
                json={"ai_overview": {"references": [
                    {"source": "acme-login.com",
                     "link": "https://www.google.com/goto?url=CAES",
                     "snippet": "Acme account help"}
                ]}},
            )
        return httpx.Response(200, json={"organic_results": []})

    real_client = sweep.SerpApiClient

    def client_factory(session, *a, **kw):
        return real_client(
            session,
            bucket=sweep.__dict__.get("_test_bucket"),
            transport=httpx.MockTransport(handler),
        )

    from app.services.serpapi import TokenBucket

    sweep._test_bucket = TokenBucket(rate_per_hour=3_600_000, burst=100)
    monkeypatch.setattr(sweep, "SerpApiClient", client_factory)
    return calls


async def test_sweep_runs_the_whole_pipeline(db, user, fake_world):
    scan = Scan(user_id=user.id, brand="Acme", domain="acme.com", state="generating")
    db.add(scan)
    db.commit()
    db.refresh(scan)

    await sweep.run_sweep(scan.id)
    db.refresh(scan)

    assert scan.state == "complete", scan.error
    assert scan.error is None
    assert scan.completed_at is not None

    # Prefilter counts persisted for the frontend
    assert (scan.prefilter_generated, scan.prefilter_dns) == (126, 3)
    assert (scan.prefilter_mail, scan.prefilter_http) == (2, 1)

    # All ten engines have a row, in the fixed UI order
    rows = db.query(ScanEngine).filter(ScanEngine.scan_id == scan.id).order_by(
        ScanEngine.position
    ).all()
    assert len(rows) == 10
    assert [r.position for r in rows] == list(range(10))
    assert all(r.state in ("done", "cached", "error", "skipped") for r in rows)

    # The finding, tiered CRITICAL by the AI Overview citation
    findings = db.query(Finding).filter(Finding.scan_id == scan.id).all()
    assert len(findings) == 1
    assert findings[0].domain == "acme-login.com"
    assert findings[0].tier == "CRITICAL"
    assert findings[0].ai_overview_cited is True
    assert findings[0].mail_capable is True

    evidence = db.query(Evidence).filter(Evidence.finding_id == findings[0].id).all()
    assert {e.engine for e in evidence} >= {"google", "google_ai_overview"}

    # Accounting: what the scan says it spent equals what the budget says
    budget = db.query(SearchBudget).one()
    assert scan.searches_spent == budget.spent
    assert scan.searches_spent == sum(r.searches_spent for r in rows)


async def test_sweep_records_engines_as_they_finish(db, user, fake_world):
    """scan_engines rows are what make polling show live progress."""
    scan = Scan(user_id=user.id, brand="Acme", domain="acme.com", state="generating")
    db.add(scan)
    db.commit()

    seen_states = []
    original = sweep._record_engine

    def spy(session, row, outcome):
        original(session, row, outcome)
        seen_states.append(
            (row.engine_id, db.query(ScanEngine).filter(
                ScanEngine.scan_id == scan.id, ScanEngine.state != "idle"
            ).count())
        )

    sweep._record_engine = spy
    try:
        await sweep.run_sweep(scan.id)
    finally:
        sweep._record_engine = original

    counts = [n for _, n in seen_states]
    assert counts == sorted(counts), "engine rows must land incrementally, not all at once"
    assert counts[-1] == 10


async def test_budget_exhaustion_ends_the_scan_in_error(db, user, fake_world, monkeypatch):
    monkeypatch.setattr(settings, "search_budget_total", 1)
    scan = Scan(user_id=user.id, brand="Acme", domain="acme.com", state="generating")
    db.add(scan)
    db.commit()

    await sweep.run_sweep(scan.id)
    db.refresh(scan)

    assert scan.state == "error"
    assert "budget" in scan.error.lower()
    assert scan.completed_at is not None, "an errored scan must still stop, not hang"


async def test_a_failing_engine_does_not_sink_the_sweep(db, user, fake_world, monkeypatch):
    from app.services.serpapi import SerpApiError

    real = sweep._run_brand_engine

    async def flaky(client, user_id, engine_id, brand, domain, suspects):
        if engine_id == "youtube":
            raise SerpApiError("engine unavailable")
        return await real(client, user_id, engine_id, brand, domain, suspects)

    monkeypatch.setattr(sweep, "_run_brand_engine", flaky)

    scan = Scan(user_id=user.id, brand="Acme", domain="acme.com", state="generating")
    db.add(scan)
    db.commit()
    await sweep.run_sweep(scan.id)
    db.refresh(scan)

    assert scan.state == "complete"
    youtube = db.query(ScanEngine).filter(
        ScanEngine.scan_id == scan.id, ScanEngine.engine_id == "youtube"
    ).one()
    assert youtube.state == "error"
    assert db.query(Finding).filter(Finding.scan_id == scan.id).count() == 1
