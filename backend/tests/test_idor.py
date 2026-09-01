"""The IDOR rule, section 5.3.

User A must never reach user B's rows, and the refusal must be 404 rather than 403 —
a 403 confirms the id exists, which is itself a disclosure. Every owned-resource
loader filters on `user_id` in the same query as the id, so a mismatch is
indistinguishable from a row that was never there.

The load-bearing assertion in this file is `== 404`, not `!= 200`.
"""

import json

import pytest
from sqlalchemy import select

from app.config import settings
from app.models import Finding, Notice, Scan, User
from app.security import create_session, hash_password, utcnow


@pytest.fixture
def victim(db):
    """User B — owns everything the attacker will try to reach."""
    row = User(
        email="victim@kestrel-health.io",
        password_hash=hash_password("correct-horse-battery"),
        organisation="Kestrel Health",
        created_at=utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@pytest.fixture
def victim_rows(db, victim):
    """A complete scan → finding → notice chain belonging to user B."""
    scan = Scan(
        user_id=victim.id,
        brand="Kestrel Health",
        domain="kestrel-health.io",
        state="complete",
        prefilter_generated=80,
        prefilter_dns=2,
        prefilter_mail=1,
        prefilter_http=1,
        searches_spent=6,
        started_at=utcnow(),
        completed_at=utcnow(),
    )
    db.add(scan)
    db.commit()

    finding = Finding(
        scan_id=scan.id,
        user_id=victim.id,
        domain="kestrelheaith.io",
        tier="CRITICAL",
        reason="Cited in AI Overview for 3 brand queries",
        technique="Homoglyph",
        mail_capable=True,
        live=True,
        registered=True,
        ai_overview_cited=True,
        created_at=utcnow(),
    )
    db.add(finding)
    db.commit()

    notice = Notice(
        user_id=victim.id,
        finding_id=finding.id,
        domain=finding.domain,
        tier=finding.tier,
        stage="draft",
        case_facts_json=json.dumps({"registrant_domain": finding.domain}),
        body_markdown="## Notice\nConfidential draft belonging to user B.",
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(notice)
    db.commit()

    return {"scan": scan, "finding": finding, "notice": notice}


# ── Scans — the case named in the spec ─────────────────────────────────────


def test_user_a_cannot_read_user_bs_scan(auth_client, victim_rows):
    response = auth_client.get(f"/scan/{victim_rows['scan'].id}")

    assert response.status_code == 404
    assert "kestrel" not in response.text.lower()


def test_a_missing_scan_and_someone_elses_scan_are_indistinguishable(
    auth_client, victim_rows
):
    """Same status and same body, so the id is never confirmed to exist."""
    theirs = auth_client.get(f"/scan/{victim_rows['scan'].id}")
    nonexistent = auth_client.get("/scan/11111111-2222-3333-4444-555555555555")

    assert theirs.status_code == nonexistent.status_code == 404
    assert theirs.json() == nonexistent.json()


def test_scan_list_shows_only_your_own(auth_client, victim_rows, db, user):
    mine = Scan(
        user_id=user.id,
        brand="Northwind Supply",
        domain="northwind-supply.com",
        state="complete",
        started_at=utcnow(),
        completed_at=utcnow(),
    )
    db.add(mine)
    db.commit()

    body = auth_client.get("/scans").json()

    assert [s["id"] for s in body] == [mine.id]


# ── Notices ────────────────────────────────────────────────────────────────


def test_user_a_cannot_approve_user_bs_notice(auth_client, victim_rows, db):
    notice_id = victim_rows["notice"].id

    assert auth_client.post(f"/notice/{notice_id}/approve").status_code == 404

    db.refresh(victim_rows["notice"])
    assert victim_rows["notice"].stage == "draft"


def test_user_a_cannot_sign_user_bs_notice(auth_client, victim_rows, db):
    notice_id = victim_rows["notice"].id

    assert auth_client.post(f"/notice/{notice_id}/sign").status_code == 404

    db.refresh(victim_rows["notice"])
    assert victim_rows["notice"].signed_at is None


def test_user_a_cannot_draft_against_user_bs_scan(auth_client, victim_rows):
    response = auth_client.post(
        f"/scan/{victim_rows['scan'].id}/notice",
        json={"finding_id": victim_rows["finding"].id},
    )

    assert response.status_code == 404


# ── Workspace aggregates ───────────────────────────────────────────────────


@pytest.mark.parametrize(
    "route",
    [
        "/workspace/findings",
        "/workspace/notices",
        "/workspace/domains",
    ],
)
def test_workspace_lists_leak_nothing_from_another_user(auth_client, victim_rows, route):
    response = auth_client.get(route)

    assert response.status_code == 200
    assert response.json() == []
    assert "kestrel" not in response.text.lower()


def test_workspace_overview_counts_nothing_from_another_user(auth_client, victim_rows):
    stats = auth_client.get("/workspace/overview").json()["stats"]

    assert stats == {"openCriticals": 0, "hostileDomains": 0, "noticesInFlight": 0}


# ── Unauthenticated access ─────────────────────────────────────────────────


@pytest.mark.parametrize(
    "method,route",
    [
        ("get", "/scans"),
        ("get", "/scan/any-id"),
        ("post", "/notice/any-id/approve"),
        ("post", "/notice/any-id/sign"),
        ("get", "/workspace/overview"),
        ("get", "/workspace/findings"),
    ],
)
def test_every_owned_route_requires_a_session(client, method, route):
    assert getattr(client, method)(route).status_code == 401


def test_a_revoked_session_cannot_reach_owned_rows(client, db, user):
    raw = create_session(db, user)
    client.cookies.set(settings.session_cookie_name, raw)
    assert client.get("/scans").status_code == 200

    client.post("/auth/signout")
    client.cookies.set(settings.session_cookie_name, raw)

    assert client.get("/scans").status_code == 401
