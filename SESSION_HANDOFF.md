# Session Handoff — Nutritionist / Sports-Scientist booking rebuilt

Plain-English summary of what was done, file by file, so a new chat can pick
up without re-reading the whole transcript. Read this instead of the old
transcript.

## The problem we were solving

Nutritionist and sports-scientist 1:1 bookings used to draw from `Slot`
inventory — the same mechanism used for saunas and therapy rooms. A slot is
just "N seats," so it could never say *which* nutritionist is free, honour
their leave, or stop one person being double-booked. We moved those two
booking flows onto `ExpertSchedule` (the same system trainers already used),
kept `Slot` for genuinely fungible resources (therapy, sauna, etc.), and
migrated existing bookings across.

Everything below is **done and verified working** on the local dev DB unless
marked otherwise.

---

## Backend (`FITFLIX_BACKEND`)

### New concept: a User can now be "staff"
- `src/models/User.ts` — added `staffRole` field (nutritionist / trainer /
  doctor / sports_scientist / null). This is the only place that says "this
  account is a nutritionist." Nothing like this existed before.
- `src/types/auth.ts`, `src/utils/jwt.ts` — added `sports_scientist` as a
  valid role a login token can carry.
- `src/controllers/auth.controller.ts` — login now checks `staffRole` on a
  User document and issues that as the JWT role instead of always "user".
  This is what makes `nutritionist@fitflix.test` log in *as* a nutritionist.
- `src/validators/user.validator.ts`, `src/controllers/user.controller.ts` —
  admin can set `staffRole` via `POST/PATCH /users`. A member can't set it on
  themselves (guarded to admin only).

### New concept: appointment mode has exactly two real values
- `src/utils/appointment-mode.ts` (new file) — `OFFLINE` is a legacy alias for
  `IN_PERSON`; this file folds it everywhere so nothing downstream has to
  handle three values.

### The availability engine (the actual core of this work)
- `src/models/ExpertSchedule.ts` — added `supportedModes` (which modes this
  expert offers) and raised the default `maxAdvanceBookingDays` from 14 to 60
  (it was never enforced before; now it is, so the old default would have
  silently broken things).
- `src/services/expert-schedule.service.ts` — **rewritten**. Used to only
  work for trainers. Now:
  - `calculateAvailableSlots(...)` takes a `mode` filter and an
    `expertType`, works for any expert type.
  - `resolveExpertsOfType(type)` — new: finds every active User with that
    `staffRole` (or every Trainer, for trainers).
  - `calculatePooledAvailability(...)` — new: unions every expert of a type's
    free times for a date+mode, so with 5 nutritionists you see everyone's
    combined availability, not just one person's.
  - `pickExpertForSlot(...)` — new: given a time, picks which free expert to
    assign (fewest bookings that day, tie-broken by id). **This is what makes
    double-booking structurally impossible** — the expert is chosen and
    written down when the booking is created, not assigned later by an admin.

### New API surface
- `src/controllers/expert-schedule.controller.ts` (new),
  `src/routes/expert-schedule.routes.ts` (new), mounted in `src/app.ts` at
  `/api/v1/experts/...` and `/experts/...`. Endpoints:
  - `GET /api/v1/experts/:expertType` — directory of that type's experts
  - `GET /api/v1/experts/:expertType/availability?date=&mode=` — pooled times
  - `GET/PUT /api/v1/experts/:expertType/:expertId/schedule` — read/edit a
    schedule (`:expertId` can be `"me"`)
- `src/validators/expert-schedule.validator.ts` (new) — validates all of the
  above.

### Nutritionist bookings moved into UnifiedBooking
Previously nutritionist bookings lived in their own `NutritionistBooking`
collection, completely separate from personal-training bookings
(`UnifiedBooking`). That's why the collision-check (calculateAvailableSlots)
never saw them. Now they're the same collection.

