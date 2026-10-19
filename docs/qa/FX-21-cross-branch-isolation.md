# FX-21 — Cross-branch access blocked, proven by tests (handover)

**Story:** US-QA-01 · **Work-plan:** S10 · **Depends on:** FX-18 (branch read scope), FX-16
**Feature flag:** `STAFF_RBAC_ENFORCE` (default off) · **Suite:** `bun run test:fx-21`

One automated suite is the acceptance evidence that a second branch can open safely: it stands up
**two fully-populated branches** and proves, from **both sides**, that a branch-scoped staff
account can never reach the other branch's data — in any list, on any record page, or by
hand-editing the branch a request names.

---

## What the suite tests

| Criterion | What it asserts | Status |
|---|---|---|
| FX-21.1 | Two branches (A, B) are each seeded with **staff, members, memberships, bookings, invoices, leads, slots and visits**. A global admin sees all of it — the proof both branches are really populated. | ✅ |
| FX-21.2 | For **every staff list** (members, memberships, invoices, bookings, visits, leads, trainer roster, slots, dashboard metrics) a branch-A account sees only A and **nothing** of B — and, **symmetrically**, a branch-B account sees nothing of A. | ✅ |
| FX-21.2 | For **every record page** (member, membership, invoice, booking by id) another branch's record answers **404, never 403** — so a scoped staffer can't even confirm it exists. Positive control: own-branch records open 200. | ✅ |
| FX-21.3 | A **forged branch** (a valid id for no real location) → **404 `LOCATION_NOT_FOUND`**. | ✅ |
| FX-21.3 | An **invalid branch** (malformed id) → **400 `INVALID_LOCATION_ID`** on a write; ignored on a read (falls back to the caller's own branch, never widens). | ✅ |
| FX-21.3 | A **deactivated branch** → **400 `LOCATION_INACTIVE`**. | ✅ |
| FX-21.3 | A **real other branch** named on a write (the direct "edit the request to point at B" attack) → **403 `NOT_YOUR_BRANCH`**; spoofing `?locationId=B` on a read returns nothing. | ✅ |
| FX-21.3 | A **sign-in from before FX-16** (a staff session whose account was never assigned a branch) resolves to **nothing** — every list empty, every record 404 — not a bypass. | ✅ |
| FX-21.4 | On the [release checklist](./RELEASE_CHECKLIST.md) as a required gate; **a second branch may not open until it is green**. | ✅ |
| FX-21.5 | This one-pager is the handover summary. | ✅ |

---

## How it works (one paragraph)

The suite exercises the **real routers + `staffGuard`** (`attachStaffContext` + `enforceBranchScope`,
`src/middleware/branch-scope.middleware.ts`) with `STAFF_RBAC_ENFORCE` on. Two **branch-scoped
"manager" Admin accounts** (one per branch) log in with JWT role `admin` so they clear every
`authorize()` list, while `resolveStaffContext` (`src/services/staffContext.service.ts`) re-derives
their **branch** scope from the live DB — exactly how a real scoped staffer behaves. Lists are
narrowed by `scopedLocationFilter` and record pages gated by `isBranchInScope`
(`src/utils/location.resolver.ts`); an out-of-scope branch id on a list matches nothing (`$in: []`)
and an out-of-scope record answers the same 404 as a missing one. Writes that **name** a branch run
through `resolveLocationId`, which distinguishes invalid / not-found / inactive before the scope
check. A global admin (Admin account, `allBranches`/no `staffRole`) bypasses all of it. With the
flag **off** every check is a transparent no-op — the suite asserts that too, which is the rollback.

**Why the "pre-FX-16 sign-in" case matters:** staff tokens live up to 240 days and carry no branch
claim, so a session opened before branch assignment existed is still valid long after FX-16 ships.
Because authority is re-derived from the DB on every request (never trusted from the token), such an
account — one with no `branchIds` and `allBranches: false` — can act on **nothing** under
enforcement. The suite proves an old session cannot be used to slip past the new scoping.

---

## Running it

Requires a running MongoDB (`MONGODB_URL`, e.g. `mongodb://127.0.0.1:27017/fitflix`). **No replica
set needed** — unlike FX-03 it does no multi-document transactions. The suite seeds its own
branches/staff/members/records, cleans them all up in a `finally`, and toggles the flag internally,
so it is safe to run against a copy-of-production snapshot with the flag off in the environment.

```bash
bun run test:fx-21
```

Expected: every line prints `✅` and the run ends with
`🎉 FX-21 Cross-Branch Access Blocked — all assertions passed!` (exit 0). Any failure exits non-zero
and names the assertion that broke.

Also worth running alongside it (same enforcement path): `bun run test:fx-18` (read scope) and
`bun tests/fx-17-branch-scope.test.ts` (write scope).

---

## Files

- `tests/fx-21-cross-branch-isolation.test.ts` — the suite.
- `package.json` — `test:fx-21` script.
- `docs/qa/RELEASE_CHECKLIST.md` — the required gate.
- `docs/qa/FX-21-cross-branch-isolation.md` — this handover page.

## Scope notes / assumptions

- "Staff" in each branch is represented by a **Trainer** per branch (the branch-scoped roster) plus
  the two manager accounts; the write-side attacks (FX-21.3) target `PATCH /trainers/:id`, the same
  branch-stamped write FX-17 uses.
- "A sign-in from before FX-16" is modelled as a **valid staff token for an account with no branch
  assignment** (`branchIds: []`, `allBranches: false`). This is the state a staffer was in before
  FX-16 allocated branches; the token's age is immaterial because scope is always re-derived from
  the DB. Before enabling `STAFF_RBAC_ENFORCE` in production, backfill existing staff with
  `scripts/assign-staff-branches.ts` (see the FX-17 runbook) so no real staffer is left seeing
  nothing.
- Branch A/B are created fresh per run, so their dashboard/visit counts are deterministic
  (members A=2/B=2, active memberships 1 each, visits A=2/B=1) and any cross-branch leak surfaces as
  a wrong count, not just a wrong row.
