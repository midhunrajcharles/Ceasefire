# CEASEFIRE — Backend Build Prompt

> **Status: the frontend is complete and working.** It lives in `Frontend/` (Next.js 14, TypeScript,
> Tailwind) and currently runs against mock data in `Frontend/lib/api.ts` with `NEXT_PUBLIC_MOCK=1`.
>
> **Your job is to build the backend it already expects, and wire the two together so the whole
> application runs end to end with `NEXT_PUBLIC_MOCK=0`.**
>
> **How to use this file.** Open Claude Code in `C:\Users\hp\Downloads\SERP` and say:
> `Read CEASEFIRE_BUILD_PROMPT.md and execute Phase 0 through Phase 9 in order. Stop at every GATE and report.`
>
> Execute top to bottom. Do not skip phases. Do not add endpoints, tables, or abstractions that are
> not in this document.

---

## 0. THE PRODUCT, IN ONE PARAGRAPH

Ceasefire is brand-impersonation reconnaissance. A user signs in, gives a brand name and its primary
domain, and Ceasefire generates lookalike domain permutations, narrows them with free DNS/HTTP
checks, sweeps ten SerpApi search surfaces for anyone impersonating the brand, ranks findings by
harm, and drafts a takedown notice that a human must review and approve before it is signed.
Nothing is ever sent automatically.

The differentiating check is **AI Overview citation poisoning**: `engine=google_ai_overview` returns
the citations Google's AI used to answer a question about the brand. If an impersonator appears
there, the brand's official answer is being sourced from an attacker. No other search API exposes
this.

---

## 1. NON-NEGOTIABLE RULES

**Scope discipline — do not over-engineer.**
- No microservices. One FastAPI app.
- No Celery, Redis, RabbitMQ, or Kubernetes. Background work uses FastAPI `BackgroundTasks`.
- No Alembic yet. `Base.metadata.create_all()` is correct until the schema stabilises.
- No GraphQL, no gRPC, no event bus, no CQRS, no repository-pattern abstraction over the ORM.
- No admin panel, no multi-tenancy beyond `user_id` ownership, no roles/permissions system.
- If a feature is not consumed by a screen in `Frontend/`, do not build it.

**Honesty.**
- No fabricated metrics. Every number the API returns is measured or computed from stored rows.
- Never invent a false-positive rate. Risk tiers are a documented heuristic and the API says so.
- No notice is ever delivered to a registrant by this system. Draft → review → sign. That is all.

**Boundaries.**
- Public search results, public DNS, and public registration state only.
- Nothing behind authentication, nothing that bypasses a control, no CAPTCHA solving.

---

## 2. STACK

| Layer | Choice | Why |
|---|---|---|
| API | **FastAPI** (Python 3.11+) | Async, Pydantic validation, OpenAPI for free |
| ORM | **SQLAlchemy 2.0** (sync) | Sync is simpler here and fast enough; async adds no value at this scale |
| DB | **SQLite** in dev, **Postgres** in prod | One `DATABASE_URL` switches them |
| Passwords | **argon2-cffi** | Modern default, no tuning needed |
| Sessions | **Opaque tokens in httpOnly cookies** | Revocable, not readable by JavaScript |
| HTTP client | **httpx** | Async, timeouts, no redirect surprises |
| DNS | **dnspython** | A/AAAA/MX lookups |
| Tests | **pytest** | |

```
requirements.txt
────────────────
fastapi>=0.115
uvicorn[standard]>=0.32
sqlalchemy>=2.0
pydantic>=2.9
pydantic-settings>=2.6
argon2-cffi>=23.1
httpx>=0.27
dnspython>=2.7
python-dotenv>=1.0
psycopg[binary]>=3.2      # only needed for Postgres
pytest>=8.3
pytest-asyncio>=0.24
```

### Repository layout

