# How Ceasefire works

Every diagram below is drawn from the code, not from intent. File and function names are
real; follow them into `backend/app/` to check any claim here.

---

## 1 · The whole pipeline, end to end

One brand domain in, a tiered set of findings and a drafted takedown notice out. The rule
the whole design turns on: **every expensive stage is protected by a free one.**

```mermaid
flowchart TD
    IN["Brand domain<br/>example.com"]

    subgraph GEN["STAGE 1 · GENERATE &mdash; costs nothing"]
        direction TB
        G1["services/permutations.py"]
        G2["7 techniques<br/>homoglyph · omission · transposition · insertion<br/>tld-swap · hyphenation · combosquat"]
        G3["Cyrillic confusables resolved to punycode<br/>ascii_domain carries the form used for DNS"]
        G1 --> G2 --> G3
    end

    C1["~126 candidates"]

    subgraph PRE["STAGE 2 · PREFILTER &mdash; free, spends no search"]
        direction TB
        P1{"DNS A/AAAA<br/>resolves?"}
        P2["MX records present?<br/>sets mail_capable = phishing-ready"]
        P3{"HTTP 200<br/>and a title?"}
        PX["Dropped &mdash; cannot impersonate anyone<br/>surfaced as a defensive-registration candidate"]
        P1 -- "no" --> PX
        P1 -- "yes ~40 survive" --> P2
        P2 --> P3
        P3 -- "no" --> PX
    end

    C2["~1-3 survivors<br/>a ~97% reduction before a single paid search"]

    subgraph SWP["STAGE 3 · SWEEP &mdash; the only stage that spends money"]
        direction TB
        S1["services/sweep.py orchestrates 10 surfaces"]
        S2["google &mdash; 1 search per survivor"]
        S3["AI Overview &mdash; 2 searches, no_cache"]
        S4["AI Mode &mdash; 1 search, no_cache"]
        S5["7 brand engines &mdash; 1 search each, cacheable"]
        S1 --> S2 & S3 & S4 & S5
    end

    C3["survivors + 10 searches<br/>typically 11-13, worst case 25"]

    subgraph SCO["STAGE 4 · SCORE &mdash; a documented heuristic, not a model"]
        direction TB
        R1["CRITICAL &mdash; cited in AI Overview or AI Mode"]
        R2["HIGH &mdash; live AND mail-capable, or an app-store listing"]
        R3["MEDIUM &mdash; local pack, or commerce listing"]
        R4["LOW &mdash; parked, or unregistered"]
    end

    subgraph NOT["STAGE 5 · NOTICE &mdash; a human is always in the loop"]
        direction TB
        N1["draft"] --> N2["reviewed"] --> N3["signed"]
        N4["signing an unapproved notice is a hard 409<br/>nothing is ever delivered automatically"]
    end

    IN --> GEN --> C1 --> PRE --> C2 --> SWP --> C3 --> SCO --> NOT
```

**Why the funnel is the whole product.** A naive sweep of 126 permutations across 10
surfaces is **1,260 searches** — five months of a free-tier budget in one run. DNS and
HTTP checks cost nothing and remove ~97% of candidates before SerpApi is touched, which
is what brings a run down to **2–4 paid searches** in the common case.

---

## 2 · Inside one search — the order of operations

`SerpApiClient.search()` in `services/serpapi.py` is the single entry point for every
paid call. **The order matters**: cache before bucket, bucket before budget, budget before
the network. Nothing else in the codebase may call SerpApi directly.

```mermaid
flowchart TD
    A["search: engine, params, user_id"] --> B["params_hash &mdash; logs record the hash, never the params"]
    B --> C{"no_cache set?"}
    C -- "yes &mdash; verification path" --> E
    C -- "no" --> D{"cache hit inside<br/>SERP_CACHE_TTL_HOURS?"}
    D -- "hit" --> D1["cache_hits += 1<br/>return payload"]
    D -- "miss" --> E

    E["STEP 3 · token bucket acquire<br/>paces calls, waits if empty"]
    E --> F{"budget spent >=<br/>SEARCH_BUDGET_TOTAL?"}
    F -- "yes" --> F1["raise BudgetExhausted<br/>the sweep stops rather than overspending"]
    F -- "no" --> G{"SERPAPI_KEY<br/>configured?"}
    G -- "no" --> G1["raise SerpApiError"]
    G -- "yes" --> H["STEP 5 · HTTP call to SerpApi"]

    H --> I{"429 or 5xx?"}
    I -- "yes" --> I1["exponential backoff + jitter<br/>then retry"] --> H
    I -- "no" --> J["STEP 7 · cache_put, spent += 1, commit"]
    J --> K{"spent >=<br/>SEARCH_BUDGET_ALERT_AT?"}
    K -- "yes" --> K1["log a budget warning"]
    K -- "no" --> L["return payload"]
    K1 --> L
    D1 --> Z["caller"]
    L --> Z
```

