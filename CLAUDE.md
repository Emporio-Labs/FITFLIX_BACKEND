# HybridHuman Backend API — Claude Reference

## Project Overview

Express.js + MongoDB backend for the **Fitflix Flutter app** and **FrontDesk Fitflix admin dashboard**. Deployed on Vercel via serverless function.

**Runtime:** Bun (also compatible with Node.js)
**Language:** TypeScript (strict)
**Framework:** Express 5.2.1
**DB:** MongoDB via Mongoose 9.3.1
**Validation:** Zod 4.3.6
**Auth:** JWT (jsonwebtoken) + bcryptjs
**Linter/Formatter:** Biome

---

## Commands

```bash
bun run dev                          # Start dev server
bun run index.ts                     # Same as above
bun run scripts/create-admin.ts      # Create admin user
bun run scripts/migrate-credits.ts   # Migrate credit data
bun run scripts/migrate-onboarding.ts [--dry-run]  # Migrate onboarding status for existing users
bun run scripts/seed-exercises.ts    # Seed exercise library
npx tsc --noEmit                     # TypeScript type check (no emit)
```

---

## Folder Structure

```
FITFLIX_BACKEND/
├── index.ts                  # Entry point — connects DB, starts server
├── api/index.ts              # Vercel serverless handler
├── src/
│   ├── app.ts                # Express app, CORS, middleware, route mounting
│   ├── models/               # Mongoose schemas
│   ├── controllers/          # Express RequestHandler functions
│   ├── routes/               # Express Router files
│   ├── middleware/           # Auth, RBAC, rate limiting
│   ├── validators/           # Zod schemas
│   ├── utils/                # Services and helpers
│   └── types/                # TypeScript type augmentations
├── scripts/                  # One-off admin/migration scripts
└── vercel.json               # Vercel deployment config
```

---

## Architecture Patterns

### Controller Pattern

Function-based, not class-based. Every handler is a named `RequestHandler` export.

```typescript
export const handlerName: RequestHandler = async (req, res, next) => {
  // 1. Auth/role guard (inline)
  if (!req.user || req.user.role !== "user") {
    res.status(403).json({ error: "...", code: "FORBIDDEN" });
    return;
  }

  // 2. Validate with Zod
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Validation failed",
      code: "VALIDATION_ERROR",
      details: getValidationDetails(parsed.error.issues),
    });
    return;
  }

  // 3. Business logic / DB calls
  try {
    const result = await Model.create({ ... });
    res.status(201).json({ message: "...", result });
  } catch (error) {
    next(error);
  }
};
```

### Model Pattern

```typescript
import mongoose from "mongoose";

const schema = new mongoose.Schema({
  field: { type: String, required: true },
  ref: { type: mongoose.Schema.Types.ObjectId, ref: "OtherModel" },
  optional: { type: String, default: undefined },
  arr: { type: [String], default: [] },
  enumField: { type: String, enum: Object.values(SomeEnum) },
}, { timestamps: true });

type Document = mongoose.InferSchemaType<typeof schema>;

export default (mongoose.models.ModelName as mongoose.Model<Document>) ||
  mongoose.model<Document>("ModelName", schema);
```

### Route Pattern

```typescript
const router = Router();
router.use(authenticateToken);                    // applies to all below
router.get("/", authorize(["admin"]), handler);   // RBAC inline
router.get("/:id", authorize(["admin", "user"]), handler);
export default router;
```

### Validator Pattern (Zod)

```typescript
const requiredString = z.string().trim().min(1);
const optionalString = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().min(1).optional()
);
const schema = z.object({ ... });
export type SchemaBody = z.infer<typeof schema>;
```

### Error Response Format

All error responses follow this envelope — the global middleware in `app.ts` normalizes any error shape:

```json
{
  "error": "Human-readable message",
  "code": "ERROR_CODE",
  "details": { "field": "error message" }
}
```

Error codes: `VALIDATION_ERROR` | `BAD_REQUEST` | `UNAUTHORIZED` | `FORBIDDEN` | `NOT_FOUND` | `CONFLICT` | `NOT_IMPLEMENTED` | `INTERNAL_ERROR` | `API_ERROR`

### ID Validation Pattern

```typescript
const getIdParam = (idParam: string | string[] | undefined): string | null => {
  if (typeof idParam !== "string" || !mongoose.Types.ObjectId.isValid(idParam)) return null;
  return idParam;
};
```

