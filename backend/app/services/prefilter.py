"""The free funnel that makes the search budget survivable (section 7.2).

    ~200 generated
      -> DNS A/AAAA resolves?   ~40 survive     (dnspython, free)
      -> MX records present?    flags mail_capable = phishing-ready
      -> HTTP 200 + <title>?    ~20 survive     (egress-guarded, free)
      -> only then are SerpApi searches spent, on survivors only

Nothing in this module spends a search. Every HTTP fetch goes through
services/egress.py, because these hostnames are attacker-influenced input.
"""

from __future__ import annotations

import asyncio
import html
import logging
import re
import time
from dataclasses import dataclass, field

import dns.asyncresolver
import dns.exception
import dns.resolver

from ..config import settings
from .egress import EgressBlocked, EgressError, fetch
from .permutations import Candidate

log = logging.getLogger("ceasefire.prefilter")

DNS_TIMEOUT_SECONDS = 2.0      # per nameserver
DNS_LIFETIME_SECONDS = 6.0     # across all nameservers for one query
DNS_CONCURRENCY = 30
HTTP_CONCURRENCY = 10

DNS_PROBE_NAME = "google.com"
SLOW_PROBE_SECONDS = 1.5
PUBLIC_NAMESERVERS = ["8.8.8.8", "1.1.1.1", "9.9.9.9"]


class DnsUnavailable(Exception):
    """No resolver answered. The scan must fail loudly, not report a clean result."""


_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)


@dataclass
class PrefilterResult:
    candidate: Candidate
    addresses: list[str] = field(default_factory=list)
    mail_capable: bool = False
    live: bool = False
    dns_error: str | None = None   # set only when the lookup FAILED, not when empty
    http_status: int | None = None
    title: str | None = None
    note: str | None = None  # why HTTP failed, when it did

    @property
    def domain(self) -> str:
        return self.candidate.domain

    @property
    def technique(self) -> str:
        return self.candidate.technique

    @property
    def resolves(self) -> bool:
        return bool(self.addresses)


@dataclass
class Funnel:
    """Maps 1:1 onto scans.prefilter_* and the frontend's PrefilterStats."""

    generated: int = 0
    survived_dns: int = 0
    mail_capable: int = 0
    survived_http: int = 0
    dns_errors: int = 0            # looked up but did not get an answer either way
    survivors: list[PrefilterResult] = field(default_factory=list)
    resolved: list[PrefilterResult] = field(default_factory=list)

    def as_stats(self) -> dict[str, int]:
        return {
            "generated": self.generated,
            "survivedDns": self.survived_dns,
            "mailCapable": self.mail_capable,
            "survivedHttp": self.survived_http,
        }


def _resolver(nameservers: list[str] | None = None) -> dns.asyncresolver.Resolver:
    resolver = dns.asyncresolver.Resolver()
    if nameservers:
        resolver.nameservers = nameservers
    resolver.timeout = DNS_TIMEOUT_SECONDS
    resolver.lifetime = DNS_LIFETIME_SECONDS
    return resolver


_healthy_resolver: dns.asyncresolver.Resolver | None = None


async def get_resolver() -> dns.asyncresolver.Resolver:
    """A resolver that actually answers, probed once per process.

    A machine can be configured with nameservers that do not respond to direct
    queries (VPN or corporate DNS). Left unhandled, every lookup times out, every
    candidate looks unregistered, and a scan reports a clean result it never
    measured. So: probe, and fall back to public resolvers if the system's do not
    answer.
    """
    global _healthy_resolver
    if _healthy_resolver is not None:
        return _healthy_resolver

    for label, nameservers in (("system", None), ("public", PUBLIC_NAMESERVERS)):
        resolver = _resolver(nameservers)
        started = time.monotonic()
        try:
            await resolver.resolve(DNS_PROBE_NAME, "A")
        except dns.exception.DNSException as exc:
            log.warning("dns probe failed on %s nameservers: %s", label, exc)
            continue
        took = time.monotonic() - started
        if label == "system" and took > SLOW_PROBE_SECONDS:
            log.warning(
                "system nameservers answered in %.1fs (slow); using public resolvers", took
            )
            continue
        log.info("dns: using %s nameservers (probe %.2fs)", label, took)
        _healthy_resolver = resolver
        return resolver

    raise DnsUnavailable(
        "No working DNS resolver: neither the system nameservers nor "
        f"{', '.join(PUBLIC_NAMESERVERS)} answered."
    )


