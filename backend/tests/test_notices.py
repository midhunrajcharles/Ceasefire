"""Notices (sections 3.4, 7.4).

Two things are being defended here:
  1. The review gate is a real state machine. draft -> reviewed -> signed, and every
     out-of-order transition is a 409.
  2. The body is a conditional template over measured facts, not generated prose.
"""

import json

import pytest

from app.models import Evidence, Finding, Notice, Scan, User
from app.security import hash_password, utcnow
from app.services.notice import build_case_facts, render_body

# asyncio_mode=auto in pytest.ini picks up any async tests below.


@pytest.fixture
def finding(db, user):
    scan = Scan(
        user_id=user.id,
        brand="Northwind Supply",
        domain="northwind-supply.com",
        state="complete",
        started_at=utcnow(),
        completed_at=utcnow(),
    )
    db.add(scan)
    db.commit()

    row = Finding(
        scan_id=scan.id,
        user_id=user.id,
        domain="northwindsupply.com",
        tier="CRITICAL",
        reason="Cited in AI Overview as a source for the brand query",
        technique="Omission",
        mail_capable=True,
        live=True,
        registered=True,
        ai_overview_cited=True,
        created_at=utcnow(),
    )
    db.add(row)
    db.commit()
    db.add(
        Evidence(
            finding_id=row.id,
            engine="google_ai_overview",
            url="https://northwindsupply.com/",
            snippet="Cited as a source",
            fetched_at=utcnow(),
        )
    )
    db.commit()
    db.refresh(row)
    row.scan = scan
    return row


def draft(auth_client, finding):
    response = auth_client.post(
        f"/scan/{finding.scan_id}/notice", json={"finding_id": finding.id}
    )
    assert response.status_code == 200, response.text
    return response.json()


# ── The state machine ──────────────────────────────────────────────────────


def test_draft_approve_sign_happy_path(auth_client, finding):
    notice = draft(auth_client, finding)
    assert (notice["state"], notice["reviewed"], notice["signed"]) == ("draft", False, False)
    assert notice["signedAt"] is None and notice["envelopeId"] is None

    approved = auth_client.post(f"/notice/{notice['id']}/approve").json()
    assert (approved["state"], approved["reviewed"], approved["signed"]) == (
        "reviewed", True, False,
    )

    signed = auth_client.post(f"/notice/{notice['id']}/sign").json()
    assert (signed["state"], signed["reviewed"], signed["signed"]) == ("signed", True, True)
    assert signed["signedAt"] is not None
    assert signed["envelopeId"].startswith("local_")


def test_signing_an_unapproved_notice_is_409(auth_client, finding):
    notice = draft(auth_client, finding)
    response = auth_client.post(f"/notice/{notice['id']}/sign")
    assert response.status_code == 409
    assert "approved before it can be signed" in response.json()["detail"]


def test_approving_twice_is_409(auth_client, finding):
    notice = draft(auth_client, finding)
    assert auth_client.post(f"/notice/{notice['id']}/approve").status_code == 200
    assert auth_client.post(f"/notice/{notice['id']}/approve").status_code == 409


def test_signing_twice_is_409(auth_client, finding):
    notice = draft(auth_client, finding)
    auth_client.post(f"/notice/{notice['id']}/approve")
    assert auth_client.post(f"/notice/{notice['id']}/sign").status_code == 200
    assert auth_client.post(f"/notice/{notice['id']}/sign").status_code == 409


def test_approving_a_signed_notice_is_409(auth_client, finding):
    notice = draft(auth_client, finding)
    auth_client.post(f"/notice/{notice['id']}/approve")
    auth_client.post(f"/notice/{notice['id']}/sign")
    response = auth_client.post(f"/notice/{notice['id']}/approve")
    assert response.status_code == 409
    assert "Only a draft can be approved" in response.json()["detail"]


def test_a_signed_notice_is_never_reset_by_redrafting(auth_client, finding):
    """Clicking generate again must not wipe a signature."""
    notice = draft(auth_client, finding)
    auth_client.post(f"/notice/{notice['id']}/approve")
    auth_client.post(f"/notice/{notice['id']}/sign")

    again = draft(auth_client, finding)
    assert again["id"] == notice["id"]
    assert again["state"] == "signed"


