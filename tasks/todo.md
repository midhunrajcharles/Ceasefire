# Ceasefire backend — task log

## Phase 0 — Scaffold + database

- [x] `backend/requirements.txt` — exact pin list from §2
- [x] `backend/.env` — copied from `env.example`, `SECRET_KEY` generated (gitignored)
- [x] `backend/app/config.py` — pydantic-settings, reads `.env`
- [x] `backend/app/db.py` — engine, `SessionLocal`, `Base`, `get_db`
- [x] `backend/app/models.py` — the twelve tables from §4, no more
- [x] `backend/app/main.py` — app factory, CORS (single origin, credentials), security headers, `/health`, `create_all` on startup
- [x] GATE 0 — server starts, `GET /health` is 200, `ceasefire.db` holds all twelve tables

### Notes
- Layout follows §2 (`backend/app/...`) so `uvicorn app.main:app` from `backend/` works as GATE 0 requires.
- No routers, schemas, security, or services in this phase — those are Phases 1+.

## Review — Phase 0 (complete)

All six items done. GATE 0 passed:
- `uvicorn app.main:app --port 8000` started clean.
- `GET /health` -> `200 {"status":"ok","environment":"development"}` with the three
  security headers present.
- `backend/ceasefire.db` created on startup with exactly twelve tables and eight indexes.

Deliberately NOT built in this phase (Phases 1+): schemas.py, security.py, deps.py,
routers/, services/. `.env` was created from `env.example` with a generated `SECRET_KEY`;
it is covered by the root ignore rules.

---

## Phase 1 — Auth, end to end

- [x] `app/schemas.py` — `ApiModel` (alias_generator=to_camel, populate_by_name, from_attributes); `SessionResponse` inherits it
- [x] `app/security.py` — argon2 hashing, token mint/verify (sha256-at-rest), (ip,email) rate limiter, free-mail list
- [x] `app/deps.py` — `current_user` from the session cookie
- [x] `app/routers/auth.py` — signup, signin, signout, me
- [x] `app/main.py` — auth router mounted
- [x] GATE 1 — proven with curl

### Review — Phase 1 (complete)

GATE 1 evidence, all captured from a running server:
- signup 201 + `Set-Cookie: ceasefire_session=…; HttpOnly; Max-Age=2592000; Path=/; SameSite=lax`
- `/auth/me` 200 with `createdAt` (camelCase, UTC `Z`)
- signout 204, cookie cleared, session row `revoked_at` set; the same raw token then 401s
- `test@gmail.com` signup -> 400 "Use a work address — the domain you want to protect."
- six rapid bad signins on a clean key -> 401 x5 then 429
- unknown email and wrong password return an identical 401
- free-mail blocklist verified equal to Frontend/lib/session.ts (15/15, no drift)
- `grep -ri "password_hash|api_key|token_hash" app/schemas.py` is clean

Notes for later phases:
- The rate-limit key is `(ip, email)`; a duplicate-signup 409 also consumes an attempt.
  That is intended, and it is why the first 429 run tripped on attempt 5.
- SQLite returns naive datetimes for `DateTime(timezone=True)`. `security.as_utc()` normalises
  on read; reuse it everywhere a stored timestamp goes back out on the wire.
- `deps.py` still needs the owned-resource loaders (scan/finding/notice) in Phases 4-6.

---

## Phase 2 - Egress + SerpApi client

- [x] `app/services/egress.py` - written FIRST; scheme allowlist, resolve-then-check,
      IP pinning with Host+SNI preserved, per-hop redirect re-validation, timeout, size cap,
      no credentials forwarded
- [x] `app/services/serpapi.py` - ENGINES verbatim from types.ts, params_hash, serp_cache
      (TTL-aware), token bucket (50/hr, burst 10), budget ceiling, 429 backoff with jitter
      (max 4), inline page_token handling
- [x] `tests/test_egress.py` - the six SSRF cases + supporting checks
- [x] `tests/test_serpapi.py` - cache/budget/backoff/bucket/page_token, all offline
- [x] GATE 2 - pytest green (39 passed); live google_ai_overview returns citations

### Review - Phase 2 (complete)

- 39 tests pass, five consecutive clean runs.
- One flake found and fixed during the gate: `default_resolver` returned a set, so a name
  with both A and AAAA records (localtest.me -> 127.0.0.1 and ::1) reported a
  nondeterministic blocked IP. Now sorted, and a DNS-free sibling test covers the same
  guarantee so the suite does not depend on live DNS.