The budget ceiling is checked **before** the call, never after, so the ceiling raises
rather than overspending. A cache hit never touches the bucket or the budget — which is
why a repeat sweep of the same brand is close to free.

### Why `no_cache` on the AI surfaces

`google_ai_overview` and `google_ai_mode` set `no_cache=True`. A cached citation is a
**missed detection** — the entire point of those surfaces is to catch a citation that
appeared since the last look. Staleness is harmless for Trends; it is disqualifying here.

---

## 3 · The token bucket

Paces calls so SerpApi is never hammered. It is **not** the quota guard — the monthly
`SEARCH_BUDGET_TOTAL` is.

```mermaid
flowchart LR
    A["acquire"] --> B["refill by<br/>elapsed × rate, capped at burst"]
    B --> C{"tokens >= 1?"}
    C -- "yes" --> D["tokens -= 1<br/>proceed"]
    C -- "no" --> E["sleep until the<br/>next token accrues"] --> B
```

> **Calibration rule:** the burst must exceed the searches **one sweep** spends, or every
> sweep stalls on the bucket. Worst case is `DEMO_MAX_PERMUTATIONS` google searches
> + 2 AI Overview + 1 AI Mode + 7 brand engines = **25**. Defaults are `SERPAPI_BURST=30`
> and `SERPAPI_RATE_PER_HOUR=3600` (one token per second), so a sweep never waits and
> refill keeps pace with real call latency.

---

## 4 · Risk tiering — the exact decision order

From `services/scoring.py`. First match wins, top to bottom. Every reason names the
measurement behind it, and there is deliberately **no confidence score**, because no
measurement exists that would justify one.

```mermaid
flowchart TD
    A["one prefilter survivor<br/>+ the engines that hit it"] --> B{"cited in AI Overview<br/>or AI Mode?"}
    B -- "yes" --> C["CRITICAL<br/>Google's own AI vouches for the impersonator"]
    B -- "no" --> D{"live AND mail_capable?"}
    D -- "yes" --> E["HIGH<br/>live page with MX &mdash; phishing-ready"]
    D -- "no" --> F{"Google Play or<br/>App Store listing?"}
    F -- "yes" --> G["HIGH<br/>app-store listing using the brand"]
    F -- "no" --> H{"Maps local pack?"}
    H -- "yes" --> I["MEDIUM<br/>business listing in the local pack"]
    H -- "no" --> J{"Shopping listing?"}
    J -- "yes" --> K["MEDIUM<br/>commerce listing under the brand"]
    J -- "no" --> L{"live? mail_capable?<br/>resolves?"}
    L --> M["LOW<br/>parked or unregistered<br/>a defensive-registration candidate"]
```

Only **prefilter survivors** become findings. Candidates that never resolved are not
findings at all — they are defensive-registration opportunities, which is what the domain
portfolio is for.

---

## 5 · A sweep, as a sequence

`POST /scan` returns `202` immediately and the work runs as a background task owning its
own DB session. Each engine result is persisted the moment it lands, so the UI can poll
`GET /scan/{id}` and watch progress live.

```mermaid
sequenceDiagram
    autonumber
    participant U as Browser
    participant N as "Next.js /api proxy"
    participant A as "FastAPI routers/scans"
    participant W as "Background task"
    participant P as "prefilter · DNS/HTTP"
    participant S as "SerpApiClient"
    participant X as SerpApi
    participant D as Database

    U->>N: POST /api/scan
    N->>A: POST /scan (same-origin cookie)
    A->>D: create scan row
    A-->>U: 202 Accepted + scan id
    A->>W: schedule background sweep

    W->>D: state = generating
    W->>W: permutations.generate — ~126 candidates
    W->>D: state = prefiltering
    W->>P: DNS A/AAAA, MX, then HTTP
    Note over P: concurrent, free<br/>no search spent
    P-->>W: ~1-3 survivors + funnel counts

    W->>D: state = sweeping
    loop each of the 10 surfaces
        W->>S: search(engine, params)
        alt cached and cacheable
            S->>D: cache_hits += 1
            S-->>W: cached payload
        else must call
            S->>S: token bucket, then budget ceiling
            S->>X: HTTPS request
            X-->>S: JSON
            S->>D: cache_put, spent += 1
            S-->>W: payload
        end
        W->>D: persist engine row — live progress
    end

    W->>D: state = scoring
    W->>W: tier every survivor
    W->>D: findings + state = complete

    loop while scanning
        U->>N: GET /api/scan/{id}
        N->>A: GET /scan/{id}
        A-->>U: funnel, per-engine status, findings, budget
    end
```

---

## 6 · Scan and notice lifecycles

