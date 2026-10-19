# FX-26 — Busiest screens stay fast as data grows

**Date:** 2026-10-12
**Scope:** backend. The load harness and the full-collection-scan audit for the
member home screen, class booking and the Front-desk bookings list.

The deliverables are: a load-test harness that measures each busy screen and
reports its p95 (FX-26.1, FX-26.2); the collection-scan audit with every
offending lookup either fixed or kept with a stated reason (FX-26.3); and a hard
guard that keeps load off production (FX-26.4).

---

## 1. Load tests (FX-26.1, FX-26.2)

k6 scripts live in [`tests/load/`](../tests/load/README.md), one per screen:

| Screen | Script | Endpoints measured |
|---|---|---|
| Member home | `member-home.js` | `GET /api/v1/classes`, `GET /promotions`, `GET /notifications` |
| Class booking | `class-booking.js` | `GET /api/v1/classes/schedule`, `GET /api/v1/classes` |
| Front-desk bookings | `frontdesk-bookings.js` | `GET /bookings` (full + paginated), `GET /slots` (bounded default + `?includePast=1`) |

Seed a realistic data set first with `bun run seed:loadtest` (see §5) — the p95
figures only mean something against grown-up data.

Each endpoint records its own `Trend`, so the run summary prints a **per-screen
p95** (FX-26.2), and a `thresholds` block fails the run if a screen breaches its
budget (default `P95_MS=500`). Export with `--summary-export` and attach to the
ticket. See the harness README for how to point it at a restored copy of
production and for every tunable.

## 2. No load test against production (FX-26.4)

The harness refuses to generate load against production. `assertSafeTarget()`
(in `tests/load/lib/common.js`), called from every scenario's `setup()`:

- aborts if `BASE_URL`'s host matches a production pattern
  (`fitflix.in`/`fitflix.com`/`api.fitflix`/`prod`/`production`, extensible via
  `PROD_HOSTS`);
- for any non-local host, requires an explicit `LOAD_TEST_CONFIRM=prod-copy`, so
  hitting a restored copy is a deliberate choice and a typo can never point load
  at the live API;
- treats localhost / loopback / RFC-1918 / `.internal` / `.local` / `.test` as
  safe without confirmation.

## 3. Collection-scan audit (FX-26.3)

Every lookup behind the three screens, and whether it reads a whole collection.

### Fixed

| Lookup | Problem | Fix |
|---|---|---|
| **`GET /bookings` member search** (`getAllBookings`, `booking.controller.ts`) | Fetched **every** matching booking, populated them, then filtered `username`/`email` in memory — a whole-collection read + JS filter on every search. | Resolve matching member ids with an **indexed** `User` lookup first, then constrain the booking query (`user: { $in }`). No rows are read that can't match; a no-match search short-circuits to empty. Regex input is escaped (no ReDoS/injection). |
| **`GET /bookings` sort + branch scope** | The scoped list sorted by `createdAt` with no supporting index → collection scan + in-memory sort, growing linearly with total bookings. | Added `Bookings` indexes `{ locationId: 1, createdAt: -1 }`, `{ user: 1, createdAt: -1 }`, `{ status: 1, createdAt: -1 }`. The branch-scoped, newest-first list is now index-served. |
| **`GET /bookings` unbounded result** | No limit — the response grew with the whole (branch-scoped) collection. | **Opt-in pagination**: a caller sending `limit` gets a bounded page (hard cap 200) with `{ pagination: { page, limit, total, totalPages } }`. Default stays the full list for staff-console compatibility — see "stays" below. |
| **`GET /member-notifications` history** (FX-20.3, new) | A naive history read would be unbounded. | Paginated from day one (default 50, cap 200), index `{ locationId: 1, createdAt: -1 }`. |
| **`GET /slots`** (`getAllSlots`, `slot.controller.ts`) | Returned the **entire** `Slot` collection (`Slot.find(filter)`, no bound). The collection grows without limit because a per-date "concrete" slot is materialized on every booking, so the read the Front-desk bookings list and spot-booking screens both make got slower with every booking ever taken. | Bound the default to **active inventory**: historical dated slots (date before today) are dropped, while recurring templates (`date: null` / `isDaily`) are always kept — they are the inventory the booking UIs resolve against. Widen with `?from`/`?to`, or restore the old read with `?includePast=1`; opt-in `?limit` paging (cap 500). Response stays `{ slots }` (+ `pagination`), and past bookings are unaffected because `getAllBookings` already populates the slot onto each booking. |

