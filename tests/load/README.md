# FX-26 load tests (k6)

Measures the busiest member and staff screens under load and reports the
95th-percentile response time for each, so we can see they stay fast as members
and branches grow.

| Script | Screen (FX-26.1) | Endpoints | Token |
|---|---|---|---|
| `member-home.js` | Member home | `GET /api/v1/classes`, `GET /promotions`, `GET /notifications` | member |
| `class-booking.js` | Class booking | `GET /api/v1/classes/schedule`, `GET /api/v1/classes` | member |
| `frontdesk-bookings.js` | Front-desk bookings list | `GET /bookings` (full + `?page&limit`) | staff (admin/frontdesk) |

## Prerequisites

- [k6](https://k6.io/docs/get-started/installation/) on the PATH (standalone
  binary — **not** an npm/bun dependency, so nothing to install in this repo).
- A JWT for a member and for a staff user on the **target environment**.
  Optionally a `LOCATION_ID` (a `Location._id`) to scope to one branch.

## Running

> **FX-26.4 — never against production.** The scripts abort in `setup()` if
> `BASE_URL` looks like a production host, and require
> `LOAD_TEST_CONFIRM=prod-copy` for any non-local target. Point them at a
> **restored copy** of production (see below), localhost, or staging.

```bash
# Local dev server
k6 run -e BASE_URL=http://localhost:3000 -e MEMBER_TOKEN=<jwt> tests/load/member-home.js
k6 run -e BASE_URL=http://localhost:3000 -e MEMBER_TOKEN=<jwt> tests/load/class-booking.js
k6 run -e BASE_URL=http://localhost:3000 -e STAFF_TOKEN=<jwt>  tests/load/frontdesk-bookings.js

# Restored copy of production (a separate host/DB, NOT the live API)
k6 run \
  -e BASE_URL=https://staging-copy.internal \
  -e LOAD_TEST_CONFIRM=prod-copy \
  -e STAFF_TOKEN=<jwt> \
  -e LOCATION_ID=<branchId> \
  tests/load/frontdesk-bookings.js
```

### Tunables (`-e NAME=value`)

| Env | Default | Meaning |
|---|---|---|
| `BASE_URL` | — (required) | Target API base URL |
| `MEMBER_TOKEN` / `STAFF_TOKEN` | — | Bearer token for the scenario |
| `LOCATION_ID` | — | Sent as `X-Location-Id` (branch scope) |
| `VUS` | 25 (15 for frontdesk) | Peak virtual users |
| `RAMP` / `HOLD` | `30s` / `1m` | Ramp-up and steady-state durations |
| `P95_MS` | `500` | p95 budget per screen (threshold) |
| `PAGE_LIMIT` | `50` | Page size for the paginated bookings call |
| `PROD_HOSTS` | — | Extra comma-separated host substrings to treat as production |
| `LOAD_TEST_CONFIRM` | — | Must be `prod-copy` to run against a non-local host |

## Reading the result (FX-26.2)

Each endpoint has its own `Trend` metric, so k6's end-of-run summary prints the
p95 per screen, e.g.:

```
home_classes_ms...........: p(95)=180ms
home_promotions_ms........: p(95)=120ms
home_notifications_ms.....: p(95)=90ms
```

A `thresholds` block fails the run (non-zero exit) if any screen's p95 breaches
its budget, so this drops straight into CI against a prod copy. Export the full
report with `--summary-export result.json` (or `k6 run --out json=raw.json …`)
and attach it to the FX-26 ticket.

## Preparing a production copy

1. Restore the latest production DB snapshot into a **separate** MongoDB.
2. Deploy the API against that DB on a separate host (localhost, staging, or an
   isolated instance). Never reuse production credentials or URLs.
3. Mint tokens for a member and a staff user on that copy.
4. Run the scripts above. The guard still requires `LOAD_TEST_CONFIRM=prod-copy`
   for any non-local host, as a second pair of eyes on the target.