- Live egress verified separately: https://example.com fetched 200 through the pinned-IP
  path, so TLS/SNI still works for legitimate targets.
- LIVE CHECK PASSED. AI Overview returns citations reliably: 2 of 2 queries produced them.
  Internal accounting matched SerpApi's own counter exactly (3 spent, 247 left).

### Design notes for later phases
- `SerpApiClient(db, bucket=None, transport=None)` - transport is a test seam only.
- `search(..., markdown=True)` requests `output=md`; the sweep leaves it OFF because
  citations are read from the structured `references` array, not from markdown.
- `ai_overview_references(payload)` handles both response shapes (inline `ai_overview`
  and the page_token follow-up `ai_overview_full`).
- Both legs of `google_with_ai_overview` are `no_cache=True` and therefore metered:
  one AI Overview check costs 2 searches.

### AI Overview: two response shapes, both handled (measured, not assumed)

| Query | Shape | Citations | Searches |
|---|---|---|---|
| "what is stripe payment processing used for" | `ai_overview.page_token` -> follow-up call | 7 | 2 |
| "okta" | `ai_overview.references` inline, NO page_token | 13 | 1 |

`ai_overview_references()` reads both. A question-shaped query costs 2 searches, a plain
brand query costs 1 - relevant to Phase 4 query planning.

### CARRY INTO PHASE 4 - citation links are not always real URLs

On the inline shape, many `references[].link` values are Google redirector URLs
(`https://www.google.com/goto?url=CAES...`) and `title` is empty. The real domain is in
`references[].source` (e.g. `okta.com`, `en.wikipedia.org`, `marketbeat.com`).

Scoring MUST match an impersonator domain against `source`, falling back to the host of
`link` only when `link` is a direct URL. Matching on `link` alone would miss every
redirected citation - i.e. it would silently under-report the CRITICAL tier, which is the
product's whole differentiator.

---

## Phase 3 - Permutations + prefilter

- [x] `app/services/permutations.py` - all seven techniques, IDN/punycode aware
- [x] `app/services/prefilter.py` - DNS A/AAAA, MX, HTTP+title, egress-guarded, capped
- [x] `tests/test_permutations.py` (36) and `tests/test_prefilter.py` (14)
- [x] GATE 3 - funnel counts printed for northwind-supply.com; every candidate differs from input

### Review - Phase 3 (complete). 86 tests pass. Zero searches spent (budget still 3/250).

GATE 3, northwind-supply.com: generated 126 -> survivedDns 1 -> mailCapable 1 -> survivedHttp 0.
Control run on okta.com (a real brand, so lookalikes exist): 68 -> 35 -> 17 -> 3 live, capped
to 15 for the sweep. The control exists because a zero-survivor funnel and a broken funnel look
identical; the control proves the DNS, MX and HTTP stages all work.

### Two real bugs found and fixed during this phase

1. `_insertions` doubled the hyphen, producing `northwind--supply.com`. Insertion now skips
   non-alphanumerics.
2. THE IMPORTANT ONE: dnspython queried the machine's first nameserver (10.36.99.127, a
   corporate/VPN resolver) over raw UDP, got nothing, and the 3s lifetime expired before it
   rotated to 8.8.8.8. EVERY lookup timed out, every candidate looked unregistered, and the
   funnel reported a clean 0/126. A scan would have reported "no impersonation found" without
   having measured anything. Fixed with a one-time resolver health probe plus a public-resolver
   fallback, and `DnsUnavailable` is raised when nothing answers.

### The honesty rule now encoded in the funnel
`_query` distinguishes NXDOMAIN/NoAnswer (a real answer: not registered) from a lookup FAILURE
(we do not know). Failures are counted in `Funnel.dns_errors` and never counted as unregistered.
Phase 4 must surface `dns_errors` rather than let it vanish.

### Notes for Phase 4
- `funnel.survivors` is already ordered most-dangerous-first (live+mail, then mail, then live)
  and capped at DEMO_MAX_PERMUTATIONS; the sweep should spend searches in that order.
- `funnel.as_stats()` returns the exact camelCase PrefilterStats the frontend wants.
- `Candidate.ascii_domain` is what DNS/HTTP use; `Candidate.domain` is what the user sees.
  Findings should store the display form and evidence should reference the ASCII form.
