# Ceasefire — Backend

FastAPI service behind the Ceasefire frontend. It generates lookalike-domain
permutations for a brand, narrows them with DNS/MX/HTTP checks, sweeps ten search
surfaces through SerpApi, ranks what it finds by how dangerous it is, and drafts a
takedown notice for a person to review.

**Every number this API returns is a count, sum or average over stored rows belonging
to the signed-in user.** Nothing is seeded, estimated or carried over from fixtures. If
an upstream service refuses, the route says so in a `reason` field rather than inventing
a value.

---

## Setup

Requires Python 3.11+.

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate          # Windows;  source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt

cp ../env.example .env          # then fill in the keys below
uvicorn app.main:app --reload
```

The API listens on `http://localhost:8000`. Interactive docs are at `/docs` in
development and are switched off when `ENVIRONMENT=production`.

Tables are created on startup; there is no migration step. The default database is a
SQLite file (`backend/ceasefire.db`) created on first run.

> **`.env` is read once at import and cached.** `uvicorn --reload` watches `.py` files
> only, so after editing `.env` you must restart the process — a reload will not pick
> it up.

### Frontend

The frontend proxies `/api/*` to this service (`Frontend/next.config.mjs`), so requests
are same-origin and the session cookie is sent normally. Run `npm run dev` in
`Frontend/` with the backend already up. `CORS_ORIGIN` still needs to match the
frontend's origin for any direct cross-origin call.

### Tests

```bash
pytest              # 194 tests, no network access required
```

Tests run against an in-memory SQLite database and never touch `ceasefire.db`.

---

## Environment variables

Copy `env.example` to `backend/.env`. Every third-party integration is optional and
degrades gracefully — a missing key disables that feature and is reported as
`not_configured` by `GET /workspace/integrations`, rather than failing a request.

### Core

| Variable | Default | Notes |
|---|---|---|
| `ENVIRONMENT` | `development` | `production` disables `/docs` and sets `Secure` on the session cookie |
| `SECRET_KEY` | — | Required. Long random string |
| `DATABASE_URL` | `sqlite:///./ceasefire.db` | Postgres works via `psycopg`: `postgresql+psycopg://…` |
| `CORS_ORIGIN` | `http://localhost:3000` | Exactly one origin. Never `*` — credentials ride on every request |
| `LOG_LEVEL` | `INFO` | |

### Sessions and auth

| Variable | Default | Notes |
|---|---|---|
| `SESSION_COOKIE_NAME` | `ceasefire_session` | |
| `SESSION_TTL_DAYS` | `30` | |
| `AUTH_MAX_ATTEMPTS` | `5` | Failed signins per window, keyed on (IP, email) |
| `AUTH_WINDOW_MINUTES` | `15` | |

### SerpApi and the search budget

| Variable | Default | Notes |
|---|---|---|
| `SERPAPI_KEY` | — | Required for sweeps |
| `SEARCH_BUDGET_TOTAL` | `250` | Searches per user per calendar month |
| `SEARCH_BUDGET_ALERT_AT` | `200` | Warning threshold |
| `SERPAPI_RATE_PER_HOUR` | `50` | Token bucket, jittered backoff |
| `SERPAPI_BURST` | `10` | |
| `DEMO_MAX_PERMUTATIONS` | `15` | Hard cap on candidates reaching the sweep |
| `SERP_CACHE_TTL_HOURS` | `24` | Repeat queries inside this window spend nothing |

### Egress / SSRF guards

| Variable | Default | Notes |
|---|---|---|
| `EGRESS_TIMEOUT_SECONDS` | `8` | |
| `EGRESS_MAX_REDIRECTS` | `3` | Each hop is re-validated |
| `EGRESS_MAX_RESPONSE_BYTES` | `2000000` | Body is truncated past this |

### Integrations (all optional)

| Variable | Notes |
|---|---|
| `FOXIT_CLIENT_ID` / `FOXIT_CLIENT_SECRET` / `FOXIT_BASE_URL` | PDF generation and eSign |
| `DOCTAVIAN_API_KEY` / `DOCTAVIAN_BASE_URL` | Conditional-template notices; falls back to the built-in template |
| `NUTRIENT_API_KEY` | Embedded review gate |
| `NAMECOM_USERNAME` / `NAMECOM_TOKEN` / `NAMECOM_BASE_URL` | Availability and defensive registration |

> **name.com is sandboxed by default.** `NAMECOM_BASE_URL` is `https://api.dev.name.com`
> and sandbox credentials are a **separate account** from production — the two are not
> interchangeable, and a production token returns `403 Permission Denied` against the
> sandbox. Pointing at `https://api.name.com` makes `POST /domain/register` spend real
> money; the service logs a warning when off-sandbox, but a warning is not a guard.

---

## Endpoints

All responses are camelCase. All routes except `/health` and the two sign-in routes
require the session cookie.

### Auth

| Method | Path | Returns |
|---|---|---|
| `POST` | `/auth/signup` | `201` + session cookie. Rejects free-mail domains and passwords under 10 characters |
| `POST` | `/auth/signin` | `200` + session cookie. Wrong password and unknown email give an identical `401` |
| `POST` | `/auth/signout` | `204`. Revokes the row server-side, not just the cookie |
| `GET` | `/auth/me` | The signed-in user, or `401` |