```
SERP/
├── Frontend/                    ← already built, do not restructure
├── backend/
│   ├── app/
│   │   ├── main.py              # app factory, CORS, security headers, router mounting
│   │   ├── config.py            # pydantic-settings, reads .env
│   │   ├── db.py                # engine, SessionLocal, get_db dependency
│   │   ├── models.py            # every SQLAlchemy table
│   │   ├── schemas.py           # every Pydantic response model (camelCase!)
│   │   ├── security.py          # hashing, token mint/verify, rate limiter
│   │   ├── deps.py              # current_user, owned-resource loaders
│   │   ├── routers/
│   │   │   ├── auth.py
│   │   │   ├── scans.py
│   │   │   ├── notices.py
│   │   │   ├── domains.py
│   │   │   └── workspace.py
│   │   └── services/
│   │       ├── egress.py        # SSRF controls — WRITE FIRST
│   │       ├── serpapi.py       # cache + token bucket + backoff + page_token
│   │       ├── permutations.py
│   │       ├── prefilter.py     # DNS / MX / HTTP
│   │       ├── sweep.py         # the ten-engine orchestration
│   │       ├── scoring.py
│   │       ├── notice.py        # case facts → conditional template
│   │       └── namecom.py
│   ├── tests/
│   ├── requirements.txt
│   └── .env                     # from env.example — gitignored
├── CEASEFIRE_BUILD_PROMPT.md
├── gitignore
└── env.example
```

---

## 3. THE API CONTRACT — THIS IS THE SPEC

The frontend already calls these exact routes. **Read `Frontend/lib/api.ts` and
`Frontend/lib/types.ts` before writing a single endpoint** — those files are the source of truth
for shapes, and any mismatch is a wiring bug.

### 3.1 CRITICAL: JSON must be camelCase

The frontend TypeScript expects `survivedDns`, `mailCapable`, `aiOverviewCited`, `searchesSpent`,
`cacheHit`, `completedAt`, `findingCount`, `criticalCount`, `bodyMarkdown`, `caseFacts`, `priceUsd`.

Python is snake_case. Configure every response schema to serialise camelCase:

```python
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )
```

Every response model inherits `ApiModel`, and every route returns with
`response_model_by_alias=True` (the FastAPI default). **This single detail is the most common cause
of a silently broken wire-up — get it right in Phase 1, not Phase 8.**

Request bodies stay snake_case where the frontend already sends snake_case: `POST /scan/{id}/notice`
sends `{"finding_id": "..."}`. Check `api.ts` for each one rather than assuming.

### 3.2 Auth

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/signup` | `{email, password, organisation}` | `{email, organisation, createdAt}` + sets session cookie |
| POST | `/auth/signin` | `{email, password}` | same |
| POST | `/auth/signout` | — | `204`, clears cookie, revokes session row |
| GET | `/auth/me` | — | same session shape, or `401` |

Validation rules (must match the frontend, which already enforces them client-side):
- Email must be a valid address.
- **Signup rejects free-mail domains** — gmail, googlemail, yahoo, outlook, hotmail, live, icloud,
  me, proton, protonmail, aol, gmx, yandex, mail, zoho. Error: *"Use a work address — the domain you
  want to protect."* The frontend's list is in `Frontend/lib/session.ts` — mirror it exactly.
- Password minimum 10 characters on signup.
- Signup with an existing email returns `409`.
- **Signin returns the same generic `401` for unknown-email and wrong-password.** Do not leak which.

### 3.3 Scans

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| POST | `/scan` | `{brand, domain}` | `{id}` — starts the sweep as a background task |
| GET | `/scan/{id}` | — | full `Scan` (frontend polls this every 500ms) |
| GET | `/scans` | — | `ScanSummary[]`, newest first |

`Scan` shape — match `Frontend/lib/types.ts` exactly:

```jsonc
{
  "id": "...", "brand": "...", "domain": "...",
  "state": "generating|prefiltering|sweeping|scoring|complete|error",
  "prefilter": { "generated": 204, "survivedDns": 41, "mailCapable": 9, "survivedHttp": 18 },
  "engines": [ { "id": "google", "label": "Google Search", "purpose": "...",
                 "headline": false, "state": "done", "findings": 2,
                 "searchesSpent": 1, "cacheHit": false, "ms": 480 } ],
  "findings": [ { "id": "...", "domain": "...", "tier": "CRITICAL",
                  "reason": "...", "technique": "Homoglyph",
                  "mailCapable": true, "live": true, "registered": true,
                  "aiOverviewCited": true,
                  "evidence": [ { "engine": "google_ai_overview", "url": "...",
                                  "snippet": "...", "fetchedAt": "..." } ] } ],
  "budget": { "total": 250, "spent": 14, "cacheHits": 3 },
  "startedAt": "...", "completedAt": "...", "elapsedMs": 12600,
  "error": null, "isMock": false
}
```

- `findings` is `[]` until `state == "complete"`. The frontend renders skeletons on that.
- `engines` must contain all ten in the order defined in `Frontend/lib/types.ts` `ENGINES`, with
  `label`, `purpose` and `headline` copied verbatim so the UI text matches.
- `isMock` is always `false` from the real backend.

### 3.4 Notices

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/scan/{scan_id}/notice` | `{finding_id}` | `Notice` in state `draft` |
| POST | `/notice/{id}/approve` | — | `Notice` in state `reviewed` |
| POST | `/notice/{id}/sign` | — | `Notice` in state `signed`, with `envelopeId` and `signedAt` |