- Attribution order note: `northwindsupply.com` is labelled Omission (a dropped character),
  not Hyphenation, because Omission runs first and the frontend defines Hyphenation as a
  hyphen INSERTED. Accurate either way.

---

## Phase 4 - The sweep

- [x] `app/services/sweep.py` - BackgroundTask, ten engines, scan_engines written per engine
- [x] `app/services/scoring.py` - the section 7.3 tier heuristic, no invented confidence
- [x] `app/routers/scans.py` - POST /scan, GET /scan/{id}, GET /scans
- [x] `app/deps.py` - `owned_scan` loader (user_id filtered in the SAME query, 404 not 403)
- [x] `app/schemas.py` - Scan/Finding/Evidence/Engine responses, aliases verified against types.ts
- [x] `tests/test_sweep.py` (21) - whole sweep faked end to end, zero searches
- [x] GATE 4 - live sweep, 10 searches spent, 1 CRITICAL finding

### Review - Phase 4 (complete). 107 tests pass. 13/250 searches used in total.

GATE 4: generating -> prefiltering -> sweeping -> scoring -> complete, 89.9s, 10 searches,
1 finding. Accounting reconciles exactly: scans.searches_spent (10) == sum(scan_engines) (10),
and 3 + 10 == SerpApi's own this_month_usage of 13.

### Search cost model (measured, not estimated)
survivors + 9 brand-level searches. northwind-supply.com had 1 survivor -> 10 searches.
A 15-survivor sweep would cost ~24. DEMO_MAX_PERMUTATIONS is the lever.

