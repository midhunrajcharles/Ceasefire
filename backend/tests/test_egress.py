"""The six SSRF cases from section 5.4. Every one of them must be REJECTED."""

import httpx
import pytest

from app.services.egress import (
    EgressBlocked,
    EgressError,
    fetch,
    ip_is_blocked,
    validate_target,
)

pytestmark = pytest.mark.asyncio


# ── The six required cases ─────────────────────────────────────────────────


async def test_1_cloud_metadata_rejected():
    """http://169.254.169.254/latest/meta-data/ — the cloud metadata endpoint."""
    with pytest.raises(EgressBlocked) as exc:
        await fetch("http://169.254.169.254/latest/meta-data/")
    assert "169.254.169.254" in str(exc.value)


async def test_2_loopback_rejected():
    """http://127.0.0.1:8000/ — our own API."""
    with pytest.raises(EgressBlocked) as exc:
        await fetch("http://127.0.0.1:8000/")
    assert "127.0.0.1" in str(exc.value)


async def test_3_ipv6_loopback_rejected():
    """http://[::1]:8000/ — the same thing over IPv6."""
    with pytest.raises(EgressBlocked) as exc:
        await fetch("http://[::1]:8000/")
    assert "::1" in str(exc.value)


async def test_4_public_name_resolving_to_loopback_rejected():
    """http://localtest.me/ — a real public name whose A record is 127.0.0.1.

    This is the case a hostname denylist misses: the NAME is public, the ADDRESS
    is not. Only checking the resolved IP catches it.
    """
    try:
        with pytest.raises(EgressBlocked) as exc:
            await fetch("http://localtest.me/")
    except EgressError as exc:  # no DNS available in this environment
        pytest.skip(f"DNS unavailable, cannot exercise the live name: {exc}")
    # The name has both an A (127.0.0.1) and an AAAA (::1) record; either one
    # blocking it is the correct outcome.
    assert "127.0.0.1" in str(exc.value) or "::1" in str(exc.value)


async def test_5_file_scheme_rejected():
    """file:///etc/passwd — scheme allowlist."""
    with pytest.raises(EgressBlocked) as exc:
        await fetch("file:///etc/passwd")
    assert "Scheme not allowed" in str(exc.value)


async def test_6_redirect_into_private_space_rejected():
    """http://evil.example -> 302 -> http://10.0.0.1/ — re-check every hop.

    The first hop is a legitimate public address, so only re-validating the
    redirect target catches this. A fake resolver and transport stand in for DNS
    and the network; the redirect loop under test is the real one.
    """

    async def resolver(host: str) -> list[str]:
        return {"evil.example": ["93.184.216.34"], "10.0.0.1": ["10.0.0.1"]}[host]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://10.0.0.1/"})

    with pytest.raises(EgressBlocked) as exc:
        await fetch(
            "http://evil.example/",
            resolver=resolver,
            transport=httpx.MockTransport(handler),
        )
    assert "10.0.0.1" in str(exc.value)


# ── Supporting checks ──────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "ip",
    [
        "10.1.2.3",
        "172.16.0.1",
        "192.168.1.1",
        "127.0.0.1",
        "169.254.169.254",
        "0.0.0.0",
        "100.64.0.1",
        "224.0.0.1",
        "::1",
        "fc00::1",
        "fe80::1",
    ],
)
async def test_blocked_ranges(ip):
    assert ip_is_blocked(ip) is True


@pytest.mark.parametrize("ip", ["93.184.216.34", "8.8.8.8", "2606:2800:220:1:248:1893:25c8:1946"])
async def test_public_addresses_allowed(ip):
    assert ip_is_blocked(ip) is False


async def test_redirect_cap_enforced():
    """More than MAX_REDIRECTS hops is refused even when every hop is public."""

    async def resolver(host: str) -> list[str]:
        return ["93.184.216.34"]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://public.example/next"})

    with pytest.raises(EgressBlocked) as exc:
        await fetch(
            "http://public.example/",
            resolver=resolver,
            transport=httpx.MockTransport(handler),
        )
    assert "Too many redirects" in str(exc.value)


async def test_response_size_capped(monkeypatch):
    """A body over the cap is refused rather than buffered."""
    from app.services import egress

    monkeypatch.setattr(egress, "MAX_RESPONSE_BYTES", 1024)

    async def resolver(host: str) -> list[str]:
        return ["93.184.216.34"]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"x" * 5000)

    with pytest.raises(EgressBlocked) as exc:
        await egress.fetch(
            "http://public.example/",
            resolver=resolver,
            transport=httpx.MockTransport(handler),
        )
    assert "exceeded" in str(exc.value)


async def test_no_credentials_are_forwarded():
    """No cookie, no authorization, no api key on an outbound scan fetch."""
    seen: dict[str, str] = {}

    async def resolver(host: str) -> list[str]:
        return ["93.184.216.34"]

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update({k.lower(): v for k, v in request.headers.items()})
        return httpx.Response(200, content=b"<title>ok</title>")

    response = await fetch(
        "http://public.example/",
        resolver=resolver,
        transport=httpx.MockTransport(handler),
    )
    assert response.status_code == 200
    assert "cookie" not in seen
    assert "authorization" not in seen
    assert not any("api" in k and "key" in k for k in seen)
    # The pinned connection still presents the real hostname.
    assert seen["host"] == "public.example"


async def test_validate_target_pins_resolved_ip():
    async def resolver(host: str) -> list[str]:
        return ["93.184.216.34"]

    parsed, ip = await validate_target("https://example.com/path", resolver)
    assert parsed.host == "example.com"
    assert ip == "93.184.216.34"


async def test_public_name_with_private_address_blocked_without_dns():
    """The same guarantee as case 4, but deterministic — no live DNS involved."""

    async def resolver(host: str) -> list[str]:
        return ["127.0.0.1"]

    with pytest.raises(EgressBlocked) as exc:
        await fetch("http://public-name.example/", resolver=resolver)
    assert "127.0.0.1" in str(exc.value)


async def test_one_private_answer_poisons_the_name():
    """A name that resolves to both a public and a private address is refused."""

    async def resolver(host: str) -> list[str]:
        return ["93.184.216.34", "10.0.0.5"]

    with pytest.raises(EgressBlocked) as exc:
        await validate_target("http://mixed.example/", resolver)
    assert "10.0.0.5" in str(exc.value)