---

## Auth System

**Middleware:** `src/middleware/jwt-auth.middleware.ts` — `authenticateToken`
- Reads `Authorization: Bearer <token>`
- Verifies JWT, attaches `AuthenticatedUser` to `req.user`

**RBAC:** `src/middleware/rbac.middleware.ts` — `authorize(roles[])`
- Checks `req.user.role` against allowed roles
- Returns 403 if not allowed

**Roles:** `"user"` | `"admin"` | `"frontdesk"` | `"trainer"` | `"nutritionist"` | `"doctor"`

`doctor` is declared in the `AppUserRole` union but no route authorizes it.
`normalizeRole()` also collapses legacy aliases before comparison:
`ROLE_FRONT_DESK_STAFF` → `admin`, `staff`/`ROLE_FRONT_END_STAFF` → `frontdesk`,
`ROLE_MEMBER` → `user`.

**JWT payload:** `{ sub: userId, email, role }`

**Config env vars:** `JWT_SECRET` (required), `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_EXPIRES_IN` (default: `"12h"`)

**Auth flow:** Signup → creates User with `onboarded: false` → Login → JWT issued → Bearer token on all protected routes

---

## Models

| Model | File | Key Fields | Notes |
|-------|------|-----------|-------|
| User | `User.ts` | username, phone, email, age, gender, passwordHash (select:false), onboarded, onboardingStatus | Core user entity |
| Admin | `Admin.ts` | adminName, email, phone, passwordHash (select:false) | |
| Trainer | `Trainer.ts` | trainerName, email, phone, specialities[] | Has public endpoints |
| Booking | `Bookings.ts` | bookingDate, status, user→User, slot→Slot, service→Service | Service bookings |
| Slot | `Slots.ts` | date, startTime, endTime, capacity, remainingCapacity, parentTemplate | Compound unique index |
| Service | `Service.ts` | serviceType (Service/Therapy), serviceName, creditCost, slots[] | |
| Membership | `Membership.ts` | user→User, planName, creditsIncluded, creditsRemaining, status, startDate, endDate | Composite indexes |
| CreditTransaction | `CreditTransaction.ts` | user→User, amount, type, sourceType, sourceId | Credit ledger |
| Schedule | `Schedule.ts` | user→User, scheduledDate, status, todos[] | |
| Exercise | `Exercise.ts` | name, muscleGroup, difficulty, equipment, instructions, isSystem | Text index on name |
| WorkoutSession | `WorkoutSession.ts` | user→User, status | |
| WorkoutExercise | `WorkoutExercise.ts` | session→WorkoutSession, exercise→Exercise | |
| SetLog | `SetLog.ts` | workoutExercise→WorkoutExercise, reps, weight | |
| MembershipPlan | `MembershipPlan.ts` | planName, creditsIncluded, price | Admin-defined plans |
| Lead | `Lead.ts` | leadName, email, phone, status, convertedUser | Sales leads |
| BcaMetric | `BcaMetric.ts` | userId, vitals, bodyComposition, recordedAt | ActiveX BCA (Body Composition Analysis) data, pulled by phone |
| **HealthMarkers** | `HealthMarkers.ts` | userId (unique), weight, height, bmi, allergies, medications, diseaseHistory, sleepHours, activityLevel | Onboarding step 1 |
| **HealthGoals** | `HealthGoals.ts` | userId (unique), goals[], targetWeight, timeline, workoutExperience, foodPreferences | Onboarding step 2 |
| **ConsentForm** | `ConsentForm.ts` | userId (unique), accepted, acceptedAt, signatureUrl, ipAddress | Onboarding step 3 |
| **MedicalReport** | `MedicalReport.ts` | userId (index), reportName, reportType, reportUrl | Onboarding step 4, multiple per user |
| **NutritionistBooking** | `NutritionistBooking.ts` | userId, slotId, bookingDate, startTime, endTime, appointmentMode, status, zegoRoomId, hostLiveAt | Onboarding step 5 |
| **Class** | `Class.ts` | **`_id` is a UUID string**, name, mode, sessionType, instructorUserId, creditCost, access, bookingRequirement | Class templates |
| **ScheduledSession** | `ScheduledSession.ts` | classId, sessionDate, startTime, endTime, capacity, status, roomStatus, videoRoomId, hostLiveAt | Dated class occurrences |
| **Invoice** | `Invoice.ts` | invoiceNumber (unique), userId/leadId, items[], total, planSnapshot, paymentStatus | FrontDesk billing |
| **DeletionRequest** | `DeletionRequest.ts` | userId, fullName, email, phone, reason, status | Account-deletion requests |
| **ConferenceSettings** | `ConferenceSettings.ts` | defaultVideoResolution, defaultFrameRate, maxParticipantsPerSession, layoutTemplates | Single global document |
| **Notification** | `Notification.ts` | userId, kind, channel, readAt | In-app + FCM |
| **TokenBlacklist** | `TokenBlacklist.ts` | token | Revoked JWTs (logout) |