### Scans

| Method | Path | Returns |
|---|---|---|
| `POST` | `/scan` | `202` + scan id. Runs in the background. Rate-limited per user per hour |
| `GET` | `/scan/{id}` | Full scan: prefilter funnel, per-engine status, findings, budget |
| `GET` | `/scans` | Scan history for the signed-in user |

A scan moves through `generating → prefiltering → sweeping → scoring → complete`, or
`error`. Poll `GET /scan/{id}` to follow it.

### Notices

| Method | Path | Returns |
|---|---|---|
| `POST` | `/scan/{id}/notice` | Drafts a notice from a finding |
| `POST` | `/notice/{id}/approve` | Marks it reviewed by a person |
| `POST` | `/notice/{id}/sign` | Routes it for signature. `409` if not yet approved |

**Nothing is ever delivered to a registrant automatically.** The state machine is
`draft → reviewed → signed`, and signing an unapproved notice is a `409`.

### Domains

| Method | Path | Returns |
|---|---|---|
| `GET` | `/domain/availability?domain=` | `{available, priceUsd, premium, reason}`. Never fabricates a price — an upstream failure is reported in `reason` |
| `POST` | `/domain/register` | Defensive registration through name.com |

### Workspace aggregates

| Method | Path | Returns |
|---|---|---|
| `GET` | `/workspace/overview` | Stats, six weekly trend buckets, recent activity |
| `GET` | `/workspace/findings` | Every finding across every scan, with evidence |
| `GET` | `/workspace/notices` | Every notice and its stage |
| `GET` | `/workspace/domains` | The lookalike portfolio |
| `GET` | `/workspace/surfaces` | Per-engine totals. All ten engines always returned; an unused one reports zeroes |
| `GET` | `/workspace/integrations` | Which services are configured on this deployment |
| `GET` | `/workspace/budget` | `{total, spent, cacheHits}` for the current month |

### Health

`GET /health` → `{"status": "ok", "environment": "…"}`. No auth required.

---

## The search budget

SerpApi's free tier is the scarce resource, so the pipeline is built around spending as
few searches as possible. A naive sweep of 126 permutations across 10 surfaces would be
1,260 searches — five months of budget in one run. Four mechanisms bring that down to
roughly 2–4 searches per sweep:

**1. The prefilter runs before any search is spent.** Generated permutations are checked
with DNS, then MX, then a single HTTP request. A domain that does not resolve cannot be
impersonating anyone, and costs nothing to rule out. In practice 126 candidates narrow
to 1–3 before SerpApi is touched at all. These checks are free.

**2. A hard cap on candidates.** `DEMO_MAX_PERMUTATIONS` (default 15) limits what reaches
the sweep regardless of how many survive. A 60-permutation sweep would consume a quarter
of the monthly budget in a single run.

**3. A result cache.** Identical queries inside `SERP_CACHE_TTL_HOURS` (default 24) are
served from the database and spend nothing. Repeat sweeps of the same brand are close to
free — a typical second run reports more cache hits than searches. Verification paths set
`no_cache`, because a stale result there is a missed detection.

**4. A token bucket.** `SERPAPI_RATE_PER_HOUR` and `SERPAPI_BURST` throttle throughput
with jittered backoff. A scan that hits the ceiling pauses and resumes rather than
failing.

Spending is metered per user per calendar month in the `search_budget` table and is
enforced *before* the call, not after — the ceiling raises rather than overspending.
`GET /workspace/budget` reports `{total, spent, cacheHits}`, and every figure is summed
from rows.

---

## Security

- **Passwords** are hashed with Argon2id. The plaintext is never stored or logged.
- **Sessions** are opaque 32-byte tokens in an httpOnly cookie. Only the sha256 is
  persisted, so the database cannot yield a working token. Signing out sets
  `revoked_at`, which kills a copied token immediately.
- **Authorisation (the IDOR rule).** Owned-resource loaders filter on `user_id` in the
  same query as the id and return `404`, never `403` — a `403` would confirm the id
  exists. A second user sees zeroes and empty lists, never a trace of the first.
- **SSRF controls.** `services/egress.py` resolves the hostname, rejects private,
  loopback, link-local and cloud-metadata ranges, pins the validated IP for the actual
  connection, re-validates every redirect hop, and caps the response body. A public
  hostname with one private answer is rejected outright.
- **Rate limiting.** Auth attempts are limited per (IP, email); scans are limited per
  user per hour.
- **Responses carry no secrets.** Response models are built field by field and an ORM
  object is never serialised wholesale, so `password_hash` and `token_hash` cannot ride
  along. Logs record a `params_hash`, not the params.

---

## Layout

```
app/
  main.py          app factory, CORS, security headers, router mounting
  config.py        settings, read from backend/.env
  db.py            engine, session, create_all
  models.py        SQLAlchemy tables
  schemas.py       request/response models (responses serialise as camelCase)
  security.py      passwords, session tokens, rate limiting
  deps.py          current user, owned-resource loaders
  routers/         auth, scans, notices, domains, workspace
  services/
    egress.py      SSRF-guarded HTTP client
    serpapi.py     the ten search surfaces, budget and cache
    permutations.py, prefilter.py, sweep.py, scoring.py
    notice.py, namecom.py
tests/             194 tests
```
