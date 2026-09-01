"""Domain availability and defensive registration (section 3.5). Two routes.

Every answer here comes from name.com. Nothing is guessed: if name.com cannot be
reached, the route says so rather than inventing a price or an availability flag.

A checked or registered domain is recorded in portfolio_domains, so /workspace/domains
only ever reports statuses that were actually measured.
"""

import logging
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from ..deps import CurrentUser, DbDep
from ..models import Activity, PortfolioDomain
from ..schemas import DomainOfferResponse, RegisterDomainRequest, RegisterDomainResponse
from ..security import utcnow
from ..services import namecom
from ..services.namecom import NamecomUnavailable

log = logging.getLogger("ceasefire.domains")

router = APIRouter(tags=["domains"])


def _upsert_portfolio(db, user_id: str, domain: str, **fields) -> PortfolioDomain:
    row = db.execute(
        select(PortfolioDomain).where(
            PortfolioDomain.user_id == user_id, PortfolioDomain.domain == domain
        )
    ).scalar_one_or_none()
    if row is None:
        row = PortfolioDomain(
            user_id=user_id, domain=domain, status="watchlist", first_seen=utcnow()
        )
        db.add(row)
    for key, value in fields.items():
        if value is not None:
            setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return row


@router.get("/domain/availability", response_model=DomainOfferResponse)
async def domain_availability(user: CurrentUser, db: DbDep, domain: str = Query(...)):
    name = domain.strip().lower()
    if not name or "." not in name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Enter a valid domain.")

    try:
        result = await namecom.check_availability(name)
    except NamecomUnavailable as exc:
        # Degrade gracefully — never fabricate availability or a price.
        log.warning("availability check failed for %s: %s", name, exc)
        return DomainOfferResponse(
            domain=name, available=False, price_usd=None, premium=False, reason=str(exc)
        )

    # Only now is "available" a measured fact, so only now is it recorded.
    if result["available"]:
        _upsert_portfolio(
            db, user.id, name, status="available", price_usd=result["price_usd"]
        )

    return DomainOfferResponse(
        domain=name,
        available=result["available"],
        price_usd=result["price_usd"],
        premium=result["premium"],
        reason=result["reason"],
    )


@router.post("/domain/register", response_model=RegisterDomainResponse)
async def register_domain(body: RegisterDomainRequest, user: CurrentUser, db: DbDep):
    name = body.domain.strip().lower()
    if not name or "." not in name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Enter a valid domain.")

    try:
        offer = await namecom.check_availability(name)
        if not offer["available"]:
            return RegisterDomainResponse(
                ok=False, reason=offer["reason"] or "Not available for registration."
            )
        result = await namecom.register(name, offer["price_usd"])
    except NamecomUnavailable as exc:
        log.warning("registration failed for %s: %s", name, exc)
        return RegisterDomainResponse(ok=False, reason=str(exc))

    expires_at = None
    if result.get("expires_at"):
        try:
            expires_at = datetime.fromisoformat(
                str(result["expires_at"]).replace("Z", "+00:00")
            )
        except ValueError:
            expires_at = None

    _upsert_portfolio(
        db,
        user.id,
        name,
        status="protected",
        registrar=result.get("registrar"),
        price_usd=offer["price_usd"],
        expires_at=expires_at,
    )
    db.add(
        Activity(
            user_id=user.id,
            kind="domain",
            text=f"{name} registered defensively through name.com"
            + ("" if namecom.is_sandbox() else " (PRODUCTION)"),
            emphasis=False,
            at=utcnow(),
        )
    )
    db.commit()
    log.info("registered %s order=%s", name, result["order_id"])
    return RegisterDomainResponse(ok=True, order_id=result["order_id"])