`Notice`: `{id, findingId, domain, caseFacts: {…}, bodyMarkdown, state, reviewed, signed, signedAt, pdfUrl, envelopeId}`

**`approve` must reject if the notice is not in `draft`. `sign` must reject if it is not in
`reviewed` (`409`).** The review gate is a real state machine, not a UI convention.

### 3.5 Domains

| Method | Path | Query / Body | Returns |
|---|---|---|---|
| GET | `/domain/availability` | `?domain=` | `{domain, available, priceUsd, premium, reason}` |
| POST | `/domain/register` | `{domain}` | `{ok, orderId}` |

Registration uses the **name.com sandbox** (`https://api.dev.name.com`) unless
`NAMECOM_BASE_URL` says otherwise. Never call production without an explicit env change.

### 3.6 Workspace aggregates

These currently come from static data in `Frontend/lib/workspace.ts`. Replace that file's exports
with fetches to these endpoints in Phase 8.

| Method | Path | Returns |
|---|---|---|
| GET | `/workspace/overview` | `{stats: {openCriticals, hostileDomains, noticesInFlight}, trend: TrendPoint[], activity: ActivityEvent[]}` |
| GET | `/workspace/findings` | Findings across all scans, newest first |
| GET | `/workspace/notices` | `NoticeRecord[]` — `{id, domain, tier, stage, createdAt, updatedAt, registrar}` |
| GET | `/workspace/domains` | `PortfolioDomain[]` — `{domain, status, technique, registrar, expiresAt, priceUsd, mailCapable, firstSeen}` |
| GET | `/workspace/surfaces` | `SurfaceStat[]` — `{id, findingsAllTime, searchesSpent, avgMs, cacheHitRate}` |
| GET | `/workspace/budget` | `{total, spent, cacheHits}` |

`stage` values: `draft | awaiting_signature | signed | delivered | resolved`.
`status` values: `protected | hostile | watchlist | available`.

---

## 4. DATABASE

Twelve tables. No more. Every user-owned row carries `user_id` and every read filters on it.