def test_the_stage_column_uses_the_workspace_vocabulary(auth_client, finding, db):
    """DB stage is draft|awaiting_signature|signed|...; the API state is draft|reviewed|signed."""
    notice = draft(auth_client, finding)
    row = db.query(Notice).one()
    assert row.stage == "draft"

    auth_client.post(f"/notice/{notice['id']}/approve")
    db.refresh(row)
    assert row.stage == "awaiting_signature"

    auth_client.post(f"/notice/{notice['id']}/sign")
    db.refresh(row)
    assert row.stage == "signed"


# ── Ownership ──────────────────────────────────────────────────────────────


def test_another_users_notice_is_404_not_403(client, db, user, finding, auth_client):
    notice = draft(auth_client, finding)

    intruder = User(
        email="mallory@other-corp.com",
        password_hash=hash_password("correct-horse-battery"),
        organisation="Other Corp",
        created_at=utcnow(),
    )
    db.add(intruder)
    db.commit()

    from app.config import settings
    from app.security import create_session

    client.cookies.set(settings.session_cookie_name, create_session(db, intruder))
    assert client.post(f"/notice/{notice['id']}/approve").status_code == 404
    assert client.post(f"/notice/{notice['id']}/sign").status_code == 404


def test_a_finding_from_another_scan_is_rejected(auth_client, finding, db, user):
    other = Scan(
        user_id=user.id, brand="X", domain="x.com", state="complete", started_at=utcnow()
    )
    db.add(other)
    db.commit()
    response = auth_client.post(f"/scan/{other.id}/notice", json={"finding_id": finding.id})
    assert response.status_code == 404


def test_notice_requires_authentication(client, finding):
    assert client.post(
        f"/scan/{finding.scan_id}/notice", json={"finding_id": finding.id}
    ).status_code == 401


# ── Case facts and the conditional template ────────────────────────────────


def test_case_facts_are_the_seven_documented_keys(db, finding):
    evidence = db.query(Evidence).all()
    facts = build_case_facts(finding, "Northwind Supply", evidence)
    assert set(facts) == {
        "registrant_domain",
        "rights_holder",
        "first_observed",
        "harm_class",
        "permutation_technique",
        "evidence_count",
        "mail_capable",
    }
    assert all(isinstance(v, str) for v in facts.values())
    assert facts["registrant_domain"] == "northwindsupply.com"
    assert facts["mail_capable"] == "yes"
    assert facts["evidence_count"] == "1"


def test_body_has_the_sections_the_ui_is_laid_out_for(auth_client, finding):
    body = draft(auth_client, finding)["bodyMarkdown"]
    for heading in (
        "## Notice of Trademark Infringement and Demand to Cease and Desist",
        "### 1. Rights asserted",
        "### 2. Conduct observed",
        "### 3. Demand",
        "### 4. Evidence",
    ):
        assert heading in body
    assert "conditional template" in body


def test_mail_capable_branch_flips_on_the_fact(db, finding):
    evidence = db.query(Evidence).all()

    facts = build_case_facts(finding, "Northwind Supply", evidence)
    assert "capable of sending mail" in render_body(facts, finding, evidence)

    finding.mail_capable = False
    facts = build_case_facts(finding, "Northwind Supply", evidence)
    body = render_body(facts, finding, evidence)
    assert "No mail-exchange records were observed" in body
    assert "capable of sending mail" not in body


def test_ai_overview_paragraph_only_when_actually_cited(db, finding):
    evidence = db.query(Evidence).all()
    facts = build_case_facts(finding, "Northwind Supply", evidence)
    assert "cited source in Google's AI Overview" in render_body(facts, finding, evidence)

    finding.ai_overview_cited = False
    assert "cited source in Google's AI Overview" not in render_body(facts, finding, evidence)


def test_live_versus_parked_branch(db, finding):
    evidence = db.query(Evidence).all()
    facts = build_case_facts(finding, "Northwind Supply", evidence)
    assert "served a live page" in render_body(facts, finding, evidence)

    finding.live = False
    body = render_body(facts, finding, evidence)
    assert "served no live page" in body
    assert "served a live page" not in body


def test_every_evidence_item_is_enumerated(db, finding):
    evidence = db.query(Evidence).all()
    facts = build_case_facts(finding, "Northwind Supply", evidence)
    body = render_body(facts, finding, evidence)
    for item in evidence:
        assert item.url in body
        assert f"`{item.engine}`" in body


def test_case_facts_round_trip_through_the_database(auth_client, finding, db):
    notice = draft(auth_client, finding)
    stored = json.loads(db.query(Notice).one().case_facts_json)
    assert stored == notice["caseFacts"]
