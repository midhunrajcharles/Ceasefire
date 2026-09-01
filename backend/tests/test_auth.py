"""Auth routes end to end (section 3.2).

Two things this file is really guarding. First, that a password or a session token
never appears in a response body — section 5.6. Second, that signing out revokes the
row server-side rather than merely clearing the cookie, so a copied token dies too.
"""

from datetime import timedelta

import pytest
from sqlalchemy import select

from app.config import settings
from app.models import AuthAttempt, Session as SessionRow, User
from app.security import hash_token, utcnow

GOOD_PASSWORD = "correct-horse-battery"
SIGNUP = {
    "email": "dana@vantage-labs.co",
    "password": GOOD_PASSWORD,
    "organisation": "Vantage Labs",
}


def cookie(response):
    return response.cookies.get(settings.session_cookie_name)


# ── Signup ─────────────────────────────────────────────────────────────────


def test_signup_creates_the_user_and_sets_a_session_cookie(client, db):
    response = client.post("/auth/signup", json=SIGNUP)

    assert response.status_code == 201
    assert cookie(response)
    body = response.json()
    assert body["email"] == "dana@vantage-labs.co"
    assert body["organisation"] == "Vantage Labs"
    assert db.execute(
        select(User).where(User.email == "dana@vantage-labs.co")
    ).scalar_one_or_none()


def test_signup_response_carries_no_password_and_no_token(client):
    """Section 5.6 — the response is built field by field, never from the ORM row."""
    body = client.post("/auth/signup", json=SIGNUP).json()

    assert set(body) == {"email", "organisation", "createdAt"}
    serialised = str(body)
    assert GOOD_PASSWORD not in serialised
    for forbidden in ("password", "hash", "token", "secret"):
        assert forbidden not in serialised.lower()


def test_signup_stores_a_hash_never_the_password(client, db):
    client.post("/auth/signup", json=SIGNUP)
    row = db.execute(select(User).where(User.email == SIGNUP["email"])).scalar_one()

    assert row.password_hash != GOOD_PASSWORD
    assert row.password_hash.startswith("$argon2")


def test_email_is_normalised_before_storage(client, db):
    client.post("/auth/signup", json={**SIGNUP, "email": "  Dana@Vantage-Labs.CO  "})

    assert db.execute(
        select(User).where(User.email == "dana@vantage-labs.co")
    ).scalar_one_or_none()


@pytest.mark.parametrize("host", ["gmail.com", "outlook.com", "proton.me", "zoho.com"])
def test_free_mail_is_refused(client, host):
    response = client.post("/auth/signup", json={**SIGNUP, "email": f"dana@{host}"})

    assert response.status_code == 400
    assert "work address" in response.json()["detail"]


def test_password_below_the_minimum_is_refused(client):
    response = client.post("/auth/signup", json={**SIGNUP, "password": "short123"})

    assert response.status_code == 400
    assert "10 characters" in response.json()["detail"]


def test_organisation_is_required(client):
    response = client.post("/auth/signup", json={**SIGNUP, "organisation": "   "})

    assert response.status_code == 400


def test_duplicate_email_is_409(client):
    client.post("/auth/signup", json=SIGNUP)
    response = client.post("/auth/signup", json=SIGNUP)

    assert response.status_code == 409


# ── Signin ─────────────────────────────────────────────────────────────────


def test_signin_with_the_right_password_sets_a_cookie(client, user):
    response = client.post(
        "/auth/signin",
        json={"email": user.email, "password": GOOD_PASSWORD},
    )

    assert response.status_code == 200
    assert cookie(response)
    assert response.json()["email"] == user.email


def test_wrong_password_and_unknown_email_give_the_same_401(client, user):
    """Identical answers, so the response never confirms an email exists."""
    wrong = client.post(
        "/auth/signin", json={"email": user.email, "password": "wrong-password-here"}
    )
    unknown = client.post(
        "/auth/signin", json={"email": "nobody@vantage-labs.co", "password": GOOD_PASSWORD}
    )

    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["detail"] == unknown.json()["detail"]


