"""Pydantic models for the wire.

Section 3.1: the frontend TypeScript is camelCase, Python is snake_case. Every
RESPONSE model inherits `ApiModel`, which serialises by camelCase alias. Request
bodies stay as the frontend already sends them (snake_case) and use plain
`BaseModel`.

Section 5.6: no secret ever appears in a response schema. Response models are built
field-by-field; an ORM object is never serialised wholesale.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


# ── Requests ───────────────────────────────────────────────────────────────


class SignupRequest(BaseModel):
    email: str
    password: str
    organisation: str


class SigninRequest(BaseModel):
    email: str
    password: str


# ── Responses ──────────────────────────────────────────────────────────────


class SessionResponse(ApiModel):
    """Mirrors `Session` in Frontend/lib/session.ts: {email, organisation, createdAt}."""

    email: str
    organisation: str
    created_at: datetime


# ── Scans ──────────────────────────────────────────────────────────────────


class StartScanRequest(BaseModel):
    brand: str
    domain: str


class StartScanResponse(ApiModel):
    id: str


class EvidenceResponse(ApiModel):
    engine: str
    url: str
    snippet: str
    fetched_at: datetime


class FindingResponse(ApiModel):
    id: str
    domain: str
    tier: str
    reason: str
    technique: str | None = None
    mail_capable: bool
    live: bool
    registered: bool
    ai_overview_cited: bool
    evidence: list[EvidenceResponse] = []


class EngineStatusResponse(ApiModel):
    id: str
    label: str
    purpose: str
    headline: bool = False
    state: str
    findings: int
    searches_spent: int
    cache_hit: bool
    ms: int | None = None


class PrefilterStatsResponse(ApiModel):
    generated: int
    survived_dns: int
    mail_capable: int
    survived_http: int


class ScanBudgetResponse(ApiModel):
    total: int
    spent: int
    cache_hits: int


class ScanResponse(ApiModel):
    id: str
    brand: str
    domain: str
    state: str
    prefilter: PrefilterStatsResponse
    engines: list[EngineStatusResponse]
    findings: list[FindingResponse]
    budget: ScanBudgetResponse
    started_at: datetime | None = None
    completed_at: datetime | None = None
    elapsed_ms: int | None = None
    error: str | None = None
    is_mock: bool = False


class ScanSummaryResponse(ApiModel):
    id: str
    brand: str
    domain: str
    completed_at: datetime | None = None
    finding_count: int
    critical_count: int
    searches_spent: int


# ── Notices ────────────────────────────────────────────────────────────────


class GenerateNoticeRequest(BaseModel):
    """The frontend sends snake_case here — see generateNotice in lib/api.ts."""

    finding_id: str


class NoticeResponse(ApiModel):
    id: str
    finding_id: str
    domain: str
    case_facts: dict[str, str]
    body_markdown: str
    state: str
    reviewed: bool
    signed: bool
    signed_at: datetime | None = None
    pdf_url: str | None = None
    envelope_id: str | None = None


# ── Domains ────────────────────────────────────────────────────────────────


class DomainOfferResponse(ApiModel):
    domain: str
    available: bool
    price_usd: float | None = None
    premium: bool = False
    reason: str | None = None


class RegisterDomainRequest(BaseModel):
    domain: str


class RegisterDomainResponse(ApiModel):
    ok: bool
    order_id: str | None = None
    reason: str | None = None


# ── Workspace aggregates ───────────────────────────────────────────────────


class WorkspaceStats(ApiModel):
    open_criticals: int
    hostile_domains: int
    notices_in_flight: int


class TrendPoint(ApiModel):
    label: str
    critical: int
    high: int
    medium: int
    low: int


class ActivityEvent(ApiModel):
    id: str
    at: datetime
    kind: str
    text: str
    emphasis: bool = False


class WorkspaceOverview(ApiModel):
    stats: WorkspaceStats
    trend: list[TrendPoint]
    activity: list[ActivityEvent]


class NoticeRecord(ApiModel):
    id: str
    domain: str
    tier: str
    stage: str
    created_at: datetime
    updated_at: datetime
    registrar: str | None = None


class PortfolioDomainResponse(ApiModel):
    domain: str
    status: str
    technique: str | None = None
    registrar: str | None = None
    expires_at: datetime | None = None
    price_usd: float | None = None
    mail_capable: bool = False
    first_seen: datetime


class SurfaceStat(ApiModel):
    id: str
    findings_all_time: int
    searches_spent: int
    avg_ms: int
    cache_hit_rate: float


class IntegrationStatus(ApiModel):
    """Whether a third-party service is actually configured on this deployment.

    Section 1, Honesty: `connected` reflects the presence of credentials in settings,
    never a hardcoded claim. A missing key reports `not_configured`.
    """

    name: str
    role: str
    status: str  # "connected" | "not_configured"
    detail: str