```
users
  id TEXT PK (uuid4)
  email TEXT UNIQUE NOT NULL          -- stored lowercased
  password_hash TEXT NOT NULL         -- argon2
  organisation TEXT NOT NULL
  created_at TIMESTAMP NOT NULL

sessions
  id TEXT PK
  user_id TEXT FK -> users.id ON DELETE CASCADE
  token_hash TEXT UNIQUE NOT NULL     -- sha256 of the cookie value; raw token never stored
  created_at TIMESTAMP NOT NULL
  expires_at TIMESTAMP NOT NULL
  revoked_at TIMESTAMP NULL
  INDEX (token_hash), INDEX (user_id)

scans
  id TEXT PK
  user_id TEXT FK -> users.id
  brand TEXT NOT NULL
  domain TEXT NOT NULL
  state TEXT NOT NULL
  prefilter_generated INT DEFAULT 0
  prefilter_dns INT DEFAULT 0
  prefilter_mail INT DEFAULT 0
  prefilter_http INT DEFAULT 0
  searches_spent INT DEFAULT 0
  cache_hits INT DEFAULT 0
  error TEXT NULL
  started_at TIMESTAMP NOT NULL
  completed_at TIMESTAMP NULL
  INDEX (user_id, started_at DESC)

scan_engines
  id INT PK AUTOINCREMENT
  scan_id TEXT FK -> scans.id ON DELETE CASCADE
  engine_id TEXT NOT NULL             -- 'google', 'google_ai_overview', ...
  position INT NOT NULL               -- preserves the fixed UI order
  state TEXT NOT NULL
  findings_count INT DEFAULT 0
  searches_spent INT DEFAULT 0
  cache_hit BOOLEAN DEFAULT FALSE
  ms INT NULL

findings
  id TEXT PK
  scan_id TEXT FK -> scans.id ON DELETE CASCADE
  user_id TEXT FK -> users.id
  domain TEXT NOT NULL
  tier TEXT NOT NULL                  -- CRITICAL | HIGH | MEDIUM | LOW
  reason TEXT NOT NULL
  technique TEXT NULL
  mail_capable BOOLEAN DEFAULT FALSE
  live BOOLEAN DEFAULT FALSE
  registered BOOLEAN DEFAULT FALSE
  ai_overview_cited BOOLEAN DEFAULT FALSE
  created_at TIMESTAMP NOT NULL
  INDEX (scan_id), INDEX (user_id)

evidence
  id INT PK AUTOINCREMENT
  finding_id TEXT FK -> findings.id ON DELETE CASCADE
  engine TEXT NOT NULL
  url TEXT NOT NULL
  snippet TEXT NOT NULL
  fetched_at TIMESTAMP NOT NULL

notices
  id TEXT PK
  user_id TEXT FK -> users.id
  finding_id TEXT FK -> findings.id
  domain TEXT NOT NULL
  tier TEXT NOT NULL
  stage TEXT NOT NULL                 -- draft | awaiting_signature | signed | delivered | resolved
  case_facts_json TEXT NOT NULL
  body_markdown TEXT NOT NULL
  registrar TEXT NULL
  envelope_id TEXT NULL
  pdf_url TEXT NULL
  signed_at TIMESTAMP NULL
  created_at TIMESTAMP NOT NULL
  updated_at TIMESTAMP NOT NULL
  INDEX (user_id, updated_at DESC)

portfolio_domains
  id INT PK AUTOINCREMENT
  user_id TEXT FK -> users.id
  domain TEXT NOT NULL
  status TEXT NOT NULL                -- protected | hostile | watchlist | available
  technique TEXT NULL
  registrar TEXT NULL
  price_usd NUMERIC NULL
  mail_capable BOOLEAN DEFAULT FALSE
  expires_at TIMESTAMP NULL
  first_seen TIMESTAMP NOT NULL
  UNIQUE (user_id, domain)

serp_cache
  id INT PK AUTOINCREMENT
  engine TEXT NOT NULL
  params_hash TEXT NOT NULL           -- sha256(engine + sorted params)
  response_json TEXT NOT NULL
  fetched_at TIMESTAMP NOT NULL
  hit_count INT DEFAULT 0
  UNIQUE (engine, params_hash)
  -- shared across users: a search result is not private data, and this is what
  -- makes 250 searches/month survivable. Findings derived from it ARE per-user.

search_budget
  id INT PK AUTOINCREMENT
  user_id TEXT FK -> users.id
  period TEXT NOT NULL                -- 'YYYY-MM'
  spent INT DEFAULT 0
  cache_hits INT DEFAULT 0
  UNIQUE (user_id, period)

activity
  id INT PK AUTOINCREMENT
  user_id TEXT FK -> users.id
  kind TEXT NOT NULL                  -- sweep | finding | notice | domain | system
  text TEXT NOT NULL
  emphasis BOOLEAN DEFAULT FALSE
  at TIMESTAMP NOT NULL
  INDEX (user_id, at DESC)

auth_attempts
  id INT PK AUTOINCREMENT
  key TEXT NOT NULL                   -- ip + ':' + email
  at TIMESTAMP NOT NULL
  INDEX (key, at)
```

