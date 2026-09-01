"""SSRF controls for every outbound fetch of an attacker-influenced URL (section 5.4).

The prefilter fetches URLs derived from generated domains and from search results.
That is attacker-influenced input reaching our HTTP client, so every hop is checked:

1. Scheme allowlist.
2. DNS is resolved FIRST and the resolved IP is checked, not the hostname. The
   connection is then pinned to that validated IP (Host header + SNI preserved), so
   a second lookup cannot return a different address — this is what blocks DNS
   rebinding.
3. Every redirect hop is re-validated. Capped at MAX_REDIRECTS.
4. Hard timeout and a response size cap.
5. No cookies, no auth headers, no API key ever leaves with these requests.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from dataclasses import dataclass, field
from typing import Awaitable, Callable

import httpx

from ..config import settings

ALLOWED_SCHEMES = {"http", "https"}

BLOCKED_V4 = [
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "0.0.0.0/8",
    "100.64.0.0/10",
    "224.0.0.0/4",
]
BLOCKED_V6 = ["::1/128", "fc00::/7", "fe80::/10"]

_BLOCKED_NETS = [ipaddress.ip_network(n) for n in BLOCKED_V4 + BLOCKED_V6]

MAX_REDIRECTS = settings.egress_max_redirects
TIMEOUT_SECONDS = settings.egress_timeout_seconds
MAX_RESPONSE_BYTES = settings.egress_max_response_bytes

# Nothing identifying, nothing authenticating.
_SAFE_HEADERS = {
    "User-Agent": "Ceasefire/0.1 (brand-impersonation reconnaissance; public data only)",
    "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    "Accept-Encoding": "identity",
}

# A resolver takes a hostname and returns the IPs it resolves to.
Resolver = Callable[[str], Awaitable[list[str]]]


class EgressBlocked(Exception):
    """The URL was refused by policy. Never retry it."""


class EgressError(Exception):
    """The fetch failed for a network reason (DNS, timeout, connection, size)."""


@dataclass
class EgressResponse:
    url: str
    status_code: int
    body: bytes
    headers: dict[str, str] = field(default_factory=dict)
    hops: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", errors="replace")


def ip_is_blocked(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return True  # unparseable is not something we connect to
    if any(addr in net for net in _BLOCKED_NETS):
        return True
    # Stricter than the explicit lists, deliberately: anything not globally
    # routable has no business being a scan target.
    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
    )


async def default_resolver(host: str) -> list[str]:
    """socket.getaddrinfo off the event loop. Returns every address for the name."""
    try:
        infos = await asyncio.to_thread(
            socket.getaddrinfo, host, None, 0, socket.SOCK_STREAM
        )
    except socket.gaierror as exc:
        raise EgressError(f"DNS resolution failed for {host}: {exc}") from exc
    # Sorted so a multi-address name reports the same blocked IP every time.
    return sorted({info[4][0] for info in infos})


async def validate_target(url: str, resolver: Resolver | None = None) -> tuple[httpx.URL, str]:
    """Check one URL and return (parsed URL, the pinned IP we will connect to).

    Raises EgressBlocked for anything the policy refuses.
    """
    resolve = resolver or default_resolver

    try:
        parsed = httpx.URL(url)
    except Exception as exc:  # malformed URL
        raise EgressBlocked(f"Unparseable URL: {url}") from exc

    scheme = parsed.scheme.lower()
    if scheme not in ALLOWED_SCHEMES:
        raise EgressBlocked(f"Scheme not allowed: {scheme or '(none)'}")

    host = parsed.host
    if not host:
        raise EgressBlocked(f"No host in URL: {url}")

    # A literal IP needs no lookup — check it as given.
    try:
        ipaddress.ip_address(host)
        addresses = [host]
    except ValueError:
        addresses = await resolve(host)

    if not addresses:
        raise EgressBlocked(f"{host} resolved to nothing")

    # EVERY address must pass. One private answer poisons the name.
    for ip in addresses:
        if ip_is_blocked(ip):
            raise EgressBlocked(f"{host} resolves to a blocked address: {ip}")

    return parsed, addresses[0]


async def fetch(
    url: str,
    *,
    resolver: Resolver | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> EgressResponse:
    """GET a URL under the full policy above.

    `resolver` and `transport` exist so tests can drive the redirect loop without
    real DNS or a real network; production always uses the defaults.
    """
    current = url
    hops: list[str] = []

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(TIMEOUT_SECONDS),
        follow_redirects=False,  # we follow them ourselves, re-validating each one
        transport=transport,
        cookies=None,
        trust_env=False,  # ignore proxy env vars — they are an egress bypass
    ) as client:
        for hop in range(MAX_REDIRECTS + 1):
            parsed, pinned_ip = await validate_target(current, resolver)
            hops.append(current)

            # Connect to the validated IP, but keep the real hostname for the Host
            # header, SNI and certificate verification. A second DNS lookup cannot
            # move the connection somewhere else.
            target = parsed.copy_with(host=pinned_ip)
            headers = dict(_SAFE_HEADERS)
            headers["Host"] = parsed.netloc.decode("ascii")

            request = client.build_request(
                "GET",
                target,
                headers=headers,
                extensions={"sni_hostname": parsed.host},
            )

            try:
                response = await client.send(request, stream=True)
            except httpx.HTTPError as exc:
                raise EgressError(f"Fetch failed for {current}: {exc}") from exc

            try:
                if response.is_redirect:
                    location = response.headers.get("location", "")
                    if not location:
                        raise EgressError(f"Redirect with no Location from {current}")
                    if hop == MAX_REDIRECTS:
                        raise EgressBlocked(
                            f"Too many redirects (max {MAX_REDIRECTS}) starting at {url}"
                        )
                    # Resolve relative Locations against the ORIGINAL url, not the
                    # pinned-IP one, then loop — which re-validates the new target.
                    current = str(parsed.join(location))
                    continue

                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_RESPONSE_BYTES:
                        raise EgressBlocked(
                            f"Response exceeded {MAX_RESPONSE_BYTES} bytes: {current}"
                        )
            finally:
                await response.aclose()

            return EgressResponse(
                url=current,
                status_code=response.status_code,
                body=bytes(body),
                headers=dict(response.headers),
                hops=hops,
            )

    raise EgressError(f"Redirect loop exhausted for {url}")
