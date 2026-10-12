# FX-20 — Member branch separation (backend)

**Date:** 2026-10-12
**Depends on:** FX-01 (Location), FX-17 (`X-Location-Id` + staff scope),
FX-18/FX-19 (branch read scoping).

The backend half of US-MB-09: carry the member's home club, scope the member's
in-person classes and offers to it, and let staff broadcast to a single club's
members — while online classes, livestreams and company-wide offers stay visible
to everyone. With a single branch everything below is a no-op, so the member app
looks exactly as it does today (FX-20.4).

---

## FX-20.1 — Home club on the member

`User.homeLocationId` (a `Location` ref) already existed and drives timezone +
branch scope. This story wires it through the member CRUD the staff console
uses:

- `createUserBodySchema` / `updateUserBodySchema` now accept `homeLocationId`,
  and `homeClubId` as the staff console's alias for the same field (the two
  repos name it differently). Empty / `"none"` clears it.
- `createUser` / `updateUserById` validate a concrete value with
  `resolveLocationId` (must exist and be active — `LocationError` → 400/404) and
  persist it. A `null` clears the home club; an omitted field leaves it alone.
- Responses expose the value under **both** names: a `homeClubId` virtual on the
  User schema (toJSON — detail/create/update) and `homeClubId: "$homeLocationId"`
  in the members-list aggregate `$project`. The console reads `homeClubId`; the
  rest of the server keeps using `homeLocationId`.

## FX-20.2 — In-person classes from the home club; online/livestream for all

`src/utils/class-visibility.ts` holds the rule as pure functions, applied in two
member read paths:

- **`GET /api/v1/classes`** (`getActiveClassesForMembers`) — for a member, the
  query gains `memberClassVisibilityOr(homeLocationId)`: `mode: "online"` OR
  `sessionType: "live_stream"` (seen by everyone) OR `locationId ∈ { home club, null }`
  (in-person at the home club, or company-wide).
- **`GET /api/v1/classes/schedule`** (`getSchedulesForMembers`) — the same split
  via `isClassVisibleToMember` on the populated class, alongside the existing
  retired-class filter.

The home club is read from the member's own record
(`getMemberHomeLocationId`) — never a client-supplied header — so visibility
can't be widened by spoofing. Staff/trainers hitting these endpoints are not
scoped (they manage the whole catalogue), and a member with no home club is not
scoped at all (FX-20.4). Offers already carried this behaviour in
`promotion-visibility.ts` (branch + company-wide + audience); no change there.

## FX-20.3 — Club-wide notifications reach only that club's members

New `/member-notifications` resource (`model` + `validator` + `controller` +
`routes`, mounted at `/member-notifications` and `/api/v1/member-notifications`):

- **`POST`** stores a `MemberNotification` broadcast. `locationId: null` is
  company-wide; a concrete id is validated active and reaches only that club.
  Recipients are resolved from home club + audience
  (`utils/member-audience.ts`, segmenting via the Membership ledger exactly like
  `membership.guard`), stored as `recipientCount`, and fanned out into the in-app
  `Notification` inbox (kind `club_announcement`) so delivery is real. A
  branch-scoped staffer can't broadcast company-wide, and `staffGuard` rejects a
  branch they don't work at.
- **`GET`** is the staff "Sent" history: branch-scoped, newest-first, paginated.

## Files

**Added:** `src/models/MemberNotification.ts`,
`src/validators/member-notification.validator.ts`,
`src/controllers/member-notification.controller.ts`,
`src/routes/member-notification.routes.ts`, `src/utils/member-audience.ts`,
`src/utils/class-visibility.ts`.

**Changed:** `src/models/User.ts` (`homeClubId` virtual),
`src/models/Enums.ts` (`NotificationKind.ClubAnnouncement`),
`src/validators/user.validator.ts`, `src/controllers/user.controller.ts`,
`src/controllers/class.controller.ts`,
`src/controllers/class-schedule.controller.ts`,
`src/utils/location.resolver.ts` (`getMemberHomeLocationId`), `src/app.ts`.

## Verification

- `npx tsc --noEmit` — no new errors in any touched/added file (pre-existing
  errors listed in CLAUDE.md are unchanged).
