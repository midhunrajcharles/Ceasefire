"""Workspace aggregates (section 3.6). Six routes, every number computed from rows.

Section 1, Honesty: every figure returned here is a COUNT, SUM or AVERAGE over stored
rows belonging to the signed-in user. Nothing is seeded, estimated or carried over from
the frontend's static fixtures.

Section 5.3, the IDOR rule: every query below filters on `user_id`. A second user with
no data gets zeroes and empty lists, never someone else's rows.
"""

import logging
from datetime import timedelta

from fastapi import APIRouter
from sqlalchemy import Integer, func, select

from ..config import settings
from ..deps import CurrentUser, DbDep
from ..models import (
    Activity,
    Evidence,
    Finding,
    Notice,
    PortfolioDomain,
    Scan,
    ScanEngine,
    SearchBudget,
)
from ..schemas import (
    ActivityEvent,
    EvidenceResponse,
    FindingResponse,
    IntegrationStatus,
    NoticeRecord,
    PortfolioDomainResponse,
    ScanBudgetResponse,
    SurfaceStat,
    TrendPoint,
    WorkspaceOverview,
    WorkspaceStats,
)
from ..security import as_utc, utcnow
from ..services.serpapi import ENGINES

log = logging.getLogger("ceasefire.workspace")

router = APIRouter(prefix="/workspace", tags=["workspace"])

TREND_WEEKS = 6
ACTIVITY_LIMIT = 25
# "In flight" means a person still has work to do on it.
IN_FLIGHT_STAGES = ("draft", "awaiting_signature", "signed", "delivered")