### FLAG 1 - the CRITICAL finding is a name collision, not an impersonator
`northwindsupply.com` was tiered CRITICAL because google_ai_mode cited it for the query
"Northwind Supply". The evidence snippet reads "Shop unique handmade leather gifts..." - it is
a real, apparently legitimate business that happens to share the name of our FICTIONAL demo
brand. The heuristic did exactly what section 7.3 specifies and the finding is literally true
(this domain IS what Google's AI cites for that brand query), but "cited for the brand query"
is not the same as "impersonating the brand". The human review gate before any notice is the
designed mitigation and it is doing its job here. Worth saying out loud in the demo rather
than presenting this as a catch.

### FLAG 2 - per-user budget vs one global SerpApi account
SEARCH_BUDGET_TOTAL=250 is enforced per (user_id, period) as section 4 specifies, but the
SerpApi account is 250 TOTAL across every user. Two users can each spend 250 and the account
runs dry at 250. Not a Phase 4 bug; needs an account-level ceiling before more than one real
user exists. Raise at Phase 9.

### Note - `generating` and `scoring` are too fast to observe at 500ms
All five states are written and logged (verified in the server log). `generating` is pure
computation (~20ms) and `scoring` is a few inserts (~10ms), so a 500ms poller usually sees
neither. Harmless for the UI: ScanProgress uses `ORDER.indexOf(scan.state)` and marks every
earlier stage done by index, so skipped states still render as completed.

### Also verified at this gate
- IDOR: user B fetching user A's scan -> 404 "Scan not found"; B's /scans -> [].
- A failing engine marks only its own row `error` and the sweep still completes (tested).
- Budget exhaustion ends the scan in state `error` with completed_at set, never hanging (tested).
- Findings stay `[]` until state == complete, so the frontend keeps rendering skeletons.

### Operational lesson
A stale uvicorn from GATE 1 was still holding port 8000, so the new server failed to bind and
POST /scan hit the OLD build and 404'd. Stop the previous background server before starting a
new one, or the gate tests the wrong binary.

---

## Phase 5 - Notices

- [x] `app/services/notice.py` - case facts + conditional template, synthetic envelope id
- [x] `app/routers/notices.py` - draft / approve / sign, strict state machine
- [x] `app/deps.py` - `owned_notice` loader
- [x] `app/schemas.py` - NoticeResponse, aliases verified against the frontend Notice interface
- [x] `tests/conftest.py` - `client` / `auth_client` TestClient fixtures (reused from here on)
- [x] `tests/test_notices.py` (17)
- [x] GATE 5 - draft -> approve -> sign, and four out-of-order 409s

### Review - Phase 5 (complete). 124 tests pass. Zero searches spent.

All six transitions proven live:
  sign before approve -> 409; approve -> 200 reviewed; approve twice -> 409;
  sign -> 200 signed with envelopeId=local_594a8ec27fca4a82; sign twice -> 409;
  approve a signed notice -> 409.

### The two state vocabularies, and why both exist
`notices.stage` is the section 4 column: draft | awaiting_signature | signed | delivered |
resolved - that is what /workspace/notices needs in Phase 6. The frontend's `Notice.state` is
only draft | reviewed | signed. `STAGE_TO_STATE` maps one onto the other, so approve writes
stage='awaiting_signature' and the API reports state='reviewed'. Keep them separate; do not
collapse the DB column to the API vocabulary.

### Design decisions worth remembering
- One notice per finding. Re-drafting returns the EXISTING notice rather than creating a new
  one, so clicking generate again can never wipe a signature. Tested.
- `envelope_id` is prefixed `local_` precisely so a synthetic envelope can never be mistaken
  for a real Foxit eSign reference. Phase 7 replaces it and fills `pdf_url`, which is null now.
- Evidence is enumerated line by line in section 4 of the body rather than summarised, because
  the evidence list IS the record.

### Bug fixed during the gate
The template produced "a Omission variant" - correct data, but it read as an unproofed
template, which is the one thing a legal notice must not do. Rephrased to "generated by the
Omission permutation technique". The already-drafted notice row was deleted and regenerated
rather than left inconsistent with the code.

### Still true from Phase 4 and unchanged
The finding this notice is drafted against is `northwindsupply.com`, a real and apparently
legitimate leather-goods business that shares a name with the fictional demo brand. The notice
is technically accurate about what was measured, and it is exactly the case the human review
gate exists for. Do not send it.

---

## Phase 6 - Domains + workspace

- [x] `app/services/namecom.py` - sandbox by default, loud warning if pointed at production
- [x] `app/routers/domains.py` - availability + register, degrades without inventing data
- [x] `app/routers/workspace.py` - all six aggregates, every number counted from rows
- [x] `app/services/sweep.py` - now writes portfolio_domains for domains it actually resolved
- [x] `tests/test_workspace.py` (29)
- [x] GATE 6 - second user created, zero cross-user leakage
- [ ] BLOCKED: live name.com sandbox returns 403 on every endpoint (credentials, see below)

### Review - Phase 6 (isolation complete; live name.com blocked). 153 tests pass.

GATE 6: user B (dana2@vantage-labs.co) created via POST /auth/signup -> 201. All six
workspace routes returned zeroes/[] for B while A saw real rows. A leak scan over B's
JSON for five of A's identifiers found none. B hitting A's ids directly: /scan -> 404,
/notice approve -> 404, /notice sign -> 404, /scans -> [].

### Portfolio status is only ever set by something actually measured
- `hostile`   - resolved in DNS AND tiered CRITICAL/HIGH by the sweep
- `watchlist` - resolved in DNS, tiered MEDIUM/LOW
- `available` - ONLY after name.com answered that it is purchasable
- `protected` - ONLY after a completed registration
A candidate that did not resolve is NOT written as `available`. DNS silence is not proof a
name can be bought, and the mock's static PORTFOLIO must not be reproduced as if measured.
`protected` is never downgraded by a later sweep.

### BLOCKER - name.com: the credentials are PRODUCTION, the base URL is SANDBOX

Corrected 2026-09-01. The earlier diagnosis in this file was wrong and is replaced below.

The earlier note blamed NAMECOM_USERNAME for being an email address. That is not the cause.
Probed directly:

```
api.dev.name.com/v4/hello   robertsamueli40@gmail.com   403 Permission Denied
api.dev.name.com/v4/hello   robertsamueli40             403 Permission Denied
api.dev.name.com/v4/hello   robertsamueli40-test        403 Permission Denied
api.dev.name.com/v4/hello   nosuchuser:nosuchtoken      403 Permission Denied   <- control
api.dev.name.com/v4/hello   (no auth at all)            401 Unauthenticated     <- control
api.name.com/v4/hello       robertsamueli40@gmail.com   200 {"username":"robertsamueli40@gmail.com"}
```

Two things fall out of that. First, name.com's production API accepts the email AS the
username and echoes it back - so the email was never the problem. Second, every username
including deliberate garbage returns the same 403 on the sandbox, while omitting auth
returns 401. A uniform 403 across valid and invalid usernames alike means the sandbox is
not evaluating these credentials at all: the account does not exist there.

dev.name.com is a separate account system from name.com. The token in .env was issued by
the production account, so it authenticates against api.name.com and nowhere else.

Two ways forward, and they are not equivalent:
  1. Create an account at dev.name.com, generate a sandbox token, replace NAMECOM_TOKEN.
     Keeps the money guard intact. Availability results are sandbox fixtures, not real.
  2. Point NAMECOM_BASE_URL at https://api.name.com. Availability checks are read-only and
     free, but /domain/register on production BUYS DOMAINS WITH REAL MONEY. The service
     logs a warning when off-sandbox (namecom.py `_warn_if_production`) - a warning is not
     a guard.

The code path is correct and already proven by stubbed tests; only the credentials are wrong.

### Degradation is honest, and that was verified live
With the sandbox refusing, GET /domain/availability returns
`{available:false, priceUsd:null, premium:false, reason:"name.com returned 403: Permission Denied"}`
and writes NO portfolio row. No price is invented, no availability is guessed, and the real
error is surfaced rather than swallowed.

### Note - trend buckets
Six weekly buckets from findings.created_at, oldest first, labelled Wk 1..Wk 6. All of this
user's findings are from today, so only Wk 6 is populated. That is correct, not a bug.

---

## Phase — Cut the mock layer, wire the frontend to live data

The backend is complete and live-verified. The frontend still runs on fixtures.
Three separate mock layers have to go, not one.

- [x] `.env.local` → mock flag deleted outright, not just set to 0 (nothing reads it now)
- [x] `lib/api.ts` — deleted the staged mock, added `credentials: 'include'` (session cookie is
      cross-origin 3000→8000 and never rode along), added auth + workspace fetchers
- [x] `lib/session.ts` — replaced the localStorage stub with real `/auth/*` calls
- [x] `AuthScreen.tsx` — submits to the real endpoints, surfaces the server's own error text
- [x] `lib/workspace.ts` — deleted NOTICES / PORTFOLIO / SURFACE_STATS / ACTIVITY / TREND /
      INTEGRATIONS fixtures, kept the types, labels and `relativeTime`
- [x] Views — take data as props; `page.tsx` loads all seven `/workspace/*` endpoints in one pass
- [x] Backend — added `GET /workspace/integrations`, the one aggregate with no endpoint
- [x] Verify — 153 backend tests pass, `tsc --noEmit` clean, live sweep driven end to end

### Review

**Three mock layers, not one.** Setting `NEXT_PUBLIC_MOCK=0` alone would have produced a
dead app. The env flag only gated `lib/api.ts`. Two more fixture layers sat behind it:
`lib/session.ts` never called the auth API at all (localStorage stub, any password accepted),
and `lib/workspace.ts` hardcoded every workspace view's data. All three are gone.

**The cookie bug.** `req()` in `lib/api.ts` had no `credentials: 'include'`. The session is an
httpOnly cookie on :8000 and the app is served from :3000 — every authenticated call would
have 401'd the moment mock mode was switched off. This was invisible while mocked.

**Honesty fixes found along the way**
- `SettingsView` claimed all six integrations were "connected", including name.com, which the
  note above records as returning 403. It now reads `GET /workspace/integrations`, which
  derives each status from the presence of credentials in settings. Doctavian correctly
  reports `not_configured`.
- The same view had editable budget fields with a fake "Saved locally" button. Those are
  server-side guardrails, so they are now read-only figures from `/workspace/budget`.
- `FindingsView` hardcoded "Cited by AI: 1" and "Brands watched: 3". Both are now counted
  from the findings actually returned.
- `DomainsView` printed `$${d.priceUsd.toFixed(2)}` unguarded — with name.com declining to
  quote, that renders "$undefined". Now shows "No quote".
- Every list view gained a real empty state; a new workspace shows zeroes, not fixtures.

**Live verification** — signed in over CORS with a real cookie, then swept
`northwind-supply.com`:
```
126 permutations → 1 survived DNS → 2 searches spent, 8 cache hits, 18.9s
CRITICAL  northwindsupply.com  (Omission, mail-capable, 4 evidence items)
          "Cited in AI Mode as a source for the brand query"
```
The overview then reported `openCriticals: 1, hostileDomains: 1`, the portfolio held that one
hostile domain, and drafting a notice from the finding returned a populated `caseFacts` block.
Every number came from a row.

**Not verified:** the rendered UI. Browser tools were unavailable this session, so the visual
confirmation is still outstanding — the API contract, the typecheck and the compile are proven,
the pixels are not.
