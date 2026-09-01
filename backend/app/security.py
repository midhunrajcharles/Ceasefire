"""Password hashing, session tokens, and the auth rate limiter (section 5.1, 5.5).

Nothing here writes a raw token to the database: `sessions.token_hash` holds
sha256(cookie value), so a database dump yields no usable session.
"""

from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, VerifyMismatchError
from fastapi import Request
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session as DbSession

from .config import settings
from .models import AuthAttempt, Session as SessionRow, User

# Library defaults — never hand-tune, never write your own hashing.
_hasher = PasswordHasher()

# A hash to verify against when the email is unknown, so signin takes the same
# time whether or not the account exists.
_DUMMY_HASH = _hasher.hash("ceasefire-timing-equaliser")

# Mirrors the frontend regex in components/AuthScreen.tsx exactly.
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

# Mirrors FREE_MAIL_HOSTS in Frontend/lib/session.ts exactly — same fifteen hosts.
FREE_MAIL_HOSTS = frozenset(
    {
        "gmail.com",
        "googlemail.com",
        "yahoo.com",
        "outlook.com",
        "hotmail.com",
        "live.com",
        "icloud.com",
        "me.com",
        "proton.me",
        "protonmail.com",
        "aol.com",
        "gmx.com",
        "yandex.com",
        "mail.com",
        "zoho.com",
    }
)

FREE_MAIL_ERROR = "Use a work address — the domain you want to protect."
MIN_PASSWORD_LENGTH = 10


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(dt: datetime | None) -> datetime | None:
    """SQLite drops tzinfo on the way out. Stored values are always UTC."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ── Email rules ────────────────────────────────────────────────────────────


def normalise_email(email: str) -> str:
    return email.strip().lower()


def is_valid_email(email: str) -> bool:
    return bool(EMAIL_RE.match(email.strip()))


def is_free_mail(email: str) -> bool:
    return email.split("@")[-1].lower() in FREE_MAIL_HOSTS if "@" in email else False


# ── Passwords ──────────────────────────────────────────────────────────────


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    """Constant-ish time: with no hash, verify the dummy and still return False."""
    try:
        _hasher.verify(password_hash or _DUMMY_HASH, password)
    except (VerifyMismatchError, VerificationError):
        return False
    return password_hash is not None


# ── Session tokens ─────────────────────────────────────────────────────────


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def create_session(db: DbSession, user: User) -> str:
    """Mint an opaque token, store only its sha256, return the raw value once."""
    raw_token = secrets.token_urlsafe(32)
    row = SessionRow(
        user_id=user.id,
        token_hash=hash_token(raw_token),
        created_at=utcnow(),
        expires_at=utcnow() + timedelta(days=settings.session_ttl_days),
    )
    db.add(row)
    db.commit()
    return raw_token


def resolve_session(db: DbSession, raw_token: str | None) -> User | None:
    """Return the owning user, or None if the token is unknown, revoked or expired."""
    if not raw_token:
        return None
    row = db.execute(
        select(SessionRow).where(SessionRow.token_hash == hash_token(raw_token))
    ).scalar_one_or_none()
    if row is None or row.revoked_at is not None:
        return None
    if (as_utc(row.expires_at) or utcnow()) <= utcnow():
        return None
    return db.get(User, row.user_id)


def revoke_session(db: DbSession, raw_token: str | None) -> None:
    if not raw_token:
        return
    row = db.execute(
        select(SessionRow).where(SessionRow.token_hash == hash_token(raw_token))
    ).scalar_one_or_none()
    if row is not None and row.revoked_at is None:
        row.revoked_at = utcnow()
        db.commit()


# ── Rate limiting (section 5.5) ────────────────────────────────────────────


def attempt_key(request: Request, email: str) -> str:
    ip = request.client.host if request.client else "unknown"
    return f"{ip}:{email}"


def rate_limited(db: DbSession, key: str) -> bool:
    """True once AUTH_MAX_ATTEMPTS attempts already sit inside the window."""
    window_start = utcnow() - timedelta(minutes=settings.auth_window_minutes)
    count = db.execute(
        select(func.count())
        .select_from(AuthAttempt)
        .where(AuthAttempt.key == key, AuthAttempt.at >= window_start)
    ).scalar_one()
    return count >= settings.auth_max_attempts


def record_attempt(db: DbSession, key: str) -> None:
    db.add(AuthAttempt(key=key, at=utcnow()))
    db.commit()


def clear_attempts(db: DbSession, key: str) -> None:
    """A successful signin/signup releases the limit for that (ip, email)."""
    db.execute(delete(AuthAttempt).where(AuthAttempt.key == key))
    db.commit()
