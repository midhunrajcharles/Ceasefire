"""Request dependencies: the signed-in user, and owned-resource loaders.

Section 5.3 — the IDOR rule: owned-resource loaders filter on `user_id` in the same
query as the id, and return 404 (never 403) so an id is never confirmed to exist.
Loaders for scans, findings and notices arrive with their phases.
"""

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session as DbSession

from .config import settings
from .db import get_db
from .models import Notice, Scan, User
from .security import resolve_session

DbDep = Annotated[DbSession, Depends(get_db)]


def current_user(request: Request, db: DbDep) -> User:
    token = request.cookies.get(settings.session_cookie_name)
    user = resolve_session(db, token)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


def get_owned_scan(scan_id: str, user: CurrentUser, db: DbDep) -> Scan:
    """Load a scan the caller owns. 404 — never 403 — so an id is never confirmed."""
    scan = db.query(Scan).filter(Scan.id == scan_id, Scan.user_id == user.id).first()
    if scan is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Scan not found")
    return scan


owned_scan = Annotated[Scan, Depends(get_owned_scan)]


def get_owned_notice(notice_id: str, user: CurrentUser, db: DbDep) -> Notice:
    """Load a notice the caller owns. 404, never 403."""
    notice = db.query(Notice).filter(Notice.id == notice_id, Notice.user_id == user.id).first()
    if notice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notice not found")
    return notice


owned_notice = Annotated[Notice, Depends(get_owned_notice)]