Create with `Base.metadata.create_all(engine)` on startup. Add Alembic only when the schema stops
changing — not now.

---

## 5. SECURITY

Not optional, and not decoration. Implement all of it.

### 5.1 Authentication

- **Argon2** via `argon2-cffi` with library defaults. Never write your own hashing.
- Session token: `secrets.token_urlsafe(32)`. Store **only** `sha256(token)` in `sessions.token_hash`.
  A database dump must not yield usable sessions.
- Cookie: `httponly=True`, `samesite="lax"`, `secure=True` when `ENVIRONMENT=production`,
  `max_age=30 days`, `path="/"`.
- Sign-out sets `revoked_at` **and** deletes the cookie. A revoked token must fail immediately.
- Every authenticated request: look up by `token_hash`, reject if missing, revoked, or expired.

### 5.2 Same-origin via the Next.js proxy

httpOnly cookies do not survive a cross-origin XHR from `localhost:3000` to `localhost:8000` without
`SameSite=None; Secure`, which needs HTTPS in dev. Avoid the whole problem — add a rewrite so the API
is same-origin:

```js
// Frontend/next.config.mjs
const nextConfig = {
  async rewrites() {
    return [{
      source: '/api/:path*',
      destination: `${process.env.BACKEND_ORIGIN ?? 'http://localhost:8000'}/:path*`,
    }];
  },
};
export default nextConfig;
```

Then set `NEXT_PUBLIC_API_BASE=/api` and every request is same-origin. `fetch` must send
`credentials: 'same-origin'`.

### 5.3 Authorisation — the IDOR rule

**Every** route that loads a scan, finding, notice, or domain by id must filter on
`user_id == current_user.id` in the same query. Never fetch-then-check.

```python
scan = db.query(Scan).filter(Scan.id == scan_id, Scan.user_id == user.id).first()
if not scan:
    raise HTTPException(404)   # 404, not 403 — do not confirm the id exists
```

Write one dependency in `deps.py` for each owned resource and use it everywhere.

### 5.4 SSRF controls — `services/egress.py`, write this FIRST

The prefilter fetches URLs derived from generated domains and search results. That is
attacker-influenced input reaching your HTTP client.

```python
ALLOWED_SCHEMES = {"http", "https"}
BLOCKED_V4 = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8",
              "169.254.0.0/16", "0.0.0.0/8", "100.64.0.0/10", "224.0.0.0/4"]
BLOCKED_V6 = ["::1/128", "fc00::/7", "fe80::/10"]
MAX_REDIRECTS = 3
TIMEOUT_SECONDS = 8
MAX_RESPONSE_BYTES = 2_000_000
```

Required behaviour:
1. Scheme allowlist.
2. **Resolve DNS first and check the resolved IP**, not the hostname — this is what blocks DNS
   rebinding.
3. Re-check after **every** redirect hop. Cap at 3.
4. Hard timeout, response size cap.
5. Never forward cookies, auth headers, or any API key.

These must be **rejected** — put them in `tests/test_egress.py`:

```
http://169.254.169.254/latest/meta-data/     # cloud metadata
http://127.0.0.1:8000/                        # loopback
http://[::1]:8000/                            # v6 loopback
http://localtest.me/                          # public name resolving to 127.0.0.1
file:///etc/passwd                            # scheme
http://evil.example -> 302 -> http://10.0.0.1/  # redirect into private space
```

### 5.5 Rate limiting

- `/auth/signin` and `/auth/signup`: **5 attempts per 15 minutes** per `(ip, email)`, via the
  `auth_attempts` table. Return `429` past the limit.
- `POST /scan`: max 5 per user per hour. Searches are the scarce resource.

### 5.6 Everything else

- CORS: `allow_origins` from env, exactly one origin, `allow_credentials=True`. Never `["*"]` with
  credentials.