---

## Enums (`src/models/Enums.ts`)

```
Gender              — Male, Female, Other (string; legacy numeric 0/1/2 normalized on input)
BookingStatus       — Booked, Confirmed, Cancelled, Attended, Unattended (numeric)
MembershipStatus    — Active, Paused, Cancelled, Expired
TodoStatus          — Todo, Doing, Done (numeric)
LeadStatus          — New, Contacted, Qualified, Warm, Hot, Cold, Converted, Lost
CreditTransactionType  — Consume, Refund, AdminTopUp, Void
CreditTransactionSource — Booking, Appointment, Admin
MuscleGroup         — Chest, Back, Legs, Shoulders, Arms, Core, FullBody
ExerciseSection     — warmup, workout, stretching
ExerciseDifficulty  — Beginner, Intermediate, Advanced
WorkoutSessionStatus — Active, Completed, Abandoned
OnboardingStep      — HEALTH_MARKERS, HEALTH_GOALS, CONSENT, REPORT_UPLOAD, NUTRITIONIST_BOOKING, COMPLETED
ExpertType          — nutritionist
AppointmentBookingStatus — Pending, Confirmed, Cancelled, Rescheduled, Completed, NoShow
AppointmentMode     — IN_PERSON, ONLINE
MeetingStatus       — SCHEDULED, IN_PROGRESS, COMPLETED
NutritionistBookingStatus — PENDING, ACCEPTED, REJECTED, COMPLETED, EXPIRED, RESCHEDULE_REQUIRED
InvoicePaymentStatus — DRAFT, PENDING, PAID, FAILED, CANCELLED, REFUNDED
InvoicePaymentMethod — CASH, UPI, CARD, BANK_TRANSFER, NONE
DeletionRequestStatus — Pending, Processed, Cancelled

Full list (including the nutrition enums) — see `src/models/Enums.ts`.
```

HealthMarkers-specific enums live in `src/models/HealthMarkers.ts`:
```
ActivityLevel — Sedentary, Light, Moderate, Active, VeryActive
```

HealthGoals-specific enums live in `src/models/HealthGoals.ts`:
```
WorkoutExperience — None, Beginner, Intermediate, Advanced
```

---

## Routes

