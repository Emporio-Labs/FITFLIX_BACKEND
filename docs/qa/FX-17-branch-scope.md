# FX-17 — Every staff request checked against their branches (runbook)

**Story:** US-MB-07 · **Work-plan:** S5 · **Feature flag:** `STAFF_RBAC_ENFORCE` (default off)

Proves that, once enforcement is on, a staff member can only act on branches they work at — even
if they hand-edit a request — while a global admin can act on any branch, and that turning the
switch off restores today's behaviour exactly (the rollback).

| Criterion | What it asserts |
|---|---|
| FX-17.1 | A staffer acting on a branch they don't work at is refused **403 `NOT_YOUR_BRANCH`** |
| FX-17.2 | A request naming an invalid or deactivated branch is refused **400 `INVALID_LOCATION_ID` / `LOCATION_INACTIVE`** |
| FX-17.3 | Front desk sends the selected branch on every request (header `X-Location-Id`) without staff doing anything |
| FX-17.4 | A global admin (Admin-collection account) may act on any branch |
| FX-17.5 | Checks use the caller's **live** role + branches, not the token; a change takes effect within ~1 min (cache TTL) or immediately after an admin edit (cache cleared) |
| FX-17.6 | Everything sits behind `STAFF_RBAC_ENFORCE`, off by default; flipping it back off is the rollback |
| FX-17.7 | Front-desk staff are no longer treated as admins — admin-only routes refuse them once the switch is on |

---

## Design in one paragraph

The JWT carries no branch and lives up to 240 days, so authority is re-derived from the database
on every staff request by `resolveStaffContext` (`src/services/staffContext.service.ts`), cached
60s. Admin-collection accounts resolve to **global** scope (any branch); trainers and staff Users
resolve to **branch** scope from their `branchIds` (falling back to the legacy single
`locationId` / `homeLocationId`). `attachStaffContext` + `enforceBranchScope`
(`src/middleware/branch-scope.middleware.ts`, mounted as `staffGuard` after `authenticateToken` on
the staff routers) refuse a disabled account and, on writes that **name** a branch, refuse one the
caller isn't scoped to — validating existence/active state via `resolveLocationId`. Reads are
narrowed by `scopedLocationFilter`. FX-17.7 is the `normalizeRole` change in
`src/middleware/rbac.middleware.ts`: under the flag, `ROLE_FRONT_DESK_STAFF` normalizes to
`frontdesk` instead of `admin`. All of it is a no-op while the flag is off.

## 1. Automated test

Requires a running MongoDB (`MONGODB_URL`, e.g. `mongodb://127.0.0.1:27017/fitflix`). The test
seeds its own branches/trainer/admin and cleans up after itself; it toggles the flag internally.

```bash
bun tests/fx-17-branch-scope.test.ts
```

Also run the RBAC suite to confirm no regression with the flag off (its default):

```bash
bun tests/feature-009-access-control-rbac.test.ts
```

## 2. Backfill existing staff before enabling the flag

A staffer with no `branchIds` can act on nothing under enforcement. Seed from each staffer's
existing single branch first (idempotent; `--dry-run` to preview):

```bash
bun run scripts/assign-staff-branches.ts --dry-run
bun run scripts/assign-staff-branches.ts
```

## 3. Manual check (flag on)

Set `STAFF_RBAC_ENFORCE=true`, restart, seed two active branches (A, B) and one trainer scoped to
A, then:

1. Trainer `PATCH /trainers/:id` with `locationId` = B → **403 `NOT_YOUR_BRANCH`**.
2. Same with a deactivated branch id → **400 `LOCATION_INACTIVE`**; a malformed id → **400
   `INVALID_LOCATION_ID`**.
3. Trainer with `locationId` = A → **200**.
4. An admin account with `locationId` = B → **200**.
5. A front-desk caller `POST`ing to any `authorize(["admin"])` route → **403**.
6. Reassign the trainer's branches (admin edit clears the cache) → the new branch is immediately
   allowed and the old one refused.

## 4. Front desk sends the branch automatically (FX-17.3)

In the frontdesk app, pick a branch in the switcher and confirm via the browser Network panel that
every request carries an `X-Location-Id` header matching the selection
(`lib/api-client.ts` request interceptor, reading `localStorage['hh_selected_location']`).

## 5. Rollback

Set `STAFF_RBAC_ENFORCE=false` (or remove it) and restart. All checks above revert to today's
behaviour; no data migration is needed.
