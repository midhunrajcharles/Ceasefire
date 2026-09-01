"""The prefilter funnel (section 7.2). No network — DNS and HTTP are both faked.

The rule this file exists to defend: a lookup that FAILED must never be counted as
"not registered". A DNS outage silently reporting a clean scan is worse than a
crash, because the user believes it.
"""

import dns.resolver
import pytest

from app.services import prefilter
from app.services.egress import EgressBlocked, EgressError
from app.services.permutations import Candidate

# asyncio_mode=auto in pytest.ini picks up the async tests below.


class FakeAnswer(list):
    pass


class FakeResolver:
    """answers maps (name, rdtype) -> list[str] | Exception."""

    def __init__(self, answers):
        self.answers = answers

    async def resolve(self, name, rdtype):
        value = self.answers.get((name, rdtype), dns.resolver.NXDOMAIN())
        if isinstance(value, Exception):
            raise value
        return FakeAnswer(_Rec(v) for v in value)


class _Rec:
    def __init__(self, text):
        self._text = text

    def to_text(self):
        return self._text


def cand(domain, technique="Omission"):
    return Candidate(domain, technique, domain)


@pytest.fixture
def no_http(monkeypatch):
    """Default: nothing is live, so DNS behaviour can be tested on its own."""

    async def fetch(url, **kwargs):
        raise EgressError("connection refused")

    monkeypatch.setattr(prefilter, "fetch", fetch)


def use_dns(monkeypatch, answers):
    resolver = FakeResolver(answers)

    async def get_resolver():
        return resolver

    monkeypatch.setattr(prefilter, "get_resolver", get_resolver)


# ── Funnel counts ──────────────────────────────────────────────────────────


async def test_funnel_counts_each_stage(monkeypatch):
    use_dns(
        monkeypatch,
        {
            ("live-and-mail.com", "A"): ["1.2.3.4"],
            ("live-and-mail.com", "MX"): ["10 mail.live-and-mail.com."],
            ("resolves-only.com", "A"): ["5.6.7.8"],
            ("mail-no-site.com", "A"): ["9.9.9.9"],
            ("mail-no-site.com", "MX"): ["10 mx.mail-no-site.com."],
            # unregistered.com answers NXDOMAIN by default
        },
    )

    async def fetch(url, **kwargs):
        if "live-and-mail.com" in url:
            return type("R", (), {"status_code": 200, "text": "<title>Bank Login</title>"})()
        raise EgressError("refused")

    monkeypatch.setattr(prefilter, "fetch", fetch)

    candidates = [
        cand("live-and-mail.com"),
        cand("resolves-only.com"),
        cand("mail-no-site.com"),
        cand("unregistered.com"),
    ]
    funnel = await prefilter.run(candidates, "original.com")

    assert funnel.generated == 4
    assert funnel.survived_dns == 3
    assert funnel.mail_capable == 2
    assert funnel.survived_http == 1
    assert funnel.dns_errors == 0
    assert funnel.as_stats() == {
        "generated": 4,
        "survivedDns": 3,
        "mailCapable": 2,
        "survivedHttp": 1,
    }


async def test_title_is_extracted_and_unescaped(monkeypatch):
    use_dns(monkeypatch, {("shop.com", "A"): ["1.2.3.4"]})

    async def fetch(url, **kwargs):
        return type(
            "R", (), {"status_code": 200, "text": "<title>KOTA &amp;\n the Engineer</title>"}
        )()

    monkeypatch.setattr(prefilter, "fetch", fetch)

    funnel = await prefilter.run([cand("shop.com")], "original.com")
    assert funnel.survivors[0].title == "KOTA & the Engineer"


# ── The honesty rule ───────────────────────────────────────────────────────


async def test_lookup_failure_is_not_counted_as_unregistered(monkeypatch, no_http):
    use_dns(
        monkeypatch,
        {
            ("timeout.com", "A"): dns.resolver.LifetimeTimeout(timeout=2.0, errors=[]),
            ("timeout.com", "AAAA"): dns.resolver.LifetimeTimeout(timeout=2.0, errors=[]),
            ("gone.com", "A"): dns.resolver.NXDOMAIN(),
        },
    )
    funnel = await prefilter.run([cand("timeout.com"), cand("gone.com")], "original.com")

    assert funnel.survived_dns == 0
    assert funnel.dns_errors == 1, "the timeout must be reported, not silently dropped"