- Security headers middleware: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`.
- All input through Pydantic. All queries through the ORM — no f-string SQL, ever.
- Never log passwords, tokens, cookies, or API keys. Log the `params_hash`, not the params.
- `password_hash` never appears in any response schema. Build response models field-by-field; never
  serialise an ORM object wholesale.
- Generic errors to the client, detail to the server log.

---

## 6. SERPAPI LAYER — `services/serpapi.py`

**Every SerpApi call goes through this module. No direct `httpx` calls to serpapi.com anywhere else.**

Free tier: **250 searches/month, 50/hour.** This is the tightest constraint in the system.

```python
class SerpApiClient:
    REFILL_RATE = 50 / 3600     # tokens per second
    BURST = 10

    async def search(self, engine: str, params: dict,
                     user_id: str, no_cache: bool = False) -> dict:
        """
        1. params_hash = sha256(engine + json.dumps(params, sort_keys=True))
        2. Unless no_cache: check serp_cache. On hit -> increment hit_count,
           increment search_budget.cache_hits, return. NO search spent.
        3. Acquire a token from the bucket (async wait if empty).
        4. Check search_budget.spent against SEARCH_BUDGET_TOTAL. If exceeded,
           raise BudgetExhausted -> scan ends in state 'error' with a clear message.
        5. Call SerpApi with output=md where the engine supports it.
        6. On 429: exponential backoff with jitter, max 4 attempts.
        7. Persist to serp_cache. Increment search_budget.spent.
        """
```

**`page_token` — the detail most implementations get wrong.** `ai_overview.page_token` expires in
under 60 seconds. Fetch it inline, immediately, per result. Never batch a list of tokens for a
later pass.

```python
async def google_with_ai_overview(self, query: str, user_id: str) -> dict:
    base = await self.search("google", {"q": query}, user_id, no_cache=True)
    token = base.get("ai_overview", {}).get("page_token")
    if token:
        # Must be immediate. Do not await anything else between these two lines.
        ao = await self.search("google_ai_overview", {"page_token": token},
                               user_id, no_cache=True)
        base["ai_overview_full"] = ao
    return base
```

**`no_cache` policy.** Set `no_cache=True` on threat-verification paths — a cached result is a
missed detection. Leave caching on for trend queries where staleness is harmless.

**Resumable scans.** Persist `scan_engines` rows after every engine completes. A scan interrupted by
a 429 or a crash resumes from stored state rather than re-spending searches.

**The ten engines** — ids, labels, purposes and the `headline` flag come from
`Frontend/lib/types.ts` `ENGINES`. Copy them verbatim into a Python constant so the UI text matches.
Verify each engine identifier against SerpApi's current docs before wiring it.

---

## 7. THE PIPELINE

```
  brand + primary domain
        │
  [1] PERMUTATIONS          services/permutations.py     free — no API calls
      homoglyph / omission / transposition / insertion /
      TLD swap / hyphenation / combosquat  → ~200 candidates
        │
  [2] PREFILTER             services/prefilter.py        free — no searches
      DNS A/AAAA resolves?   → ~40 survive
      MX records present?    → flags mail_capable
      HTTP 200 + <title>?    → ~20 survive   [EGRESS-GUARDED]
        │
  [3] SWEEP                 services/sweep.py            ← searches spent HERE only
      ten engines, cache-first, token-bucket limited
        │
  [4] SCORE                 services/scoring.py
        │
  [5] NOTICE                services/notice.py           on user request
      case facts → conditional template → draft → review gate
```

### 7.1 Permutations

Match `PERMUTATION_TECHNIQUES` in `Frontend/lib/types.ts`. **Every generated candidate must differ
from the input domain** — the frontend had a bug where a homoglyph swap was a no-op and a "finding"
rendered as the customer's own domain. Try each substitution in turn and fall back to doubling a
middle character. Assert `candidate != original` before yielding.

### 7.2 Prefilter — the funnel that makes the budget survivable

```
200 generated
  → DNS resolves?     ~40 survive     (dnspython, free)
  → MX records?       flags mail_capable = phishing-ready
  → HTTP 200 + title? ~20 survive     (egress-guarded, free)
  → THEN spend SerpApi searches on survivors only
