"""name.com availability and defensive registration (section 3.5).

SANDBOX BY DEFAULT. `NAMECOM_BASE_URL` is `https://api.dev.name.com` and production is
only ever reached by an explicit env change — which is logged loudly at call time,
because the production endpoint registers real domains and charges real money.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from ..config import settings

log = logging.getLogger("ceasefire.namecom")

SANDBOX_BASE_URL = "https://api.dev.name.com"
TIMEOUT_SECONDS = 20.0


class NamecomUnavailable(Exception):
    """No credentials configured, or name.com refused. Degrades gracefully."""


def is_configured() -> bool:
    return bool(settings.namecom_username and settings.namecom_token)


def is_sandbox() -> bool:
    return settings.namecom_base_url.rstrip("/") == SANDBOX_BASE_URL


def _warn_if_production(action: str) -> None:
    if not is_sandbox():
        log.warning(
            "name.com %s is pointed at %s, NOT the sandbox. This spends real money.",
            action,
            settings.namecom_base_url,
        )


async def _call(method: str, path: str, json_body: dict | None = None) -> dict[str, Any]:
    if not is_configured():
        raise NamecomUnavailable("name.com credentials are not configured.")
    url = settings.namecom_base_url.rstrip("/") + path
    auth = (settings.namecom_username, settings.namecom_token)
    async with httpx.AsyncClient(timeout=httpx.Timeout(TIMEOUT_SECONDS)) as client:
        try:
            response = await client.request(method, url, json=json_body, auth=auth)
        except httpx.HTTPError as exc:
            raise NamecomUnavailable(f"name.com unreachable: {exc}") from exc

    if response.status_code == 401:
        raise NamecomUnavailable("name.com rejected the credentials (401).")
    if response.status_code >= 400:
        detail = ""
        try:
            payload = response.json()
            detail = payload.get("message") or payload.get("details") or ""
        except ValueError:
            detail = response.text[:200]
        raise NamecomUnavailable(f"name.com returned {response.status_code}: {detail}")
    return response.json()


async def check_availability(domain: str) -> dict[str, Any]:
    """Returns {available, price_usd, premium, reason}. Never raises for 'taken'."""
    _warn_if_production("availability check")
    payload = await _call(
        "POST", "/v4/domains:checkAvailability", {"domainNames": [domain]}
    )
    results = payload.get("results") or []
    match = next(
        (r for r in results if (r.get("domainName") or "").lower() == domain.lower()),
        None,
    )
    if match is None:
        # name.com omits names it will not sell; that is a definite "not available".
        return {
            "available": False,
            "price_usd": None,
            "premium": False,
            "reason": "Not offered for registration — most likely already registered.",
        }

    purchasable = bool(match.get("purchasable"))
    price = match.get("purchasePrice")
    return {
        "available": purchasable,
        "price_usd": float(price) if price is not None else None,
        "premium": bool(match.get("premium")),
        "reason": None if purchasable else "Already registered.",
    }


async def register(domain: str, price_usd: float | None) -> dict[str, Any]:
    """Defensive registration. Sandbox unless the env was deliberately changed."""
    _warn_if_production("REGISTRATION")
    body: dict[str, Any] = {"domain": {"domainName": domain}}
    if price_usd is not None:
        body["purchasePrice"] = price_usd
    payload = await _call("POST", "/v4/domains", body)
    domain_block = payload.get("domain") or {}
    return {
        "order_id": str(payload.get("order") or domain_block.get("domainName") or domain),
        "expires_at": domain_block.get("expireDate"),
        "registrar": "name.com",
    }
