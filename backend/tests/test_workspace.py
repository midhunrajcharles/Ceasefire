"""Workspace aggregates and domain routes (sections 3.5, 3.6).

The load-bearing test in this file is cross-user isolation. Every workspace route
filters on user_id; a second user must see zeroes and empty lists, never a trace of
the first user's rows.
"""

import httpx
import pytest

from app.config import settings
from app.models import (
    Activity,
    Evidence,
    Finding,
    Notice,
    PortfolioDomain,
    Scan,
    ScanEngine,
    SearchBudget,
    User,
)
from app.security import create_session, hash_password, utcnow
from app.services import namecom

WORKSPACE_ROUTES = [
    "/workspace/overview",
    "/workspace/findings",
    "/workspace/notices",
    "/workspace/domains",
    "/workspace/surfaces",
    "/workspace/budget",
]


@pytest.fixture
def populated(db, user):
    """User A with a complete scan: engines, findings, evidence, notice, portfolio."""
    scan = Scan(
        user_id=user.id,
        brand="Northwind Supply",
        domain="northwind-supply.com",
        state="complete",
        prefilter_generated=126,
        prefilter_dns=3,
        prefilter_mail=2,
        prefilter_http=1,
        searches_spent=10,
        started_at=utcnow(),
        completed_at=utcnow(),
    )
    db.add(scan)
    db.commit()

    db.add_all(
        [
            ScanEngine(scan_id=scan.id, engine_id="google", position=0, state="done",
                       findings_count=1, searches_spent=4, cache_hit=False, ms=400),
            ScanEngine(scan_id=scan.id, engine_id="google_ai_overview", position=1,
                       state="cached", findings_count=1, searches_spent=2,
                       cache_hit=True, ms=1200),
        ]
    )
    finding = Finding(
        scan_id=scan.id, user_id=user.id, domain="northwindsupply.com", tier="CRITICAL",
        reason="Cited in AI Overview as a source for the brand query", technique="Omission",
        mail_capable=True, live=True, registered=True, ai_overview_cited=True,
        created_at=utcnow(),
    )
    low = Finding(
        scan_id=scan.id, user_id=user.id, domain="nortwind-supply.com", tier="LOW",
        reason="Registered and parked — a defensive-registration candidate",
        technique="Omission", mail_capable=False, live=False, registered=True,
        ai_overview_cited=False, created_at=utcnow(),
    )
    db.add_all([finding, low])
    db.commit()
    db.add(
        Evidence(finding_id=finding.id, engine="google_ai_overview",
                 url="https://northwindsupply.com/", snippet="cited", fetched_at=utcnow())
    )
    db.add(
        Notice(user_id=user.id, finding_id=finding.id, domain="northwindsupply.com",
               tier="CRITICAL", stage="awaiting_signature", case_facts_json="{}",
               body_markdown="# notice", registrar="NameSilo",
               created_at=utcnow(), updated_at=utcnow())
    )
    db.add_all(
        [
            PortfolioDomain(user_id=user.id, domain="northwindsupply.com", status="hostile",
                            technique="Omission", mail_capable=True, first_seen=utcnow()),
            PortfolioDomain(user_id=user.id, domain="northwind-supply.net",
                            status="protected", technique="TLD swap", registrar="name.com",
                            price_usd=12.99, first_seen=utcnow()),
        ]
    )
    db.add(Activity(user_id=user.id, kind="sweep", text="Sweep completed", at=utcnow()))
    db.add(SearchBudget(user_id=user.id, period=utcnow().strftime("%Y-%m"),
                        spent=10, cache_hits=2))
    db.commit()
    return scan


