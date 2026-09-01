"""Notice routes (section 3.4). Three routes, no more.

The review gate is a real state machine, not a UI convention:

    draft --approve--> reviewed --sign--> signed

`approve` rejects anything not in draft. `sign` rejects anything not in reviewed.
Both return 409. Nothing is ever delivered to a registrant by this system.
"""

import json
import logging

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from ..deps import CurrentUser, DbDep, owned_notice, owned_scan
from ..models import Evidence, Finding, Notice
from ..schemas import GenerateNoticeRequest, NoticeResponse
from ..security import as_utc, utcnow
from ..services import notice as notice_service
from ..services.notice import (
    STAGE_AWAITING_SIGNATURE,
    STAGE_DRAFT,
    STAGE_SIGNED,
    STAGE_TO_STATE,
)

log = logging.getLogger("ceasefire.notices")

router = APIRouter(tags=["notices"])


def _to_response(row: Notice) -> NoticeResponse:
    state = STAGE_TO_STATE[row.stage]
    return NoticeResponse(
        id=row.id,
        finding_id=row.finding_id,
        domain=row.domain,
        case_facts=json.loads(row.case_facts_json),
        body_markdown=row.body_markdown,
        state=state,
        reviewed=state in ("reviewed", "signed"),
        signed=state == "signed",
        signed_at=as_utc(row.signed_at),
        pdf_url=row.pdf_url,
        envelope_id=row.envelope_id,
    )


@router.post("/scan/{scan_id}/notice", response_model=NoticeResponse)
def generate_notice(
    body: GenerateNoticeRequest, scan: owned_scan, user: CurrentUser, db: DbDep
):
    # user_id filtered in the same query as the id (section 5.3).
    finding = db.execute(
        select(Finding).where(
            Finding.id == body.finding_id,
            Finding.scan_id == scan.id,
            Finding.user_id == user.id,
        )
    ).scalar_one_or_none()
    if finding is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Finding not found")

    # One notice per finding. Re-drafting must never reset a notice a person has
    # already reviewed or signed.
    existing = db.execute(
        select(Notice).where(Notice.finding_id == finding.id, Notice.user_id == user.id)
    ).scalar_one_or_none()
    if existing is not None:
        return _to_response(existing)

    evidence = list(
        db.execute(
            select(Evidence).where(Evidence.finding_id == finding.id).order_by(Evidence.id)
        ).scalars()
    )
    facts = notice_service.build_case_facts(finding, scan.brand, evidence)
    row = Notice(
        user_id=user.id,
        finding_id=finding.id,
        domain=finding.domain,
        tier=finding.tier,
        stage=STAGE_DRAFT,
        case_facts_json=json.dumps(facts),
        body_markdown=notice_service.render_body(facts, finding, evidence),
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    log.info("notice %s drafted for finding %s", row.id, finding.id)
    return _to_response(row)


@router.post("/notice/{notice_id}/approve", response_model=NoticeResponse)
def approve_notice(notice: owned_notice, db: DbDep):
    if notice.stage != STAGE_DRAFT:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Only a draft can be approved. This notice is {STAGE_TO_STATE[notice.stage]}.",
        )
    notice.stage = STAGE_AWAITING_SIGNATURE
    notice.updated_at = utcnow()
    db.commit()
    db.refresh(notice)
    log.info("notice %s approved", notice.id)
    return _to_response(notice)


@router.post("/notice/{notice_id}/sign", response_model=NoticeResponse)
def sign_notice(notice: owned_notice, db: DbDep):
    if notice.stage != STAGE_AWAITING_SIGNATURE:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A notice must be reviewed and approved before it can be signed. "
            f"This notice is {STAGE_TO_STATE[notice.stage]}.",
        )
    notice.stage = STAGE_SIGNED
    notice.signed_at = utcnow()
    # Foxit eSign arrives in Phase 7; until then the envelope is local and says so.
    notice.envelope_id = notice_service.synthetic_envelope_id(notice.id)
    notice.updated_at = utcnow()
    db.commit()
    db.refresh(notice)
    log.info("notice %s signed (envelope %s)", notice.id, notice.envelope_id)
    return _to_response(notice)