async def test_nxdomain_is_a_real_answer_not_an_error(monkeypatch, no_http):
    use_dns(monkeypatch, {})  # everything NXDOMAINs
    funnel = await prefilter.run([cand("nope.com")], "original.com")
    assert funnel.survived_dns == 0
    assert funnel.dns_errors == 0


async def test_no_working_resolver_raises_rather_than_reporting_clean(monkeypatch):
    async def boom():
        raise prefilter.DnsUnavailable("no resolver answered")

    monkeypatch.setattr(prefilter, "get_resolver", boom)
    with pytest.raises(prefilter.DnsUnavailable):
        await prefilter.run([cand("a.com")], "original.com")


# ── The input domain is never scanned as its own lookalike ─────────────────


async def test_candidate_equal_to_input_is_rejected(monkeypatch, no_http):
    use_dns(monkeypatch, {})
    with pytest.raises(AssertionError):
        await prefilter.run([cand("original.com")], "original.com")


# ── Cap and ordering ───────────────────────────────────────────────────────


async def test_cap_limits_what_reaches_the_sweep(monkeypatch, no_http):
    domains = [f"d{i}.com" for i in range(30)]
    use_dns(monkeypatch, {(d, "A"): ["1.2.3.4"] for d in domains})

    funnel = await prefilter.run([cand(d) for d in domains], "original.com", cap=15)
    assert funnel.survived_dns == 30
    assert len(funnel.survivors) == 15, "counts stay true; only the sweep list is capped"


async def test_mail_capable_and_live_ranks_first(monkeypatch):
    use_dns(
        monkeypatch,
        {
            ("plain.com", "A"): ["1.1.1.1"],
            ("mail.com", "A"): ["2.2.2.2"],
            ("mail.com", "MX"): ["10 mx.mail.com."],
            ("both.com", "A"): ["3.3.3.3"],
            ("both.com", "MX"): ["10 mx.both.com."],
        },
    )

    async def fetch(url, **kwargs):
        if "both.com" in url:
            return type("R", (), {"status_code": 200, "text": "<title>x</title>"})()
        raise EgressError("refused")

    monkeypatch.setattr(prefilter, "fetch", fetch)

    funnel = await prefilter.run(
        [cand("plain.com"), cand("mail.com"), cand("both.com")], "original.com"
    )
    assert [r.domain for r in funnel.survivors] == ["both.com", "mail.com", "plain.com"]


# ── Egress integration ─────────────────────────────────────────────────────


async def test_blocked_egress_is_not_live(monkeypatch):
    """A lookalike pointing at private space is not a live public site."""
    use_dns(monkeypatch, {("internal.com", "A"): ["10.0.0.5"]})

    async def fetch(url, **kwargs):
        raise EgressBlocked("internal.com resolves to a blocked address: 10.0.0.5")

    monkeypatch.setattr(prefilter, "fetch", fetch)

    funnel = await prefilter.run([cand("internal.com")], "original.com")
    assert funnel.survived_http == 0
    assert "blocked" in funnel.survivors[0].note


async def test_https_is_tried_before_http(monkeypatch):
    use_dns(monkeypatch, {("shop.com", "A"): ["1.2.3.4"]})
    tried = []

    async def fetch(url, **kwargs):
        tried.append(url)
        raise EgressError("refused")

    monkeypatch.setattr(prefilter, "fetch", fetch)
    await prefilter.run([cand("shop.com")], "original.com")
    assert tried == ["https://shop.com/", "http://shop.com/"]


async def test_non_200_is_not_live(monkeypatch):
    use_dns(monkeypatch, {("parked.com", "A"): ["1.2.3.4"]})

    async def fetch(url, **kwargs):
        return type("R", (), {"status_code": 404, "text": "<title>Parked</title>"})()

    monkeypatch.setattr(prefilter, "fetch", fetch)
    funnel = await prefilter.run([cand("parked.com")], "original.com")
    assert funnel.survived_http == 0
    assert funnel.survivors[0].http_status == 404