All routes mounted in `src/app.ts`. **Full endpoint reference:
[docs/API_REFERENCE.md](docs/API_REFERENCE.md)** — every route with method,
path, auth, roles, and handler is in its
[Endpoint index](docs/API_REFERENCE.md#endpoint-index). Update that file in the
same commit whenever you change a route.

| Prefix | File | Access |
|--------|------|--------|
| `/auth` | `auth.routes.ts` | Public (rate-limited); includes phone/OTP |
| `/delete-account` | `delete-account.routes.ts` | Public (rate-limited) |
| `/admins` | `admin.routes.ts` | admin |
| `/trainers` | `trainer.routes.ts` | Public listing + protected CRUD |
| `/users` | `user.routes.ts` | admin, nutritionist, user |
| `/onboarding` | `onboarding.routes.ts` | user; `/status/:userId` is admin + frontdesk |
| `/memberships` | `membership.routes.ts` | admin, frontdesk, user |
| `/membership-plans` | `membershipPlan.routes.ts` | Public list + admin CRUD |
| `/slots` | `slot.routes.ts` | admin, trainer, user |
| `/services` | `service.routes.ts` | admin, trainer, user |
| `/therapies` | `therapy.routes.ts` | Public listing + admin, trainer, user |
| `/bookings` | `booking.routes.ts` | admin, user |
| `/credits` | `credit.routes.ts` | admin, user |
| `/invoices` | `invoice.routes.ts` | admin, frontdesk |
| `/schedules` | `schedule.routes.ts` | admin, trainer, user |
| `/exercises` | `exercise.routes.ts` | admin, user |
| `/leads` | `lead.routes.ts` | Public capture + admin, frontdesk, trainer |
| `/dashboard` | `dashboard.routes.ts` | admin, frontdesk |
| `/nutrition` | `nutrition.routes.ts` | nutritionist, admin, user |
| `/notifications` | `notification.routes.ts` | any authenticated |
| `/webhook` | `webhook.route.ts` | Webhook secret + user/admin reads |
| `/internal` | `internal.routes.ts` | `X-Internal-Secret` |
| `/workouts` | `workout.routes.ts` | user |
| `/workout-plans` | `workout-plan.routes.ts` | admin, trainer, user |
| `/api/v1` (classes) | `class.routes.ts` | admin CRUD + member listing |
| `/api/v1` (schedule) | `class-schedule.routes.ts` | admin CRUD + member listing |
| `/api/v1/zego` | `zego.routes.ts` | Per-session access, not role-based |
| `/api/v1/admin/settings` | `settings.routes.ts` | Authenticated (no role guard) |
| *(app root)* + `/api/v1` | `nutritionist-booking.routes.ts` | user + admin, nutritionist, frontdesk |

Also declared inline in `app.ts`: `GET /health`, `POST /test/firebase`.

**Alias mounts.** Some routers are mounted at more than one prefix — the paths
are exact duplicates:

| Router | Primary | Aliases |
|---|---|---|
| `booking.routes.ts` | `/bookings` | `/api/v1/bookings`, `/api/v1/admin/bookings` |
| `credit.routes.ts` | `/credits` | `/api/v1/credits` |
| `invoice.routes.ts` | `/invoices` | `/api/invoices` |
| `nutritionist-booking.routes.ts` | *(app root)* | `/api/v1` |

`/api/v1/admin/bookings` is **not** admin-scoped — the prefix carries no
authorization meaning; roles come from each route's `authorize([...])`.

---

## Onboarding Workflow System

The backend is the **single source of truth** for onboarding. Flutter app must follow backend-dictated step order — no local step skipping.

### Step Order (strict, enforced by backend)

`STEP_ORDER` in `onboarding.service.ts` is four steps plus a terminal marker:

1. `HEALTH_MARKERS`
2. `HEALTH_GOALS`
3. `CONSENT`
4. `REPORT_UPLOAD`
5. `COMPLETED`

`NUTRITIONIST_BOOKING` is in the `OnboardingStep` enum but **not** in
`STEP_ORDER`, so the linear machine never advances into it. Booking a
nutritionist sets `onboardingStatus.nutritionistBooked` directly, and
`completeOnboarding` independently refuses to finish without a non-`REJECTED`
`NutritionistBooking` (or that flag). There is no sports-scientist step.

### Onboarding Status (embedded on User document)

```typescript
onboardingStatus: {
  currentStep: OnboardingStep         // what the user must do next
  completedSteps: OnboardingStep[]    // history
  healthMarkersCompleted: boolean
  healthGoalsCompleted: boolean
  consentCompleted: boolean
  reportsUploaded: boolean
  nutritionistBooked: boolean
  onboardingCompleted: boolean
  startedAt?: Date
  completedAt?: Date
}
```

`GET /onboarding/status` does **not** return these booleans. It returns
`{ currentStep, completedSteps, onboardingCompleted, allowedNextStep, bookingDetails }`
— see `OnboardingStatusResponse`.

### Onboarding API Endpoints

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/onboarding/status` | user | Current step, completedSteps, allowedNextStep, bookingDetails |
| GET | `/onboarding/status/:userId` | admin, frontdesk | Same payload for any user |
| POST | `/onboarding/health-markers` | user | Submit markers; auto-calculates BMI |
| POST | `/onboarding/health-goals` | user | Submit goals |
| POST | `/onboarding/consent` | user | Submit consent; captures IP |
| POST | `/onboarding/reports` | user | Upload report (multipart `file`; rate-limited) |
| POST | `/onboarding/complete` | user | Finalize; sets `user.onboarded = true` |

The nutritionist booking step lives on the nutritionist-booking router, which is
mounted at the app root and so answers on the `/onboarding` prefix:

| Method | Path | Handler |
|--------|------|---------|
| POST | `/onboarding/nutritionist/book` | `bookNutritionist` |
| POST, PATCH | `/onboarding/nutritionist/reschedule` | `rescheduleMyBooking` |

There is no `/onboarding/appointments`, `/onboarding/sports-scientist`, or
`/onboarding/nutritionist` route.

**Error codes for out-of-order steps:** 403 `STEP_NOT_ALLOWED`, 409 `ALREADY_COMPLETED`, 400 `MISSING_STEPS`

**Workflow engine:** `src/utils/onboarding.service.ts`
- `getOnboardingStatus(userId)` — fetch current status
- `validateStepAllowed(userId, step)` — throws if wrong step
- `advanceStep(userId, completedStep)` — moves to next step
- `completeOnboarding(userId)` — validates all steps, marks complete

**Backward compat:** `PATCH /users/:id/onboard` still works. Both `user.onboarded` and `onboardingStatus.onboardingCompleted` are set on completion.

**Migration:** `bun run scripts/migrate-onboarding.ts [--dry-run]` — backfills `onboardingStatus` for existing users.

---

## Services (`src/utils/`)

| File | Purpose |
|------|---------|
| `credit.service.ts` | Credit deduction/refund logic; throws `CreditServiceError` |
| `email.service.ts` | Gmail watch integration for health report emails |
| `jwt.ts` | `signAuthToken()`, `verifyAuthToken()` |
| `password.ts` | `hashPassword()`, `verifyPassword()`, `isHashedPassword()` |
| `db.ts` | `connectDB()` — single-connection promise with retry |
| `api-error.ts` | `buildApiErrorEnvelope()`, `mapStatusToErrorCode()`, type defs |
| `llm.service.ts` | OpenAI integration for report summarization |
| `health-score.ts` | Health scoring utilities |
| `onboarding.service.ts` | Onboarding workflow engine (step validation + progression) |

---

## Environment Variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `MONGODB_URL` | Yes | — | MongoDB connection string |
| `JWT_SECRET` | Yes | — | JWT signing secret |
| `JWT_ISSUER` | No | — | |
| `JWT_AUDIENCE` | No | — | |
| `JWT_EXPIRES_IN` | No | `"12h"` | |
| `PASSWORD_SALT_ROUNDS` | No | `10` | Range: 4–15 |
| `AUTH_RATE_LIMIT_WINDOW_MS` | No | 15 min | |
| `AUTH_RATE_LIMIT_MAX` | No | `10` | |
| `CORS_ALLOWED_ORIGINS` | No | (all in dev) | Comma-separated |
| `NODE_ENV` | No | — | `production` enables HSTS |
| `PORT` | No | `3000` | |
| `ACTIVEX_API_KEY` | For BCA sync | — | ActiveX external API key (`x-api-key`) |
| `ACTIVEX_BASE_URL` | No | `https://api.activex.ai/external/bca` | ActiveX BCA endpoint |
| `ACTIVEX_BCA_LOOKBACK_DAYS` | No | `365` | Lookback window for the sync `Date` filter |

---

## Known Pre-existing TypeScript Errors

These errors existed before this session and are **not introduced by new code**. Do not attempt to fix them unless explicitly asked:

- `src/controllers/booking.controller.ts` — `status`/`body` type on `never`
- `src/controllers/credit.controller.ts` — `CreditTransactionSource` string assignability
- `src/controllers/exercise.controller.ts` — `muscleGroup` string vs enum
- `src/controllers/lead.controller.ts` — multiple property access on `never`
- `src/controllers/membership.controller.ts` — Mongoose overload mismatch
- `src/controllers/user.controller.ts` — Zod 4 `$ZodIssue` path `PropertyKey[]` vs `(string | number)[]`
- `src/utils/credit.service.ts` — `insertMany` options type
- `src/utils/jwt.ts` — `StringValue` type mismatch

The Zod 4 path type issue (`PropertyKey[]` instead of `(string | number)[]`) affects the `getValidationDetails` helper in multiple controllers. New code should use `issue.path.map(String).join(".")` and accept `PropertyKey[]` in the type signature.

---

## Adding a New Resource (Checklist)

1. Add any new enums to `src/models/Enums.ts`
2. Create `src/models/NewModel.ts` using the model pattern above
3. Create `src/validators/new.validator.ts` with Zod schemas
4. Create `src/controllers/new.controller.ts` with `RequestHandler` exports
5. Create `src/routes/new.routes.ts` with `authenticateToken` + `authorize`
6. Register in `src/app.ts`: `app.use("/new", newRouter)`
