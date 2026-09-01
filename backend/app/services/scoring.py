"""Risk tiering (section 7.3).

This is a DOCUMENTED HEURISTIC, not a model, and the API says so. There is no
confidence score here because there is no measurement that would justify one, and
no false-positive rate because none has been established.

| Tier     | Trigger                                                        |
|----------|----------------------------------------------------------------|
| CRITICAL | Cited in AI Overview or AI Mode for brand queries               |
| HIGH     | Live page AND MX records present (mail-capable)                 |
| HIGH     | App-store listing using the brand name or logo                  |
| MEDIUM   | Local-pack listing, or counterfeit commerce listing             |
| LOW      | Registered and parked, or unregistered                          |
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # avoid a circular import at runtime
    from .sweep import Hit

from .prefilter import PrefilterResult

CRITICAL = "CRITICAL"
HIGH = "HIGH"
MEDIUM = "MEDIUM"
LOW = "LOW"

TIER_ORDER = [CRITICAL, HIGH, MEDIUM, LOW]

AI_ENGINES = ("google_ai_overview", "google_ai_mode")
APP_STORE_ENGINES = ("google_play", "apple_app_store")
COMMERCE_ENGINES = ("google_shopping",)
LOCAL_ENGINES = ("google_maps",)

# The heuristic, stated in the words the API returns. Kept here so the tier and the
# sentence explaining it can never drift apart.
TIER_DEFINITION = {
    CRITICAL: "Cited in Google's AI Overview or AI Mode as a source for the brand",
    HIGH: "Live page with MX records configured, or an app-store listing using the brand",
    MEDIUM: "Local-pack listing or counterfeit commerce listing",
    LOW: "Registered and parked, or unregistered — a defensive-registration candidate",
}


@dataclass
class ScoredFinding:
    domain: str
    tier: str
    reason: str
    technique: str | None
    mail_capable: bool
    live: bool
    registered: bool
    ai_overview_cited: bool
    evidence: list["Hit"] = field(default_factory=list)


def _engines_hitting(evidence: list["Hit"]) -> set[str]:
    return {hit.engine for hit in evidence}


def _tier_for(result: PrefilterResult, engines: set[str]) -> tuple[str, str]:
    """Returns (tier, reason). Every reason names the measurement behind it."""
    ai_hits = engines & set(AI_ENGINES)
    if ai_hits:
        surfaces = " and ".join(
            {"google_ai_overview": "AI Overview", "google_ai_mode": "AI Mode"}[e]
            for e in sorted(ai_hits)
        )
        return CRITICAL, f"Cited in {surfaces} as a source for the brand query"

    if result.live and result.mail_capable:
        return HIGH, "Live page with MX records configured — mail-capable"

    store_hits = engines & set(APP_STORE_ENGINES)
    if store_hits:
        store = "Google Play" if "google_play" in store_hits else "the App Store"
        return HIGH, f"Listing on {store} using the brand name"

    if engines & set(LOCAL_ENGINES):
        return MEDIUM, "Business listing occupying the local pack for the brand"

    if engines & set(COMMERCE_ENGINES):
        return MEDIUM, "Commerce listing offering goods under the brand name"

    if result.live:
        return LOW, "Registered with a live page, no mail records configured"
    if result.mail_capable:
        return LOW, "Registered with MX records but no live page — parked and mail-capable"
    if result.resolves:
        return LOW, "Registered and parked — a defensive-registration candidate"
    return LOW, "Unregistered — a defensive-registration candidate"


def score(
    survivors: list[PrefilterResult], hits: list["Hit"]
) -> list[ScoredFinding]:
    """One finding per prefilter survivor, tiered by what the sweep actually observed.

    Only survivors become findings. Candidates that never resolved are not findings;
    they are defensive-registration opportunities, which is what portfolio_domains
    is for.
    """
    by_domain: dict[str, list["Hit"]] = {}
    for hit in hits:
        by_domain.setdefault(hit.domain, []).append(hit)

    findings: list[ScoredFinding] = []
    for result in survivors:
        evidence = by_domain.get(result.domain, [])
        engines = _engines_hitting(evidence)
        tier, reason = _tier_for(result, engines)
        findings.append(
            ScoredFinding(
                domain=result.domain,
                tier=tier,
                reason=reason,
                technique=result.technique,
                mail_capable=result.mail_capable,
                live=result.live,
                registered=result.resolves,
                ai_overview_cited="google_ai_overview" in engines,
                evidence=evidence,
            )
        )

    findings.sort(key=lambda f: (TIER_ORDER.index(f.tier), f.domain))
    return findings
