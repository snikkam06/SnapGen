# API stress tests

k6-based stress tests that target the NestJS API at `apps/api/`. Built to answer one question: *can the codebase hold up under 100–200 concurrent users?*

## Setup

### 1. Install k6

```bash
brew install k6
```

### 2. Pick a bypass token

Stress tests need to skip Clerk JWT verification (real tokens expire and you'd need 200 of them). The API has an env-gated bypass in `apps/api/src/guards/clerk-auth.guard.ts` — when `STRESS_TEST_BYPASS_TOKEN` is set, requests with matching `x-stress-test-token` + `x-stress-test-user-id` headers skip Clerk and run as that user. **Leave this env var unset in production.**

Add to `apps/api/.env` (dev only):

```
STRESS_TEST_BYPASS_TOKEN=<any-long-random-string>
```

Restart the API.

### 3. Seed stress users

Creates N users with credits and pre-populated assets so the `/assets` endpoint has work to do.

```bash
# Defaults: 200 users, 30 assets each, 1,000,000 credits
node tests/stress/seed-stress-users.mjs

# Custom:
STRESS_USER_COUNT=300 STRESS_ASSETS_PER_USER=60 node tests/stress/seed-stress-users.mjs

# Wipe previous stress users first:
STRESS_CLEAN=true node tests/stress/seed-stress-users.mjs
```

The script writes `tests/stress/fixtures/users.json` (gitignored), which k6 loads via `SharedArray`.

### 4. Start the API + worker

```bash
# In one terminal
pnpm --filter @snapgen/api dev

# In another (optional — without it, BullMQ jobs accumulate but the API still responds)
pnpm worker:dev:multi
```

Per `memory/`, `IMAGE_PROVIDER=mock` is already set, so generation jobs won't call real FAL/Replicate.

## Running scenarios

All scenarios accept `BASE_URL` (default `http://127.0.0.1:3001`) and `STRESS_TEST_BYPASS_TOKEN` env vars.

```bash
export STRESS_TEST_BYPASS_TOKEN=<same-value-as-api>

# Sanity check — should pass cleanly before anything else
k6 run tests/stress/scenarios/baseline.js

# Read-heavy: 150 VUs for 1 minute hitting GET /assets (N+1), /me, /billing/credits
k6 run tests/stress/scenarios/read-heavy.js
k6 run -e VUS=200 -e DURATION=2m tests/stress/scenarios/read-heavy.js

# Generation storm: 100 VUs submitting image jobs
k6 run tests/stress/scenarios/generation-storm.js
k6 run -e VUS=200 -e DURATION=2m tests/stress/scenarios/generation-storm.js

# Pathological case: many VUs hammering as the SAME user — stress the
# per-user advisory lock + serializable-tx retry path
k6 run -e STRESS_MODE=hot -e VUS=50 tests/stress/scenarios/generation-storm.js

# Realistic mixed workload — 70% readers, 30% generators in parallel
k6 run tests/stress/scenarios/mixed.js
k6 run -e TOTAL_VUS=200 -e DURATION=3m tests/stress/scenarios/mixed.js

# Sudden spike: 0 → 200 VUs in 30s
k6 run tests/stress/scenarios/spike.js
k6 run -e PEAK_VUS=300 tests/stress/scenarios/spike.js
```

## What each scenario reveals

| Scenario | Targets | What it exposes |
|----------|---------|------------------|
| `baseline.js` | `/me`, `/assets`, `/billing/credits` at 10 VUs | Auth bypass + happy paths work. Run before everything else. |
| `read-heavy.js` | `/assets?limit=60` (60%), `/me` (25%), `/billing/credits` (15%) | Prisma pool exhaustion, N+1 queries on the assets list (each row joins `JobAsset` + the parent job), unbounded `CreditLedger.aggregate`. |
| `generation-storm.js` (`spread`) | `POST /generations/image` across distinct users | Throughput ceiling of the serializable-transaction path + BullMQ enqueue. Also triggers the 20-req/60s `@Throttle` — expect 429s, which the metrics classify as expected. |
| `generation-storm.js` (`hot`) | Same endpoint, all VUs sharing one user | Advisory-lock contention (`pg_advisory_xact_lock(hashtext(userId))`), serializable retries (`SNAPGEN_DB_SERIALIZABLE_RETRY_LIMIT=5`), the per-user `MAX_PENDING_JOBS_PER_USER=5` ceiling. |
| `mixed.js` | Readers + generators in parallel | Real-world contention: do generators starve readers (or vice versa) when they fight for connections? |
| `spike.js` | Mixed traffic ramped 0→200 in 30s | Cold-start behavior, recovery after the spike subsides, whether the pool can absorb burst arrivals. |

## Interpreting the output

k6 prints a summary with per-endpoint latency, error rate, and the custom metrics defined in `lib/checks.js`:

- `success_rate` — fraction of requests classified as expected (2xx + documented backpressure)
- `errors_total` — unexpected failures (5xx, network errors, unrecognized 4xx)
- `server_errors_total` — 5xx only
- `rate_limited_total` — 429 from the throttler (expected at high VU counts on `/generations/*`)
- `insufficient_credits_total` — 400 from credit check (shouldn't happen with the seeded 1M balance)
- `pending_limit_total` — 400 from `MAX_PENDING_JOBS_PER_USER` (expected in `hot` mode)

Thresholds defined per scenario will mark the run as failed if breached — useful for CI gating later.

### What to watch on the API side

Open a second terminal during runs:

```bash
# DB connection count (local Postgres on 55432)
watch -n 1 "psql -h 127.0.0.1 -p 55432 -U postgres snapgen -c 'select count(*), state from pg_stat_activity group by state'"

# Long-running queries
psql -h 127.0.0.1 -p 55432 -U postgres snapgen -c \
  "select pid, now() - query_start as duration, state, query from pg_stat_activity where state != 'idle' order by duration desc limit 20"

# BullMQ queue depth (if Redis is running)
redis-cli LLEN bull:image-generation:wait
redis-cli LLEN bull:image-generation:active
```

### Known bottlenecks to expect (in order)

1. **Prisma connection pool**: local dev defaults to `connection_limit=2` (see `scripts/resolve-database-url.mjs`). Even 20 concurrent readers will saturate it. Crank with `SNAPGEN_DB_CONNECTION_LIMIT=20` on the API process for realistic numbers.
2. **N+1 on `GET /assets`**: each row in the page triggers a `JobAsset.findMany`. 100 VUs × 60 assets ≈ 6,000 follow-up queries.
3. **Throttler (429)**: `/generations/*` is capped at 20 req/60s/IP. Expected behavior — classified as success.
4. **Serializable conflicts in `hot` mode**: retries up to 5x, then surfaces as 500. The `server_errors_total` counter will tick up.
5. **BullMQ backlog**: worker concurrency = 12 image jobs. 100 VUs submitting at ~1 req/s will fill the queue faster than the worker drains it.

## Cleanup

```bash
STRESS_CLEAN=true STRESS_USER_COUNT=0 node tests/stress/seed-stress-users.mjs
```

(Re-seeds with 0 users after deletion — effectively a wipe of `stress_user_*` records.)
