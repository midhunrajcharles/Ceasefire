"""Auth routes (section 3.2). Four routes, no more.

No password reset, no email verification, no OAuth — section 9 puts all of those
out of scope.
"""

import logging

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select

from ..config import settings
from ..deps import CurrentUser, DbDep
from ..models import User
from ..schemas import SessionResponse, SigninRequest, SignupRequest
from ..security import (
    FREE_MAIL_ERROR,
    MIN_PASSWORD_LENGTH,
    as_utc,
    attempt_key,
    clear_attempts,
    create_session,
    hash_password,
    is_free_mail,
    is_valid_email,
    normalise_email,
    rate_limited,
    record_attempt,
    revoke_session,
    utcnow,
    verify_password,
)

log = logging.getLogger("ceasefire.auth")

router = APIRouter(prefix="/auth", tags=["auth"])

TOO_MANY = "Too many attempts. Try again later."
BAD_CREDENTIALS = "Incorrect email or password."


def _session_payload(user: User) -> SessionResponse:
    # Field-by-field (section 5.6) — password_hash can never ride along.
    return SessionResponse(
        email=user.email,
        organisation=user.organisation,
        created_at=as_utc(user.created_at) or utcnow(),
    )


def _set_session_cookie(response: Response, raw_token: str) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=raw_token,
        httponly=True,
        samesite="lax",
        secure=settings.is_production,
        max_age=settings.session_ttl_days * 24 * 60 * 60,
        path="/",
    )


def _guard_rate_limit(db, key: str) -> None:
    if rate_limited(db, key):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, TOO_MANY)
    record_attempt(db, key)


@router.post("/signup", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
def signup(body: SignupRequest, request: Request, response: Response, db: DbDep):
    email = normalise_email(body.email)
    _guard_rate_limit(db, attempt_key(request, email))

    if not is_valid_email(email):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Enter a valid email address.")
    if is_free_mail(email):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, FREE_MAIL_ERROR)
    if len(body.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"At least {MIN_PASSWORD_LENGTH} characters."
        )
    organisation = body.organisation.strip()
    if not organisation:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Organisation is required.")

    exists = db.execute(select(User.id).where(User.email == email)).first()
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "That email is already registered.")

    user = User(
        email=email,
        password_hash=hash_password(body.password),
        organisation=organisation,
        created_at=utcnow(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    clear_attempts(db, attempt_key(request, email))
    _set_session_cookie(response, create_session(db, user))
    log.info("signup ok user=%s", user.id)
    return _session_payload(user)


@router.post("/signin", response_model=SessionResponse)
def signin(body: SigninRequest, request: Request, response: Response, db: DbDep):
    email = normalise_email(body.email)
    key = attempt_key(request, email)
    _guard_rate_limit(db, key)

    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    # Verify either way, so an unknown email costs the same time as a wrong password,
    # then answer with the same generic 401 for both (section 3.2).
    password_ok = verify_password(user.password_hash if user else None, body.password)
    if user is None or not password_ok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, BAD_CREDENTIALS)

    clear_attempts(db, key)
    _set_session_cookie(response, create_session(db, user))
    log.info("signin ok user=%s", user.id)
    return _session_payload(user)


@router.post("/signout", status_code=status.HTTP_204_NO_CONTENT)
def signout(request: Request, response: Response, db: DbDep) -> None:
    # Revoke the row AND clear the cookie — a revoked token must fail immediately.
    revoke_session(db, request.cookies.get(settings.session_cookie_name))
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        httponly=True,
        samesite="lax",
        secure=settings.is_production,
    )


@router.get("/me", response_model=SessionResponse)
def me(user: CurrentUser):
    return _session_payload(user)