### Reads that stay, with the reason

| Lookup | Reads | Why it stays |
|---|---|---|
| **`GET /api/v1/classes`** (`getActiveClassesForMembers`) | All `ACTIVE`, published classes (+ the FX-20.2 home-club `$or`). | Bounded by the **class catalogue** (templates per chain), which does not grow with members or bookings. Served by `{ status: 1, isPublished: 1 }` + the indexed `locationId`. This is a small, naturally-capped set, so a limit would add paging UI for no scale benefit. |
| **`GET /api/v1/classes/schedule`** (`getSchedulesForMembers`) | Sessions from today forward (or one `?date`). | Already **date-windowed** and index-served (`{ status, isPublished, sessionDate, startTime }`, added in prior FX-26 work). The post-fetch `.filter()` (retired classes + FX-20.2 visibility) runs over that bounded window, not the collection. |
| **`GET /bookings` default (no `limit`)** | Full branch-scoped list. | The staff console renders and filters the list client-side and has **no pagination UI yet**; a silent server cap would truncate it — a regression. The scan cost is already removed (indexes + search push-down), and pagination is now available opt-in. **Follow-up:** have the console adopt `?page&limit`; then flip the default to a bounded page. |
| **`GET /promotions`** (`getAllPromotions`) | Live, in-window promotions for the branch + company-wide. | Index `{ isActive, activeFrom, activeTo, priority }` / `{ locationId, isActive }`; bounded by the active-promotion set, which is small by design (promotions expire). |
| **`GET /notifications`** (member inbox) | The member's own notifications. | Scoped by `userId` and index-served (`{ userId: 1, createdAt: -1 }`). Per-user, not a collection read. |

## 4. Changes in this story

- `src/models/Bookings.ts` — three list indexes.
- `src/controllers/booking.controller.ts` — search push-down, opt-in pagination.
- `src/controllers/slot.controller.ts` — `getAllSlots` default bounded to active
  (today-forward) inventory + templates, with `?from`/`?to`/`?includePast` and
  opt-in `?limit` paging.
- `tests/load/` — k6 harness (3 scripts + shared guard/helpers + README);
  `frontdesk-bookings.js` now also measures `GET /slots` (bounded vs `?includePast`).
- `scripts/seed-loadtest.ts` (+ `seed:loadtest` / `seed:loadtest:down` in
  `package.json`) — the load-test data seeder (§5).

## 5. Seeding a load-test data set (FX-26.1)

`bun run seed:loadtest` inflates the collections behind the three screens —
members, memberships, classes, scheduled sessions (past + future), slots
(templates + a large body of past/future concrete slots) and ~20k bookings —
under a dedicated `loadtest` Location, `@loadtest.local` accounts and `[LOADTEST]`
classes. It prints a staff + member JWT (signed exactly as `/auth/login` does) and
a ready-to-run k6 command, so there is no separate token step. `--small` seeds
~10× less for a quick smoke; every count is tunable via `LOADTEST_*` env vars.

`bun run seed:loadtest:down` removes exactly that data and nothing else. The
seeder carries the **same FX-26.4 production guard** as the harness, applied to
`MONGODB_URL`: local/private hosts run freely, a production pattern is refused,
and any other host needs `LOAD_TEST_CONFIRM=prod-copy` — so synthetic data can
never land in the live DB.

The FX-20.2 home-club visibility rule and the new `/member-notifications` routes
are documented in [`fx-20-member-branch-separation.md`](./fx-20-member-branch-separation.md)
and the staff-console doc of the same name.
