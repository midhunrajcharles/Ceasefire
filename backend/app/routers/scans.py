"""Scan routes (section 3.3). Three routes, no more."""

import logging
from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from sqlalchemy import func, select

from ..config import settings
from ..deps import CurrentUser, DbDep, owned_scan
from ..models import Evidence, Finding, Scan, ScanEngine, SearchBudget
from ..schemas import (
    EngineStatusResponse,
    EvidenceResponse,
    FindingResponse,
    PrefilterStatsResponse,
    ScanBudgetResponse,
    ScanResponse,
    ScanSummaryResponse,
    StartScanRequest,
    StartScanResponse,
)
from ..security import as_utc, utcnow
from ..services.serpapi import ENGINES
from ..services.sweep import elapsed_ms, run_sweep

log = logging.getLogger("ceasefire.scans")

router = APIRouter(tags=["scans"])

SCANS_PER_HOUR = 5  # searches are the scarce resource (section 5.5)


def _budget(db, user_id: str) -> ScanBudgetResponse:
    row = db.execute(
        select(SearchBudget).where(
            SearchBudget.user_id == user_id,
            SearchBudget.period == utcnow().strftime("%Y-%m"),
        )
    ).scalar_one_or_none()
    return ScanBudgetResponse(
        total=settings.search_budget_total,
        spent=row.spent if row else 0,
        cache_hits=row.cache_hits if row else 0,
    )


def _engines(db, scan: Scan) -> list[EngineStatusResponse]:
    """All ten, in the fixed UI order, with label/purpose/headline from the constant."""
    rows = {
        row.engine_id: row
        for row in db.execute(
            select(ScanEngine).where(ScanEngine.scan_id == scan.id)
        ).scalars()
    }
    engines = []
    for meta in ENGINES:
        row = rows.get(meta["id"])
        engines.append(
            EngineStatusResponse(
                id=meta["id"],
                label=meta["label"],
                purpose=meta["purpose"],
                headline=meta["headline"],
                state=row.state if row else "idle",
                findings=row.findings_count if row else 0,
                searches_spent=row.searches_spent if row else 0,
                cache_hit=row.cache_hit if row else False,
                ms=row.ms if row else None,
            )
        )
    return engines


def _findings(db, scan: Scan) -> list[FindingResponse]:
    """Empty until the scan is complete — the frontend renders skeletons on that."""
    if scan.state != "complete":
        return []
    rows = list(
        db.execute(
            select(Finding).where(Finding.scan_id == scan.id).order_by(Finding.created_at)
        ).scalars()
    )
    evidence_by_finding: dict[str, list[Evidence]] = {}
    if rows:
        for row in db.execute(
            select(Evidence).where(Evidence.finding_id.in_([f.id for f in rows]))
        ).scalars():
            evidence_by_finding.setdefault(row.finding_id, []).append(row)

    tier_rank = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
    rows.sort(key=lambda f: (tier_rank.get(f.tier, 9), f.domain))

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
                    engine=e.engine,
                    url=e.url,
                    snippet=e.snippet,
                    fetched_at=as_utc(e.fetched_at),
                )
                for e in evidence_by_finding.get(f.id, [])
            ],
        )
        for f in rows
    ]


def _scan_response(db, scan: Scan) -> ScanResponse:
    return ScanResponse(
        id=scan.id,
        brand=scan.brand,
        domain=scan.domain,
        state=scan.state,
        prefilter=PrefilterStatsResponse(
            generated=scan.prefilter_generated,
            survived_dns=scan.prefilter_dns,
            mail_capable=scan.prefilter_mail,
            survived_http=scan.prefilter_http,
        ),
        engines=_engines(db, scan),
        findings=_findings(db, scan),
        budget=_budget(db, scan.user_id),
        started_at=as_utc(scan.started_at),
        completed_at=as_utc(scan.completed_at),
        elapsed_ms=elapsed_ms(scan.started_at, scan.completed_at),
        error=scan.error,
        is_mock=False,  # always false from the real backend
    )


@router.post("/scan", response_model=StartScanResponse, status_code=status.HTTP_202_ACCEPTED)
def start_scan(
    body: StartScanRequest,
    background: BackgroundTasks,
    user: CurrentUser,
    db: DbDep,
):
    brand = body.brand.strip()
    domain = body.domain.strip().lower()
    if not brand:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Brand is required.")
    if not domain or "." not in domain:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Enter a valid domain.")

    recent = db.execute(
        select(func.count())
        .select_from(Scan)
        .where(Scan.user_id == user.id, Scan.started_at >= utcnow() - timedelta(hours=1))
    ).scalar_one()
    if recent >= SCANS_PER_HOUR:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Scan limit reached ({SCANS_PER_HOUR} per hour). Searches are the scarce resource.",
        )

    scan = Scan(
        user_id=user.id,
        brand=brand,
        domain=domain,
        state="generating",
        started_at=utcnow(),
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)

    background.add_task(run_sweep, scan.id)
    log.info("scan %s queued for %s (%s)", scan.id, brand, domain)
    return StartScanResponse(id=scan.id)


@router.get("/scan/{scan_id}", response_model=ScanResponse)
def get_scan(scan: owned_scan, db: DbDep):
    return _scan_response(db, scan)


@router.get("/scans", response_model=list[ScanSummaryResponse])
def list_scans(user: CurrentUser, db: DbDep):
    scans = list(
        db.execute(
            select(Scan).where(Scan.user_id == user.id).order_by(Scan.started_at.desc())
        ).scalars()
    )
    if not scans:
        return []

    counts = dict(
        db.execute(
            select(Finding.scan_id, func.count())
            .where(Finding.scan_id.in_([s.id for s in scans]))
            .group_by(Finding.scan_id)
        ).all()
    )
    criticals = dict(
        db.execute(
            select(Finding.scan_id, func.count())
            .where(Finding.scan_id.in_([s.id for s in scans]), Finding.tier == "CRITICAL")
            .group_by(Finding.scan_id)
        ).all()
    )
    return [
        ScanSummaryResponse(
            id=s.id,
            brand=s.brand,
            domain=s.domain,
            completed_at=as_utc(s.completed_at),
            finding_count=counts.get(s.id, 0),
            critical_count=criticals.get(s.id, 0),
            searches_spent=s.searches_spent,
        )
        for s in scans
    ]