@router.get("/overview", response_model=WorkspaceOverview)
def overview(user: CurrentUser, db: DbDep):
    resolved_domains = set(
        db.execute(
            select(Notice.domain).where(Notice.user_id == user.id, Notice.stage == "resolved")
        ).scalars()
    )
    criticals = list(
        db.execute(
            select(Finding.domain).where(
                Finding.user_id == user.id, Finding.tier == "CRITICAL"
            )
        ).scalars()
    )
    open_criticals = len({d for d in criticals} - resolved_domains)

    hostile = db.execute(
        select(func.count())
        .select_from(PortfolioDomain)
        .where(PortfolioDomain.user_id == user.id, PortfolioDomain.status == "hostile")
    ).scalar_one()

    in_flight = db.execute(
        select(func.count())
        .select_from(Notice)
        .where(Notice.user_id == user.id, Notice.stage.in_(IN_FLIGHT_STAGES))
    ).scalar_one()

    # Trend: six weekly buckets, oldest first, counted from findings.created_at.
    now = utcnow()
    findings = list(
        db.execute(
            select(Finding.tier, Finding.created_at).where(
                Finding.user_id == user.id,
                Finding.created_at >= now - timedelta(weeks=TREND_WEEKS),
            )
        ).all()
    )
    buckets = [{"critical": 0, "high": 0, "medium": 0, "low": 0} for _ in range(TREND_WEEKS)]
    for tier, created_at in findings:
        created = as_utc(created_at)
        if created is None:
            continue
        weeks_ago = int((now - created).total_seconds() // (7 * 86400))
        index = TREND_WEEKS - 1 - min(weeks_ago, TREND_WEEKS - 1)
        key = tier.lower()
        if key in buckets[index]:
            buckets[index][key] += 1

    trend = [
        TrendPoint(label=f"Wk {i + 1}", **bucket) for i, bucket in enumerate(buckets)
    ]

    activity = [
        ActivityEvent(
            id=str(row.id), at=as_utc(row.at), kind=row.kind, text=row.text,
            emphasis=row.emphasis,
        )
        for row in db.execute(
            select(Activity)
            .where(Activity.user_id == user.id)
            .order_by(Activity.at.desc(), Activity.id.desc())
            .limit(ACTIVITY_LIMIT)
        ).scalars()
    ]

    return WorkspaceOverview(
        stats=WorkspaceStats(
            open_criticals=open_criticals,
            hostile_domains=hostile,
            notices_in_flight=in_flight,
        ),
        trend=trend,
        activity=activity,
    )


@router.get("/findings", response_model=list[FindingResponse])
def workspace_findings(user: CurrentUser, db: DbDep):
    rows = list(
        db.execute(
            select(Finding)
            .where(Finding.user_id == user.id)
            .order_by(Finding.created_at.desc())
        ).scalars()
    )
    if not rows:
        return []

    evidence_by_finding: dict[str, list[Evidence]] = {}
    for item in db.execute(
        select(Evidence).where(Evidence.finding_id.in_([f.id for f in rows]))
    ).scalars():
        evidence_by_finding.setdefault(item.finding_id, []).append(item)

    return [
        FindingResponse(
            id=f.id,
            domain=f.domain,
            tier=f.tier,
            reason=f.reason,
            technique=f.technique,
            mail_capable=f.mail_capable,
            live=f.live,
            registered=f.registered,
            ai_overview_cited=f.ai_overview_cited,
            evidence=[
                EvidenceResponse(
                    engine=e.engine, url=e.url, snippet=e.snippet,
                    fetched_at=as_utc(e.fetched_at),
                )
                for e in evidence_by_finding.get(f.id, [])
            ],
        )
        for f in rows
    ]


@router.get("/notices", response_model=list[NoticeRecord])
def workspace_notices(user: CurrentUser, db: DbDep):
    return [
        NoticeRecord(
            id=row.id,
            domain=row.domain,
            tier=row.tier,
            stage=row.stage,
            created_at=as_utc(row.created_at),
            updated_at=as_utc(row.updated_at),
            registrar=row.registrar,
        )
        for row in db.execute(
            select(Notice)
            .where(Notice.user_id == user.id)
            .order_by(Notice.updated_at.desc())
        ).scalars()
    ]


@router.get("/domains", response_model=list[PortfolioDomainResponse])
def workspace_domains(user: CurrentUser, db: DbDep):
    return [
        PortfolioDomainResponse(
            domain=row.domain,
            status=row.status,
            technique=row.technique,
            registrar=row.registrar,
            expires_at=as_utc(row.expires_at),
            price_usd=float(row.price_usd) if row.price_usd is not None else None,
            mail_capable=row.mail_capable,
            first_seen=as_utc(row.first_seen),
        )
        for row in db.execute(
            select(PortfolioDomain)
            .where(PortfolioDomain.user_id == user.id)
            .order_by(PortfolioDomain.first_seen.desc())
        ).scalars()
    ]


@router.get("/surfaces", response_model=list[SurfaceStat])
def workspace_surfaces(user: CurrentUser, db: DbDep):
    """Per-engine totals across every scan this user has run.

    All ten engines are always returned, in the fixed UI order. An engine this user
    has never run reports zeroes — which is the truth, not a gap.
    """
    rows = db.execute(
        select(
            ScanEngine.engine_id,
            func.sum(ScanEngine.findings_count),
            func.sum(ScanEngine.searches_spent),
            func.avg(ScanEngine.ms),
            func.sum(func.cast(ScanEngine.cache_hit, Integer)),
            func.count(),
        )
        .join(Scan, Scan.id == ScanEngine.scan_id)
        .where(Scan.user_id == user.id)
        .group_by(ScanEngine.engine_id)
    ).all()
    by_engine = {r[0]: r for r in rows}

    stats = []
    for meta in ENGINES:
        row = by_engine.get(meta["id"])
        if row is None:
            stats.append(
                SurfaceStat(
                    id=meta["id"], findings_all_time=0, searches_spent=0,
                    avg_ms=0, cache_hit_rate=0.0,
                )
            )
            continue
        _, findings, searches, avg_ms, cache_hits, total = row
        stats.append(
            SurfaceStat(
                id=meta["id"],
                findings_all_time=int(findings or 0),
                searches_spent=int(searches or 0),
                avg_ms=int(avg_ms or 0),
                cache_hit_rate=round((cache_hits or 0) / total, 2) if total else 0.0,
            )
        )
    return stats


@router.get("/budget", response_model=ScanBudgetResponse)
def workspace_budget(user: CurrentUser, db: DbDep):
    row = db.execute(
        select(SearchBudget).where(
            SearchBudget.user_id == user.id,
            SearchBudget.period == utcnow().strftime("%Y-%m"),
        )
    ).scalar_one_or_none()
    return ScanBudgetResponse(
        total=settings.search_budget_total,
        spent=row.spent if row else 0,
        cache_hits=row.cache_hits if row else 0,
    )


@router.get("/integrations", response_model=list[IntegrationStatus])
def workspace_integrations(user: CurrentUser):
    """What is actually wired up on this deployment.

    Section 1, Honesty: each row is read from settings at request time. A service
    with no credentials reports `not_configured` rather than claiming a connection
    the deployment cannot make.
    """
    def state(configured: bool) -> str:
        return "connected" if configured else "not_configured"

    serp = bool(settings.serpapi_key.strip())

    return [
        IntegrationStatus(
            name="SerpApi",
            role="Ten search surfaces",
            status=state(serp),
            detail=(
                f"{settings.search_budget_total} searches/month · "
                f"{settings.serpapi_rate_per_hour}/hour"
                if serp
                else "SERPAPI_KEY not set — sweeps cannot run"
            ),
        ),
        IntegrationStatus(
            name="Database",
            role="Scans, findings, cache, audit trail",
            status="connected",
            detail=f"{settings.database_url.split('://', 1)[0]} · "
            f"{settings.serp_cache_ttl_hours}h result cache",
        ),
    ]
