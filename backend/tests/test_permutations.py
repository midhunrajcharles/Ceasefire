"""Permutations (section 7.1).

The headline guarantee: no candidate is ever equal to the input domain. That was a
real frontend bug — a homoglyph swap was a no-op and the "finding" rendered as the
customer's own domain.
"""

import pytest

from app.services.permutations import (
    COMBOSQUAT,
    HOMOGLYPH,
    HYPHENATION,
    INSERTION,
    OMISSION,
    TECHNIQUES,
    TLD_SWAP,
    TRANSPOSITION,
    Candidate,
    _homoglyphs,
    counts_by_technique,
    generate,
    split_domain,
    to_ascii,
)

DOMAINS = [
    "northwind-supply.com",
    "acme.com",
    "stripe.com",
    "okta.com",
    "aaa.com",          # repeated characters — transposition must not no-op
    "xyz.io",
    "hh.co",            # two identical characters, nothing else
    "q.com",            # single character
    "bbb-bbb.net",
]


# ── The rule that matters ──────────────────────────────────────────────────


@pytest.mark.parametrize("domain", DOMAINS)
def test_no_candidate_equals_the_input(domain):
    label, suffix = split_domain(domain)
    original = f"{label}.{suffix}"
    candidates = generate(domain)
    assert candidates, f"{domain} produced nothing"
    for c in candidates:
        assert c.domain != original, f"{c.technique} produced the input domain"
        assert c.ascii_domain != original, f"{c.technique} punycodes to the input domain"


@pytest.mark.parametrize("domain", DOMAINS)
def test_no_candidate_label_is_a_no_op(domain):
    """Not just the full domain — the LABEL must change unless the TLD did."""
    label, suffix = split_domain(domain)
    for c in generate(domain):
        c_label, c_suffix = split_domain(c.domain)
        assert c_label != label or c_suffix != suffix


def test_homoglyph_generator_never_yields_the_input():
    for label in ["northwind-supply", "acme", "q", "xx", "---"]:
        assert all(v != label for v in _homoglyphs(label))


def test_homoglyph_falls_back_when_no_confusable_exists():
    """A label with no confusable characters still yields a differing candidate."""
    variants = list(_homoglyphs("---"))  # nothing in CONFUSABLES
    assert variants == ["----"], variants  # middle character doubled


def test_candidates_are_unique():
    candidates = generate("northwind-supply.com")
    assert len({c.domain for c in candidates}) == len(candidates)


# ── The seven techniques ───────────────────────────────────────────────────


def test_all_seven_techniques_produce_candidates():
    counts = counts_by_technique(generate("northwind-supply.com"))
    assert set(counts) == set(TECHNIQUES)
    for technique, n in counts.items():
        assert n > 0, f"{technique} produced nothing"


def test_technique_examples_from_the_frontend_are_reachable():
    """The examples in PERMUTATION_TECHNIQUES must actually be generated for acme.com."""
    by_domain = {c.domain: c.technique for c in generate("acme.com")}
    assert by_domain.get("acrne.com") == HOMOGLYPH        # m -> rn
    assert by_domain.get("acm.com") == OMISSION
    assert by_domain.get("acem.com") == TRANSPOSITION
    assert by_domain.get("accme.com") == INSERTION
    assert by_domain.get("acme.co") == TLD_SWAP
    assert by_domain.get("ac-me.com") == HYPHENATION
    assert by_domain.get("acme-login.com") == COMBOSQUAT


def test_tld_swap_never_reuses_the_original_tld():
    for c in generate("acme.com"):
        if c.technique == TLD_SWAP:
            assert not c.domain.endswith(".com")


def test_hyphenation_drops_an_existing_hyphen():
    domains = {c.domain for c in generate("northwind-supply.com")}
    assert "northwindsupply.com" in domains


def test_hyphenation_never_doubles_or_edges_a_hyphen():
    for c in generate("northwind-supply.com"):
        label, _ = split_domain(c.domain)
        assert "--" not in label
        assert not label.startswith("-") and not label.endswith("-")


def test_transposition_skips_identical_neighbours():
    """'aaa' has no meaningful adjacent swap — it must not emit 'aaa' back."""
    assert all(c.domain != "aaa.com" for c in generate("aaa.com"))


# ── IDN handling ───────────────────────────────────────────────────────────


def test_cyrillic_homoglyphs_are_punycoded_for_lookups():
    idn = [c for c in generate("okta.com") if c.is_idn]
    assert idn, "expected some Cyrillic homoglyph candidates"
    for c in idn:
        assert c.ascii_domain.startswith("xn--") or ".xn--" in c.ascii_domain
        assert c.ascii_domain.isascii()


def test_to_ascii_round_trips_plain_ascii():
    assert to_ascii("northwind-supply.com") == "northwind-supply.com"


def test_unencodable_candidates_are_dropped_not_yielded():
    assert to_ascii("a" * 100 + ".com") is not None  # long but legal
    for c in generate("northwind-supply.com"):
        assert c.ascii_domain, "every candidate carries a usable ASCII form"


# ── Input handling ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "given,expected",
    [
        ("northwind-supply.com", ("northwind-supply", "com")),
        ("HTTPS://Northwind-Supply.com/path", ("northwind-supply", "com")),
        ("acme.co.uk", ("acme", "co.uk")),
        ("acme", ("acme", "com")),
    ],
)
def test_split_domain(given, expected):
    assert split_domain(given) == expected


def test_multi_part_tld_is_preserved():
    candidates = generate("acme.co.uk")
    assert any(c.domain == "acm.co.uk" for c in candidates)
    assert all(c.domain != "acme.co.uk" for c in candidates)


def test_candidate_is_hashable_and_frozen():
    c = Candidate("acrne.com", HOMOGLYPH, "acrne.com")
    assert {c, c} == {c}
    with pytest.raises(Exception):
        c.domain = "other.com"  # frozen dataclass