@pytest.fixture
def second_user(db):
    """User B: signed up, never ran anything."""
    row = User(
        email="mallory@other-corp.com",
        password_hash=hash_password("correct-horse-battery"),
        organisation="Other Corp",
        created_at=utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def as_user(client, db, who):
    client.cookies.set(settings.session_cookie_name, create_session(db, who))
    return client


# ── The gate: cross-user isolation ─────────────────────────────────────────


@pytest.mark.parametrize("route", WORKSPACE_ROUTES)
def test_second_user_sees_no_trace_of_the_first(client, db, user, populated, second_user, route):
    a = as_user(client, db, user).get(route).json()
    b = as_user(client, db, second_user).get(route).json()

    assert a != b, f"{route} returned identical data for two different users"
    # Nothing of user A's may appear anywhere in user B's payload.
    blob = repr(b)
    for secret in ("northwindsupply.com", "northwind-supply.net", "Northwind Supply",
                   "NameSilo", "Sweep completed", user.id, populated.id):
        assert secret not in blob, f"{route} leaked {secret!r} to another user"


def test_empty_user_gets_empty_lists_not_nulls(client, db, second_user):
    c = as_user(client, db, second_user)
    assert c.get("/workspace/findings").json() == []
    assert c.get("/workspace/notices").json() == []
    assert c.get("/workspace/domains").json() == []


def test_empty_user_overview_is_all_zeroes(client, db, second_user):
    payload = as_user(client, db, second_user).get("/workspace/overview").json()
    assert payload["stats"] == {
        "openCriticals": 0, "hostileDomains": 0, "noticesInFlight": 0
    }
    assert payload["activity"] == []
    assert len(payload["trend"]) == 6
    assert all(p["critical"] == 0 and p["low"] == 0 for p in payload["trend"])


def test_empty_user_budget_is_zero_not_the_other_users(client, db, user, populated, second_user):
    assert as_user(client, db, user).get("/workspace/budget").json()["spent"] == 10
    assert as_user(client, db, second_user).get("/workspace/budget").json() == {
        "total": settings.search_budget_total, "spent": 0, "cacheHits": 0
    }


def test_empty_user_surfaces_are_all_ten_engines_at_zero(client, db, second_user):
    surfaces = as_user(client, db, second_user).get("/workspace/surfaces").json()
    assert len(surfaces) == 10
    assert all(s["findingsAllTime"] == 0 and s["searchesSpent"] == 0 for s in surfaces)


@pytest.mark.parametrize("route", WORKSPACE_ROUTES)
def test_workspace_requires_authentication(client, route):
    client.cookies.clear()
    assert client.get(route).status_code == 401


# ── The numbers are computed, not invented ─────────────────────────────────


def test_overview_stats_are_counted_from_rows(client, db, user, populated):
    stats = as_user(client, db, user).get("/workspace/overview").json()["stats"]
    assert stats == {"openCriticals": 1, "hostileDomains": 1, "noticesInFlight": 1}


def test_a_resolved_notice_closes_its_critical(client, db, user, populated):
    notice = db.query(Notice).one()
    notice.stage = "resolved"
    db.commit()
    payload = as_user(client, db, user).get("/workspace/overview").json()
    assert payload["stats"]["openCriticals"] == 0
    assert payload["stats"]["noticesInFlight"] == 0


def test_surfaces_are_summed_and_averaged_from_scan_engines(client, db, user, populated):
    surfaces = {s["id"]: s for s in as_user(client, db, user).get("/workspace/surfaces").json()}
    assert len(surfaces) == 10
    assert surfaces["google"]["searchesSpent"] == 4
    assert surfaces["google"]["avgMs"] == 400
    assert surfaces["google"]["cacheHitRate"] == 0.0
    assert surfaces["google_ai_overview"]["cacheHitRate"] == 1.0
    # An engine this user never ran reports zeroes rather than being omitted.
    assert surfaces["youtube"]["searchesSpent"] == 0


def test_findings_carry_their_evidence_and_are_newest_first(client, db, user, populated):
    findings = as_user(client, db, user).get("/workspace/findings").json()
    assert len(findings) == 2
    critical = next(f for f in findings if f["tier"] == "CRITICAL")
    assert critical["evidence"][0]["engine"] == "google_ai_overview"
    assert "fetchedAt" in critical["evidence"][0]


def test_notices_use_the_workspace_stage_vocabulary(client, db, user, populated):
    record = as_user(client, db, user).get("/workspace/notices").json()[0]
    assert record["stage"] == "awaiting_signature"
    assert set(record) == {"id", "domain", "tier", "stage", "createdAt", "updatedAt", "registrar"}


def test_portfolio_returns_the_frontend_shape(client, db, user, populated):
    rows = as_user(client, db, user).get("/workspace/domains").json()
    assert {r["status"] for r in rows} == {"hostile", "protected"}
    protected = next(r for r in rows if r["status"] == "protected")
    assert protected["registrar"] == "name.com"
    assert protected["priceUsd"] == 12.99


# ── Domains (section 3.5) ──────────────────────────────────────────────────


@pytest.fixture
def namecom_stub(monkeypatch):
    def install(handler):
        async def call(method, path, json_body=None):
            return handler(method, path, json_body)

        monkeypatch.setattr(namecom, "_call", call)
        monkeypatch.setattr(settings, "namecom_username", "sandbox-user")
        monkeypatch.setattr(settings, "namecom_token", "sandbox-token")

    return install


def test_availability_available_records_a_portfolio_row(auth_client, db, namecom_stub):
    namecom_stub(
        lambda m, p, b: {
            "results": [
                {"domainName": "nortwind-supply.com", "purchasable": True,
                 "purchasePrice": 12.99, "premium": False}
            ]
        }
    )
    payload = auth_client.get("/domain/availability?domain=nortwind-supply.com").json()
    assert payload == {
        "domain": "nortwind-supply.com", "available": True, "priceUsd": 12.99,
        "premium": False, "reason": None,
    }
    row = db.query(PortfolioDomain).one()
    assert (row.status, float(row.price_usd)) == ("available", 12.99)


def test_taken_domain_is_not_recorded_as_available(auth_client, db, namecom_stub):
    namecom_stub(lambda m, p, b: {"results": []})
    payload = auth_client.get("/domain/availability?domain=google.com").json()
    assert payload["available"] is False
    assert "already registered" in payload["reason"].lower()
    assert db.query(PortfolioDomain).count() == 0


def test_namecom_unavailable_degrades_without_inventing_a_price(auth_client, db, monkeypatch):
    async def boom(*a, **kw):
        raise namecom.NamecomUnavailable("name.com credentials are not configured.")

    monkeypatch.setattr(namecom, "check_availability", boom)
    payload = auth_client.get("/domain/availability?domain=x-example.com").json()
    assert payload["available"] is False
    assert payload["priceUsd"] is None
    assert "not configured" in payload["reason"]
    assert db.query(PortfolioDomain).count() == 0


def test_registration_marks_the_domain_protected(auth_client, db, namecom_stub):
    def handler(method, path, body):
        if path.endswith("checkAvailability"):
            return {"results": [{"domainName": "nortwind-supply.com", "purchasable": True,
                                 "purchasePrice": 12.99, "premium": False}]}
        return {"order": 4412, "domain": {"domainName": "nortwind-supply.com",
                                          "expireDate": "2027-08-31T00:00:00Z"}}

    namecom_stub(handler)
    payload = auth_client.post("/domain/register", json={"domain": "nortwind-supply.com"}).json()
    assert payload == {"ok": True, "orderId": "4412", "reason": None}

    row = db.query(PortfolioDomain).one()
    assert row.status == "protected"
    assert row.registrar == "name.com"
    assert row.expires_at is not None
    assert db.query(Activity).filter(Activity.kind == "domain").count() == 1


def test_registering_a_taken_domain_returns_ok_false(auth_client, db, namecom_stub):
    namecom_stub(lambda m, p, b: {"results": []})
    payload = auth_client.post("/domain/register", json={"domain": "google.com"}).json()
    assert payload["ok"] is False
    assert payload["orderId"] is None
    assert db.query(PortfolioDomain).count() == 0


def test_default_base_url_is_the_sandbox():
    assert namecom.SANDBOX_BASE_URL == "https://api.dev.name.com"
    assert settings.namecom_base_url.rstrip("/") == namecom.SANDBOX_BASE_URL
    assert namecom.is_sandbox() is True


def test_domain_routes_require_authentication(client):
    client.cookies.clear()
    assert client.get("/domain/availability?domain=a.com").status_code == 401
    assert client.post("/domain/register", json={"domain": "a.com"}).status_code == 401