- `src/models/UnifiedBooking.ts` — `expertId` is now polymorphic (Trainer or
  User, via `expertModel`), and gained the fields a consultation needs
  (`acceptedAt`, `rejectedAt`, `cancelledBy`, `memberNotes`, etc.)
- `src/models/Enums.ts` — added `REJECTED` to `UnifiedBookingStatus` (needed
  because onboarding logic checks "does a non-REJECTED booking exist").
- `src/utils/nutritionist-booking.dto.ts` (new) — translates between the old
  wire format (`NutritionistBookingStatus`, `assignedNutritionistId`, etc.)
  and the new storage shape, so **no client had to change its response
  parsing**.
- `src/controllers/nutritionist-booking.controller.ts` — rewritten to read
  and write `UnifiedBooking` instead of `NutritionistBooking`, through that
  DTO. Booking now calls `pickExpertForSlot` to assign a nutritionist at
  creation time.
- `src/utils/onboarding.service.ts` — reads booking status from
  `UnifiedBooking` now.
- `src/services/nutritionist-expiry.service.ts` — same, for the
  PENDING/ACCEPTED expiry sweep.
- `src/services/session-access.service.ts` — the Zego video-room access
  check now recognises a nutritionist/sports-scientist/doctor as a valid
  "host" on a UnifiedBooking-based consultation (previously only worked for
  the old NutritionistBooking collection).
- `src/controllers/onboarding.controller.ts` (`bookSportsScientist`) — same
  expert-binding-at-creation logic added here too.

### Slots retired for 1:1 experts (kept for everything else)
- `src/controllers/slot.controller.ts` — `createSlot`/`updateSlot` now
  **refuse** new slots typed as nutritionist/sports_scientist/doctor. Old
  slot rows are untouched and still readable. Therapy/sauna/etc. slots are
  unaffected.
- `src/models/Enums.ts` — added `ExpertType.Facility` as the new default tag
  for slots (replacing "nutritionist" as the meaningless default it used to
  be).
- Deleted `src/models/AvailabilityCache.ts` — confirmed zero consumers, dead
  code from an abandoned integration.

### Scripts (new)
- `scripts/migrate-nutritionist-bookings.ts` — copies old
  `NutritionistBooking` rows into `UnifiedBooking`. Idempotent (reuses the
  same `_id`, so re-running is a no-op). **Already run** on the dev DB: 19
  rows migrated, 32 expert schedules had their advance-booking horizon
  bumped to 60 days.
  - **Found a real data bug while running this**: 16 of 35 rows in the old
    collection are from an *even older* schema (fields named `user`/`date`/
    `bookingStatus` instead of `userId`/`bookingDate`/`status`) — pre-dating
    everything we touched. The script now detects and skips these (logs a
    `⚠` warning per row) instead of silently writing corrupted documents.
    **These 16 rows still need manual review** — nobody has looked at what
    they actually are.
- `scripts/seed-experts.ts` — creates one nutritionist + one sports
  scientist as staff Users with a working schedule. **Already run.**
  Registered as `bun run seed:experts` in `package.json`.

---

## Frontdesk (`frontdesk-fitflix`)

- `lib/services/expert-schedule.service.ts` (new),
  `hooks/use-expert-schedule.ts` (new) — talk to the new
  `/api/v1/experts/...` backend routes.
- `components/expert-availability-editor.tsx` (new) — the actual
  weekly-hours / split-shifts / blackout-dates / supported-modes editor UI.
  Shared by all expert types.
- `components/expert-availability-panel.tsx` (new) — wraps the editor with
  "who am I editing" logic (self vs. admin picking someone).
- `app/admin/personal-training/page.tsx` — the old hand-written trainer
  schedule editor (250+ lines) was **deleted** and replaced with the shared
  component above.
- `app/admin/sports-scientist/page.tsx` — added an "Availability" tab using
  the shared panel.
- `app/admin/nutritionist/page.tsx` — used to just redirect to
  `/admin/nutrition`; now it's a real page with the availability panel.