async def _query(resolver, name: str, rdtype: str) -> tuple[list[str], str | None]:
    """Returns (records, error). NXDOMAIN/NoAnswer are answers, not errors."""
    try:
        answer = await resolver.resolve(name, rdtype)
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        return [], None  # definitively nothing there
    except (dns.exception.DNSException, ValueError) as exc:
        return [], f"{type(exc).__name__}"  # we do NOT know; never call this unregistered
    return [r.to_text() for r in answer], None


async def _dns_stage(result: PrefilterResult, resolver, gate: asyncio.Semaphore) -> None:
    """A/AAAA decides survival; MX flags mail_capable (only worth asking if it resolves)."""
    name = result.candidate.ascii_domain
    async with gate:
        (a, a_err), (aaaa, aaaa_err) = await asyncio.gather(
            _query(resolver, name, "A"), _query(resolver, name, "AAAA")
        )
        result.addresses = a + aaaa
        if not result.addresses and (a_err or aaaa_err):
            result.dns_error = a_err or aaaa_err
        if result.addresses:
            mx, _ = await _query(resolver, name, "MX")
            result.mail_capable = bool(mx)


async def _http_stage(result: PrefilterResult, gate: asyncio.Semaphore) -> None:
    """HTTP 200 with a <title>. Egress-guarded — these hostnames are untrusted."""
    async with gate:
        for scheme in ("https", "http"):
            try:
                response = await fetch(f"{scheme}://{result.candidate.ascii_domain}/")
            except EgressBlocked as exc:
                # A lookalike pointing into private space is not a live public site.
                result.note = f"blocked: {exc}"
                return
            except EgressError as exc:
                result.note = f"{scheme}: {exc}"
                continue
            result.http_status = response.status_code
            if response.status_code == 200:
                match = _TITLE_RE.search(response.text)
                if match:
                    result.title = html.unescape(" ".join(match.group(1).split()))[:200]
                result.live = True
                result.note = None
                return


def _priority(result: PrefilterResult) -> tuple:
    """Most dangerous first, so the cap keeps what matters.

    Mail-capable and live is a phishing-ready lookalike; that outranks everything.
    """
    return (
        not (result.live and result.mail_capable),
        not result.mail_capable,
        not result.live,
        not bool(result.title),
        result.domain,
    )


async def run(
    candidates: list[Candidate],
    original_domain: str,
    cap: int | None = None,
) -> Funnel:
    """Run the whole funnel. Returns counts plus the capped survivor list."""
    cap = cap if cap is not None else settings.demo_max_permutations

    # The input domain must never be scanned as if it were a lookalike of itself.
    assert all(
        c.domain != original_domain and c.ascii_domain != original_domain
        for c in candidates
    ), "a candidate equals the input domain"

    funnel = Funnel(generated=len(candidates))
    results = [PrefilterResult(candidate=c) for c in candidates]

    resolver = await get_resolver()
    dns_gate = asyncio.Semaphore(DNS_CONCURRENCY)
    await asyncio.gather(*(_dns_stage(r, resolver, dns_gate) for r in results))

    resolved = [r for r in results if r.resolves]
    funnel.survived_dns = len(resolved)
    funnel.mail_capable = sum(1 for r in resolved if r.mail_capable)
    funnel.dns_errors = sum(1 for r in results if r.dns_error)
    funnel.resolved = resolved
    log.info(
        "prefilter dns: %d/%d resolved, %d mail-capable, %d lookup errors",
        funnel.survived_dns,
        funnel.generated,
        funnel.mail_capable,
        funnel.dns_errors,
    )

    http_gate = asyncio.Semaphore(HTTP_CONCURRENCY)
    await asyncio.gather(*(_http_stage(r, http_gate) for r in resolved))

    live = [r for r in resolved if r.live]
    funnel.survived_http = len(live)

    # Everything that resolves is a real candidate; live ones rank first. The cap is
    # what limits the metered sweep, not what limits the truth of the counts.
    ranked = sorted(resolved, key=_priority)
    funnel.survivors = ranked[:cap] if cap and cap > 0 else ranked
    log.info(
        "prefilter http: %d live, %d handed to the sweep (cap %s)",
        funnel.survived_http,
        len(funnel.survivors),
        cap,
    )
    return funnel