```

Cap the number of candidates that reach the sweep at `DEMO_MAX_PERMUTATIONS` (default 15).

### 7.3 Risk tiering — `services/scoring.py`

| Tier | Trigger |
|---|---|
| **CRITICAL** | Cited in AI Overview or AI Mode for brand queries |
| **HIGH** | Live page **and** MX records present (mail-capable) |
| **HIGH** | App-store listing using the brand name or logo |
| **MEDIUM** | Local-pack listing, or counterfeit commerce listing |
| **LOW** | Registered and parked, or unregistered (defensive-registration candidate) |

Attach `evidence` rows with `engine`, `url`, `snippet`, `fetched_at` to every finding. Emit no
confidence score you cannot defend.

### 7.4 Notice generation — `services/notice.py`

**Case facts in, conditional template out. Not prose from a language model.**

Build a `case_facts` dict — `registrant_domain`, `rights_holder`, `first_observed`, `harm_class`,
`permutation_technique`, `evidence_count`, `mail_capable` — then render Markdown through conditional
branches. The frontend's `mockNotice` in `Frontend/lib/api.ts` shows the exact structure and body
sections the UI is laid out for; reproduce them.

Sponsor integrations (**Phase 7, only after the core loop is green**):
- **Foxit** — MCP server at `github.com/foxitsoftware/foxit-pdf-api-mcp-server`, render the notice
  to PDF, then eSign. Free tier: 500 credits, no card.
- **Doctavian** — conditional-template generation with eIDAS-aligned signature.
- **Nutrient** — the review gate viewer the frontend already renders around.

If any of these are not configured, `sign` must still succeed with a locally generated PDF and a
synthetic `envelope_id`. **A missing sponsor key must never break the core loop.**

---

## 8. PHASES

---

### PHASE 0 — Scaffold + database
Create `backend/`, `requirements.txt`, `config.py`, `db.py`, `models.py` with all twelve tables,
and `main.py` with a `/health` route. `create_all` on startup.

> **🚦 GATE 0** — `uvicorn app.main:app --reload` starts, `GET /health` returns 200, and
> `ceasefire.db` exists with all twelve tables. Report the table list.

---

### PHASE 1 — Auth, end to end
`security.py` (argon2, token mint/verify, rate limiter), `deps.py` (`current_user`), `routers/auth.py`
with all four routes. camelCase serialisation configured **now**, not later.

> **🚦 GATE 1** — Prove with curl and paste the output: signup sets a cookie; `/auth/me` returns the
> user; signout returns 204; `/auth/me` then returns 401; signup with `test@gmail.com` returns the
> free-mail error; six rapid bad signins return 429.

---

### PHASE 2 — Egress + SerpApi client
`services/egress.py` first, then `services/serpapi.py` with cache, token bucket, backoff, budget
enforcement, and the inline `page_token` handling.

> **🚦 GATE 2** — `pytest tests/test_egress.py` passes with all six SSRF cases rejected. Then a live
> `google_ai_overview` call returns citations for a real brand.
>
> **If AI Overview does not return citations reliably, STOP AND REPORT.** The whole differentiator
> depends on it and the fallback plan is different.

---

### PHASE 3 — Permutations + prefilter
`services/permutations.py` and `services/prefilter.py`. No searches spent in this phase.

> **🚦 GATE 3** — Given `northwind-supply.com`, print the funnel counts and assert every candidate
> differs from the input.

---

### PHASE 4 — The sweep
`services/sweep.py` and `services/scoring.py`, `routers/scans.py` with all three routes. Run as a
`BackgroundTask`, writing `scan_engines` rows as each engine completes so polling shows live progress.

> **🚦 GATE 4** — `POST /scan` then poll `GET /scan/{id}` and show it moving through
> `generating → prefiltering → sweeping → scoring → complete` with findings at the end. Report
> searches actually spent.

---

### PHASE 5 — Notices
`services/notice.py`, `routers/notices.py`. Enforce the state machine: `draft → reviewed → signed`,
`409` on any out-of-order transition.

> **🚦 GATE 5** — Draft, approve, sign. Show the 409 when signing an unapproved notice.

---

### PHASE 6 — Domains + workspace aggregates
`routers/domains.py` (name.com **sandbox**) and `routers/workspace.py` (all six aggregate routes,
computed from real rows).

> **🚦 GATE 6** — Every workspace route returns real data for the signed-in user and `[]` for a
> second, empty user. Confirm no cross-user leakage.

---

### PHASE 7 — Sponsor integrations
Foxit PDF + eSign, Doctavian, Nutrient. Each behind a feature check that degrades gracefully.

> **🚦 GATE 7** — Sign a notice with the keys set, then unset each key and confirm the core loop
> still completes.

---

### PHASE 8 — Wire the frontend
This is the phase that makes it one application. Changes in `Frontend/`:

1. `next.config.mjs` — add the `/api/:path*` rewrite from §5.2.
2. `.env.local` — `NEXT_PUBLIC_API_BASE=/api`, `NEXT_PUBLIC_MOCK=0`.
3. `lib/api.ts` — add `credentials: 'same-origin'` to every `fetch`; delete the mock fixtures and
   `MOCK_MODE` branches once the real API is confirmed working.
4. `lib/session.ts` — replace `localStorage` with calls to `/auth/signup`, `/auth/signin`,
   `/auth/signout`, `/auth/me`. Keep the exported function names and the `Session` shape so
   `AuthScreen.tsx`, `UserMenu.tsx` and `app/page.tsx` do not change. Keep the free-mail list.
5. `lib/workspace.ts` — replace the static exports with fetches to `/workspace/*`. Keep the type
   definitions.
6. `app/page.tsx` — session restore becomes an async `/auth/me` call; show nothing until it resolves
   (`sessionChecked` already handles this).

> **🚦 GATE 8** — With both servers running: hold to enter → create account → sweep a real domain →
> findings appear → draft, approve and sign a notice → sign out → sign back in and the scan history
> is still there. **Screenshot each step.**

---

### PHASE 9 — Harden and verify

- `pytest` green: egress, auth, IDOR (user A cannot read user B's scan), notice state machine,
  budget enforcement.
- Confirm no secret appears in any response: `grep -ri "password_hash\|api_key\|token_hash" app/schemas.py` returns nothing.
- `backend/README.md`: setup, env vars, the endpoint table, and the search-budget explanation.
- Confirm `.env` is gitignored and `git status` shows no secrets.

> **🚦 GATE 9** — Paste the full pytest output and the final `git status`.

---

## 9. WHAT NOT TO BUILD

Explicitly out of scope. Adding any of these is over-engineering:

- ❌ Password reset / email verification / magic links (no mail provider in scope)
- ❌ OAuth or SSO
- ❌ Roles, permissions, teams, or org invitations
- ❌ Scheduled or recurring scans, webhooks, notifications
- ❌ **Any email sending whatsoever** — the notice is drafted and signed, never delivered
- ❌ Admin dashboard, billing, subscriptions
- ❌ WebSockets (polling every 500ms already works and the frontend does it)
- ❌ Caching layer beyond `serp_cache`, message queues, worker processes
- ❌ Any ML model — tiering is a documented heuristic and saying so is stronger
- ❌ Alembic migrations until the schema stops changing
- ❌ Docker/Kubernetes/CI unless explicitly asked for later

---

## 10. FIRST COMMAND

```bash
cd backend && python -m venv .venv && .venv/Scripts/activate && pip install -r requirements.txt && uvicorn app.main:app --reload
```

Then work Phase 0 → Phase 9, stopping at every gate.

---

## 11. THE STANDING REMINDER

The frontend is finished and it is the specification. When something is ambiguous, the answer is in
`Frontend/lib/types.ts`, `Frontend/lib/api.ts`, or `Frontend/lib/workspace.ts` — read those files
rather than guessing, and match them exactly.

Three things sink this build if you get them wrong, and all three are cheap to get right up front:
**camelCase serialisation** (Phase 1), **SSRF egress controls** (Phase 2), and **`user_id` filtering
on every owned-resource query** (throughout). Everything else is ordinary work.