- `lib/rbac.ts` — added `nutritionist` / `sports_scientist` as real frontend
  roles so those accounts can log into the frontdesk and edit their own
  schedule.
- `lib/services/slot.service.ts`, `app/admin/slots/page.tsx` — new slots
  default to "Facility / Therapy Resource" instead of "Nutritionist"; old
  rows still display with a "(retired)" label.

---

## Member app (`USER-APP-FITFLIX`, Flutter)

- `lib/data/api/endpoints.dart` — added the pooled-availability endpoint.
- `lib/data/repository/expert_availability_repository.dart` (new) — calls
  it, converts the response into the same `Slot` shape the UI already knew
  how to render (so almost no widget code had to change).
- `lib/features/nutritionist_booking/providers.dart`,
  `lib/features/sports_scientist_booking/providers.dart` — the availability
  provider's cache key changed from just "date" to "date + mode", because
  availability now genuinely depends on which mode you pick.
- `lib/features/nutritionist_booking/widgets/nutritionist_booking_view.dart`
  — booking/reschedule now send the actual time (`startTime`/`endTime`)
  instead of a slot id, since pooled availability has no slot row behind it.
  Six call sites updated to the new provider key; added a helper
  (`_resolveSelectedSlot`) to look up the chosen time before submitting.
- `lib/features/sports_scientist_booking/widgets/sports_scientist_booking_view.dart`
  — same idea; also **reordered the screen** so you pick the appointment
  mode *before* the time list (times depend on mode now, so showing times
  first didn't make sense).
- `lib/data/repository/onboarding_repository.dart` — `bookNutritionist`,
  `bookSportsScientist`, `rescheduleNutritionistBooking` now accept
  `startTime`/`endTime` (new path) while still accepting the old `slotId`
  (so an un-updated app build doesn't break).

Result: `dart analyze lib/` — 0 errors (was 7 mid-session).

---

## What's verified working right now (local dev DB)

- Login as a staff account issues the correct role
  (`nutritionist@fitflix.test` / `Password@123` → JWT role `"nutritionist"`).
- `GET /api/v1/experts/nutritionist/availability?date=...&mode=ONLINE`
  returns real bookable times generated from the seeded schedule.
- Sunday (marked day-off in the seed) correctly returns zero slots.
- Sports-scientist availability endpoint works the same way.
- `GET /onboarding/status` correctly reads a migrated booking and reports it
  in the old `NutritionistBookingStatus` vocabulary the app expects.
- Backend TypeScript: 234 pre-existing errors (baseline was 235 before this
  session — net one *fewer*, zero new). Frontdesk: 0 errors. Flutter: 0
  errors.

### Test credentials (already seeded)
- Member, parked right on the sports-scientist onboarding step:
  `testmember@fitflix.test` / `Password@123`
- Nutritionist staff (frontdesk, to edit their own availability):
  `nutritionist@fitflix.test` / `Password@123`
- Sports scientist staff (same idea):
  `sportsscientist@fitflix.test` / `Password@123`

---

## What's explicitly NOT done yet (deliberately deferred)

1. **16 malformed legacy `NutritionistBooking` rows** — flagged, not fixed.
   Someone needs to look at what these actually are before deciding whether
   to hand-fix or discard them.
2. **`SlotTimeFilter` double-filtering** in the Flutter app — the backend
   already drops today's past times using the *branch's* clock; the app
   still separately filters using the *device's* clock. Harmless for anyone
   in India, wrong for anyone in another timezone. Not removed yet.
3. **Docs are stale**: `docs/API_REFERENCE.md`, `API_DOCS.md`, the
   frontdesk's `API_REFERENCE.md`, and this repo's `CLAUDE.md` (onboarding
   section) still describe the old slot-based flow.
4. Full acceptance-test pass (blackout dates, two-nutritionist collision
   test, therapy-booking regression, running the two ported test suites)
   was outlined in the plan but not executed — only the four spot-checks
   above were run.