def test_the_cookie_is_httponly_and_not_the_stored_value(client, user, db):
    response = client.post(
        "/auth/signin", json={"email": user.email, "password": GOOD_PASSWORD}
    )
    raw = cookie(response)

    assert "httponly" in response.headers["set-cookie"].lower()
    # Only the sha256 is persisted; the raw token exists solely in the cookie.
    assert db.execute(
        select(SessionRow).where(SessionRow.token_hash == raw)
    ).scalar_one_or_none() is None
    assert db.execute(
        select(SessionRow).where(SessionRow.token_hash == hash_token(raw))
    ).scalar_one()


# ── Session resolution ─────────────────────────────────────────────────────


def test_me_returns_the_signed_in_user(auth_client, user):
    response = auth_client.get("/auth/me")

    assert response.status_code == 200
    assert response.json()["email"] == user.email


def test_me_without_a_cookie_is_401(client):
    assert client.get("/auth/me").status_code == 401


def test_me_with_a_garbage_cookie_is_401(client):
    client.cookies.set(settings.session_cookie_name, "not-a-real-token")

    assert client.get("/auth/me").status_code == 401


def test_an_expired_session_is_401(client, db, user):
    from app.security import create_session

    raw = create_session(db, user)
    row = db.execute(
        select(SessionRow).where(SessionRow.token_hash == hash_token(raw))
    ).scalar_one()
    row.expires_at = utcnow() - timedelta(seconds=1)
    db.commit()

    client.cookies.set(settings.session_cookie_name, raw)
    assert client.get("/auth/me").status_code == 401


# ── Signout ────────────────────────────────────────────────────────────────


def test_signout_revokes_the_row_not_just_the_cookie(client, db, user):
    """A token copied out of the browser must stop working the moment you sign out."""
    from app.security import create_session

    raw = create_session(db, user)
    client.cookies.set(settings.session_cookie_name, raw)
    assert client.get("/auth/me").status_code == 200

    assert client.post("/auth/signout").status_code == 204

    # Re-present the same raw token as if it had been copied elsewhere.
    client.cookies.set(settings.session_cookie_name, raw)
    assert client.get("/auth/me").status_code == 401
    row = db.execute(
        select(SessionRow).where(SessionRow.token_hash == hash_token(raw))
    ).scalar_one()
    assert row.revoked_at is not None


def test_signout_without_a_session_is_still_204(client):
    assert client.post("/auth/signout").status_code == 204


# ── Rate limiting (section 5.5) ────────────────────────────────────────────


def test_repeated_failures_are_throttled(client, user):
    for _ in range(settings.auth_max_attempts):
        client.post("/auth/signin", json={"email": user.email, "password": "nope-nope-nope"})

    response = client.post(
        "/auth/signin", json={"email": user.email, "password": "nope-nope-nope"}
    )

    assert response.status_code == 429
    assert "Try again later" in response.json()["detail"]


def test_the_limit_survives_a_correct_password(client, user):
    """Guessing until the lock, then landing the right password, must still be refused."""
    for _ in range(settings.auth_max_attempts):
        client.post("/auth/signin", json={"email": user.email, "password": "nope-nope-nope"})

    response = client.post(
        "/auth/signin", json={"email": user.email, "password": GOOD_PASSWORD}
    )

    assert response.status_code == 429


def test_a_successful_signin_clears_the_attempt_rows(client, db, user):
    client.post("/auth/signin", json={"email": user.email, "password": "wrong-one-here"})
    client.post("/auth/signin", json={"email": user.email, "password": GOOD_PASSWORD})

    remaining = db.execute(select(AuthAttempt)).scalars().all()
    assert remaining == []


def test_throttling_is_per_email_not_global(client, db, user):
    from app.security import hash_password

    other = User(
        email="eve@vantage-labs.co",
        password_hash=hash_password(GOOD_PASSWORD),
        organisation="Vantage Labs",
        created_at=utcnow(),
    )
    db.add(other)
    db.commit()

    for _ in range(settings.auth_max_attempts):
        client.post("/auth/signin", json={"email": user.email, "password": "nope-nope-nope"})

    # A different email from the same IP is unaffected.
    response = client.post(
        "/auth/signin", json={"email": other.email, "password": GOOD_PASSWORD}
    )
    assert response.status_code == 200