```mermaid
stateDiagram-v2
    direction LR
    [*] --> generating
    generating --> prefiltering: candidates built
    prefiltering --> sweeping: survivors found
    sweeping --> scoring: surfaces done
    scoring --> complete
    generating --> error
    prefiltering --> error
    sweeping --> error: budget exhausted
    scoring --> error
    complete --> [*]
    error --> [*]
```

A resumed scan skips any engine already marked `done` or `cached`, so it never re-spends
a search it has already paid for. One surface failing is recorded against that engine and
**does not sink the sweep**.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> draft: POST /scan/{id}/notice
    draft --> reviewed: POST /notice/{id}/approve
    reviewed --> signed: POST /notice/{id}/sign
    draft --> draft: sign attempt returns 409
    signed --> [*]
```

> **Nothing is ever delivered to a registrant automatically.** Signing an unapproved
> notice is a hard `409`. A legal accusation against a real business gets a human
> signature, or it does not go out — an automated false accusation is worse than a missed
> detection.

---

## 7 · The SSRF guard

Every hostname in this pipeline is **attacker-influenced input**: generated permutations,
and URLs pulled out of search results. `services/egress.py` is the only way out to the
network for any of it.

```mermaid
flowchart TD
    A["fetch(url)"] --> B{"scheme in<br/>http, https?"}
    B -- "no" --> Z["EgressBlocked"]
    B -- "yes" --> C{"host present?"}
    C -- "no" --> Z
    C -- "yes" --> D["resolve host to<br/>every A/AAAA address"]
    D --> E{"ANY address private, loopback,<br/>link-local or cloud-metadata?"}
    E -- "yes" --> Z
    E -- "no" --> F["pin the validated IP<br/>Host header and SNI preserved"]
    F --> G["connect to the pinned IP<br/>closes the DNS-rebinding window"]
    G --> H{"redirect?"}
    H -- "yes, under MAX_REDIRECTS" --> A
    H -- "too many" --> Z
    H -- "no" --> I["read body, truncated at<br/>EGRESS_MAX_RESPONSE_BYTES"]
```

**One private answer poisons the name.** A hostname resolving to both a public and a
private address is rejected outright — the safe-looking answer does not rescue it.
Redirects are followed manually so that *every hop* is re-validated, not just the first.

---

## 8 · Request path and trust boundaries

```mermaid
flowchart LR
    subgraph BR["Browser"]
        UI["Next.js 14 · React · Three.js"]
    end

    subgraph NX["Next.js server :3000"]
        RW["rewrite /api/* to :8000"]
    end

    subgraph API["FastAPI :8000"]
        MW["CORS, security headers"]
        DEP["deps.py<br/>current user + owned-resource loaders"]
        RT["routers · auth, scans, notices, domains, workspace"]
        SV["services · permutations, prefilter, sweep,<br/>serpapi, scoring, notice, namecom"]
        EG["egress.py &mdash; the only route to the open internet"]
    end

    DB[("SQLite or Postgres<br/>users, sessions, scans, findings,<br/>notices, serp_cache, search_budget")]

    subgraph EXT["Third parties &mdash; all optional, degrade to not_configured"]
        SA["SerpApi &mdash; 10 surfaces"]
        NC["name.com &mdash; sandboxed by default"]
        OT["Foxit · Doctavian · Nutrient"]
    end

    UI -- "same-origin, httpOnly cookie" --> RW
    RW --> MW --> DEP --> RT --> SV
    SV --> DB
    DEP --> DB
    SV --> SA
    SV --> NC
    SV --> OT
    SV --> EG
    EG -. "attacker-influenced hostnames" .-> INET["Open internet"]
```

**Why the proxy exists.** An httpOnly cookie does not survive a cross-origin XHR from
`:3000` to `:8000` without `SameSite=None; Secure`, which needs HTTPS in dev. Routing
through `/api` makes every request same-origin — rather than weakening the cookie to make
development convenient.

### The authorisation rule

```mermaid
flowchart LR
    A["GET /scan/{id}"] --> B["load WHERE id = :id<br/>AND user_id = :current_user"]
    B --> C{"row found?"}
    C -- "yes" --> D["200 with the scan"]
    C -- "no" --> E["404 &mdash; never 403"]
```

The ownership filter is in the **same query** as the id, so a missing row and someone
else's row are indistinguishable. Returning `403` would confirm the id exists;
`tests/test_idor.py` exists to keep that from regressing.

---

## Where to look next

| Question | File |
|---|---|
| How are lookalikes generated? | `backend/app/services/permutations.py` |
| How is the search budget protected? | `backend/app/services/prefilter.py`, `serpapi.py` |
| How is a finding tiered? | `backend/app/services/scoring.py` |
| How is SSRF prevented? | `backend/app/services/egress.py` |
| How is cross-user access blocked? | `backend/app/deps.py`, `tests/test_idor.py` |
| What does a sweep actually run? | `backend/app/services/sweep.py` |
