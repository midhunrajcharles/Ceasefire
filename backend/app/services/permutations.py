"""Lookalike domain generation (section 7.1). Free — no API calls, no searches.

The seven techniques match PERMUTATION_TECHNIQUES in Frontend/lib/types.ts, and the
`technique` string on a Finding is one of these names verbatim.

THE RULE THAT MATTERS: every candidate must differ from the input domain. The frontend
had a bug where a homoglyph swap was a no-op and the resulting "finding" rendered as the
customer's own domain. Every generator asserts `candidate != original` before yielding,
and `generate()` asserts it again over the whole set.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator

# Technique names — verbatim from PERMUTATION_TECHNIQUES in Frontend/lib/types.ts.
HOMOGLYPH = "Homoglyph"
OMISSION = "Omission"
TRANSPOSITION = "Transposition"
INSERTION = "Insertion"
TLD_SWAP = "TLD swap"
HYPHENATION = "Hyphenation"
COMBOSQUAT = "Combosquat"

TECHNIQUES = [
    HOMOGLYPH,
    OMISSION,
    TRANSPOSITION,
    INSERTION,
    TLD_SWAP,
    HYPHENATION,
    COMBOSQUAT,
]

# Visually confusable substitutions, including Cyrillic. Cyrillic candidates are IDN;
# `ascii_domain` carries the punycode form used for DNS and HTTP.
CONFUSABLES: dict[str, tuple[str, ...]] = {
    "a": ("а", "4"),           # Cyrillic а
    "c": ("с",),               # Cyrillic с
    "d": ("cl",),
    "e": ("е", "3"),           # Cyrillic е
    "g": ("9", "q"),
    "i": ("1", "l", "і"),      # Ukrainian і
    "l": ("1", "i", "ӏ"),      # Cyrillic palochka ӏ
    "m": ("rn",),
    "n": ("п",),               # Cyrillic п — shape-adjacent in many faces
    "o": ("0", "о"),           # Cyrillic о
    "p": ("р",),               # Cyrillic р
    "s": ("5", "ѕ"),           # Cyrillic ѕ
    "t": ("7",),
    "u": ("ц", "v"),           # Cyrillic ц
    "v": ("u",),
    "w": ("vv", "ш"),          # Cyrillic ш
    "x": ("х",),               # Cyrillic х
    "y": ("у",),               # Cyrillic у
    "z": ("2",),
}

TLDS = (
    "com", "net", "org", "co", "io", "info", "biz", "online", "site", "shop",
    "xyz", "top", "live", "app", "dev", "store", "club", "us", "uk", "eu",
)

# Credential-bait keywords — the combosquat vocabulary.
COMBO_KEYWORDS = (
    "login", "secure", "account", "support", "verify", "billing", "portal",
    "mail", "admin", "help", "pay", "update", "service", "auth", "signin",
)


@dataclass(frozen=True)
class Candidate:
    domain: str          # display form, may contain non-ASCII (IDN homoglyphs)
    technique: str
    ascii_domain: str    # punycode form — what DNS and HTTP actually use

    @property
    def is_idn(self) -> bool:
        return self.ascii_domain != self.domain


def split_domain(domain: str) -> tuple[str, str]:
    """('northwind-supply.com') -> ('northwind-supply', 'com')."""
    cleaned = domain.strip().lower().rstrip(".")
    if cleaned.startswith("http://") or cleaned.startswith("https://"):
        cleaned = cleaned.split("://", 1)[1]
    cleaned = cleaned.split("/", 1)[0]
    if "." not in cleaned:
        return cleaned, "com"
    label, suffix = cleaned.split(".", 1)
    return label, suffix


def to_ascii(domain: str) -> str | None:
    """IDNA-encode a domain. Returns None if it cannot be encoded (unusable candidate)."""
    try:
        return ".".join(
            part.encode("idna").decode("ascii") if not part.isascii() else part
            for part in domain.split(".")
        )
    except (UnicodeError, ValueError):
        return None


# ── The seven techniques ───────────────────────────────────────────────────


def _homoglyphs(label: str) -> Iterator[str]:
    """Try each confusable substitution in turn.

    Falls back to doubling a middle character so a label with no confusable
    characters still yields something that DIFFERS from the original.
    """
    produced = False
    for i, char in enumerate(label):
        for replacement in CONFUSABLES.get(char, ()):
            swapped = label[:i] + replacement + label[i + 1 :]
            if swapped != label:  # never a no-op — this is the frontend's old bug
                produced = True
                yield swapped
    if not produced and len(label) > 2:
        middle = len(label) // 2
        yield label[:middle] + label[middle] + label[middle:]


def _omissions(label: str) -> Iterator[str]:
    for i in range(len(label)):
        dropped = label[:i] + label[i + 1 :]
        if dropped and dropped != label:
            yield dropped


def _transpositions(label: str) -> Iterator[str]:
    for i in range(len(label) - 1):
        if label[i] == label[i + 1]:
            continue  # swapping identical characters is a no-op
        chars = list(label)
        chars[i], chars[i + 1] = chars[i + 1], chars[i]
        yield "".join(chars)


def _insertions(label: str) -> Iterator[str]:
    for i, char in enumerate(label):
        if not char.isalnum():
            continue  # doubling a separator is not a realistic typo
        yield label[: i + 1] + char + label[i + 1 :]  # doubled character


def _hyphenations(label: str) -> Iterator[str]:
    if "-" in label:
        stripped = label.replace("-", "")
        if stripped and stripped != label:
            yield stripped  # dropping the real hyphen is the obvious lookalike
    for i in range(1, len(label)):
        if label[i - 1] == "-" or label[i] == "-":
            continue  # no doubled or leading/trailing hyphens
        yield label[:i] + "-" + label[i:]


def _combosquats(label: str) -> Iterator[str]:
    for keyword in COMBO_KEYWORDS:
        yield f"{label}-{keyword}"
        yield f"{keyword}-{label}"


# ── Assembly ───────────────────────────────────────────────────────────────


def generate(domain: str) -> list[Candidate]:
    """All candidates for a domain, deduplicated, never including the input itself."""
    label, suffix = split_domain(domain)
    original = f"{label}.{suffix}"

    label_generators = (
        (HOMOGLYPH, _homoglyphs),
        (OMISSION, _omissions),
        (TRANSPOSITION, _transpositions),
        (INSERTION, _insertions),
        (HYPHENATION, _hyphenations),
        (COMBOSQUAT, _combosquats),
    )

    seen: set[str] = {original}
    candidates: list[Candidate] = []

    def add(candidate_domain: str, technique: str) -> None:
        # The assertion the frontend bug was missing.
        assert candidate_domain != original, (
            f"{technique} produced the input domain unchanged: {candidate_domain}"
        )
        if candidate_domain in seen:
            return
        ascii_form = to_ascii(candidate_domain)
        if ascii_form is None:
            return  # not a resolvable name, so not worth carrying
        seen.add(candidate_domain)
        candidates.append(Candidate(candidate_domain, technique, ascii_form))

    for technique, generator in label_generators:
        for variant in generator(label):
            if variant == label:
                continue  # belt and braces: a no-op variant never becomes a candidate
            add(f"{variant}.{suffix}", technique)

    # TLD swap keeps the label and changes the suffix.
    for tld in TLDS:
        if tld != suffix:
            add(f"{label}.{tld}", TLD_SWAP)

    # The whole-set guarantee, restated where it is cheap to check.
    assert all(c.domain != original for c in candidates)
    assert all(c.ascii_domain != original for c in candidates)
    return candidates


def counts_by_technique(candidates: list[Candidate]) -> dict[str, int]:
    counts = {name: 0 for name in TECHNIQUES}
    for candidate in candidates:
        counts[candidate.technique] += 1
    return counts
