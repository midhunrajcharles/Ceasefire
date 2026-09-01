"""The twelve tables from section 4 of CEASEFIRE_BUILD_PROMPT.md. No more.

Every user-owned row carries `user_id`, and every read filters on it (section 5.3).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


TS = DateTime(timezone=True)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)  # lowercased
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)  # argon2
    organisation: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False, default=_now)

    sessions: Mapped[list["Session"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # sha256 of the cookie value; the raw token is never stored
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False, default=_now)
    expires_at: Mapped[datetime] = mapped_column(TS, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)

    user: Mapped["User"] = relationship(back_populates="sessions")

    __table_args__ = (
        Index("ix_sessions_token_hash", "token_hash"),
        Index("ix_sessions_user_id", "user_id"),
    )


class Scan(Base):
    __tablename__ = "scans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    brand: Mapped[str] = mapped_column(String(255), nullable=False)
    domain: Mapped[str] = mapped_column(String(255), nullable=False)
    # generating | prefiltering | sweeping | scoring | complete | error
    state: Mapped[str] = mapped_column(String(32), nullable=False)
    prefilter_generated: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    prefilter_dns: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    prefilter_mail: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    prefilter_http: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    searches_spent: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_hits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(TS, nullable=False, default=_now)
    completed_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)

    engines: Mapped[list["ScanEngine"]] = relationship(
        back_populates="scan", cascade="all, delete-orphan"
    )
    findings: Mapped[list["Finding"]] = relationship(
        back_populates="scan", cascade="all, delete-orphan"
    )

    __table_args__ = (Index("ix_scans_user_started", "user_id", started_at.desc()),)


class ScanEngine(Base):
    __tablename__ = "scan_engines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scan_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("scans.id", ondelete="CASCADE"), nullable=False
    )
    engine_id: Mapped[str] = mapped_column(String(64), nullable=False)  # 'google', ...
    position: Mapped[int] = mapped_column(Integer, nullable=False)  # fixed UI order
    state: Mapped[str] = mapped_column(String(32), nullable=False)
    findings_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    searches_spent: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_hit: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    scan: Mapped["Scan"] = relationship(back_populates="engines")


class Finding(Base):
    __tablename__ = "findings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    scan_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("scans.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    domain: Mapped[str] = mapped_column(String(255), nullable=False)
    tier: Mapped[str] = mapped_column(String(16), nullable=False)  # CRITICAL|HIGH|MEDIUM|LOW
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    technique: Mapped[str | None] = mapped_column(String(64), nullable=True)
    mail_capable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    live: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    registered: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ai_overview_cited: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False, default=_now)

    scan: Mapped["Scan"] = relationship(back_populates="findings")
    evidence: Mapped[list["Evidence"]] = relationship(
        back_populates="finding", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_findings_scan_id", "scan_id"),
        Index("ix_findings_user_id", "user_id"),
    )


class Evidence(Base):
    __tablename__ = "evidence"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    finding_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("findings.id", ondelete="CASCADE"), nullable=False
    )
    engine: Mapped[str] = mapped_column(String(64), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    snippet: Mapped[str] = mapped_column(Text, nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(TS, nullable=False, default=_now)

    finding: Mapped["Finding"] = relationship(back_populates="evidence")


class Notice(Base):
    __tablename__ = "notices"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    finding_id: Mapped[str] = mapped_column(String(36), ForeignKey("findings.id"), nullable=False)
    domain: Mapped[str] = mapped_column(String(255), nullable=False)
    tier: Mapped[str] = mapped_column(String(16), nullable=False)
    # draft | awaiting_signature | signed | delivered | resolved
    stage: Mapped[str] = mapped_column(String(32), nullable=False)
    case_facts_json: Mapped[str] = mapped_column(Text, nullable=False)
    body_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    registrar: Mapped[str | None] = mapped_column(String(255), nullable=True)
    envelope_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    pdf_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    signed_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False, default=_now)
    updated_at: Mapped[datetime] = mapped_column(TS, nullable=False, default=_now, onupdate=_now)

    __table_args__ = (Index("ix_notices_user_updated", "user_id", updated_at.desc()),)


class PortfolioDomain(Base):
    __tablename__ = "portfolio_domains"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    domain: Mapped[str] = mapped_column(String(255), nullable=False)
    # protected | hostile | watchlist | available
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    technique: Mapped[str | None] = mapped_column(String(64), nullable=True)
    registrar: Mapped[str | None] = mapped_column(String(255), nullable=True)
    price_usd: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    mail_capable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    expires_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    first_seen: Mapped[datetime] = mapped_column(TS, nullable=False, default=_now)

    __table_args__ = (UniqueConstraint("user_id", "domain", name="uq_portfolio_user_domain"),)


class SerpCache(Base):
    """Shared across users: a search result is not private data, and this cache is what
    makes 250 searches/month survivable. Findings derived from it ARE per-user."""

    __tablename__ = "serp_cache"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    engine: Mapped[str] = mapped_column(String(64), nullable=False)
    params_hash: Mapped[str] = mapped_column(String(64), nullable=False)  # sha256(engine+params)
    response_json: Mapped[str] = mapped_column(Text, nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(TS, nullable=False, default=_now)
    hit_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (UniqueConstraint("engine", "params_hash", name="uq_serp_cache_key"),)


class SearchBudget(Base):
    __tablename__ = "search_budget"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    period: Mapped[str] = mapped_column(String(7), nullable=False)  # 'YYYY-MM'
    spent: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_hits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (UniqueConstraint("user_id", "period", name="uq_budget_user_period"),)


class Activity(Base):
    __tablename__ = "activity"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    # sweep | finding | notice | domain | system
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    emphasis: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    at: Mapped[datetime] = mapped_column(TS, nullable=False, default=_now)

    __table_args__ = (Index("ix_activity_user_at", "user_id", at.desc()),)


class AuthAttempt(Base):
    __tablename__ = "auth_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(400), nullable=False)  # ip + ':' + email
    at: Mapped[datetime] = mapped_column(TS, nullable=False, default=_now)

    __table_args__ = (Index("ix_auth_attempts_key_at", "key", "at"),)
