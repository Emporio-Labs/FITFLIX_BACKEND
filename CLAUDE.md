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

**Roles:** `"user"` | `"admin"` | `"doctor"` | `"trainer"`

**JWT payload:** `{ sub: userId, email, role }`

**Config env vars:** `JWT_SECRET` (required), `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_EXPIRES_IN` (default: `"12h"`)

**Auth flow:** Signup → creates User with `onboarded: false` → Login → JWT issued → Bearer token on all protected routes

---

## Models

| Model | File | Key Fields | Notes |
|-------|------|-----------|-------|
| User | `User.ts` | username, phone, email, age, gender, passwordHash (select:false), onboarded, onboardingStatus | Core user entity |
| Admin | `Admin.ts` | adminName, email, phone, passwordHash (select:false) | |
| Doctor | `Doctor.ts` | doctorName, email, phone, specialities[] | Has public endpoints |
| Trainer | `Trainer.ts` | trainerName, email, phone, specialities[] | Has public endpoints |
| Appointment | `Appointment.ts` | appointmentDate, status, user→User, slot→Slot, doctor→Doctor | Doctor appointments |
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
| Report | `Report.ts` | userId, subject, aiSummary, hasPdf | Renamed: see HpodReport |
| HpodMetric | `HpodMetric.ts` | userId, metrics, recordedAt | HPOD health pod data |
| HpodReport | `Hpodreport.model.ts` | userId, subject, aiSummary, hasPdf, receivedAt | Gmail-ingested reports |
| **HealthMarkers** | `HealthMarkers.ts` | userId (unique), weight, height, bmi, allergies, medications, diseaseHistory, sleepHours, activityLevel | Onboarding step 1 |
| **HealthGoals** | `HealthGoals.ts` | userId (unique), goals[], targetWeight, timeline, workoutExperience, foodPreferences | Onboarding step 2 |
| **ConsentForm** | `ConsentForm.ts` | userId (unique), accepted, acceptedAt, signatureUrl, ipAddress | Onboarding step 3 |
| **MedicalReport** | `MedicalReport.ts` | userId (index), reportName, reportType, reportUrl | Onboarding step 4, multiple per user |
| **ExpertAppointment** | `ExpertAppointment.ts` | userId+expertType (unique compound), bookingStatus, appointmentDate, meetingLink, calComBookingId | Onboarding steps 5+6 |

---

## Enums (`src/models/Enums.ts`)

```
Gender              — Male, Female, Others (numeric)
BookingStatus       — Booked, Confirmed, Cancelled, Attended, Unattended (numeric)
MembershipStatus    — Active, Paused, Cancelled, Expired
TodoStatus          — Todo, Doing, Done (numeric)
LeadStatus          — New, Contacted, Qualified, Warm, Hot, Cold, Converted, Lost
CreditTransactionType  — Consume, Refund, AdminTopUp, Void
CreditTransactionSource — Booking, Appointment, Admin
MuscleGroup         — Chest, Back, Legs, Shoulders, Arms, Core
ExerciseDifficulty  — Beginner, Intermediate, Advanced
WorkoutSessionStatus — Active, Completed, Abandoned
OnboardingStep      — HEALTH_MARKERS, HEALTH_GOALS, CONSENT, REPORT_UPLOAD, SPORTS_SCIENTIST_BOOKING, NUTRITIONIST_BOOKING, COMPLETED
ExpertType          — sports_scientist, nutritionist
AppointmentBookingStatus — Pending, Confirmed, Cancelled
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

All routes mounted in `src/app.ts`:

| Prefix | File | Access |
|--------|------|--------|
| `/auth` | `auth.routes.ts` | Public (rate-limited) |
| `/admins` | `admin.routes.ts` | admin only |
| `/doctors` | `doctor.routes.ts` | Public listing + protected CRUD |
| `/trainers` | `trainer.routes.ts` | Public listing + protected CRUD |
| `/users` | `user.routes.ts` | admin, user |
| `/onboarding` | `onboarding.routes.ts` | user only |
| `/memberships` | `membership.routes.ts` | admin, user |
| `/slots` | `slot.routes.ts` | admin |
| `/services` | `service.routes.ts` | admin, user |
| `/therapies` | `therapy.routes.ts` | admin, user |
| `/bookings` | `booking.routes.ts` | admin, user |
| `/credits` | `credit.routes.ts` | admin, user |
| `/appointments` | `appointment.routes.ts` | admin, user, doctor |
| `/schedules` | `schedule.routes.ts` | admin, user |
| `/exercises` | `exercise.routes.ts` | admin, user |
| `/leads` | `lead.routes.ts` | admin |
| `/webhook` | `webhook.route.ts` | Webhook auth |
| `/workouts` | `workout.routes.ts` | user |

---

## Onboarding Workflow System

The backend is the **single source of truth** for onboarding. Flutter app must follow backend-dictated step order — no local step skipping.

### Step Order (strict, enforced by backend)
1. `HEALTH_MARKERS`
2. `HEALTH_GOALS`
3. `CONSENT`
4. `REPORT_UPLOAD`
5. `SPORTS_SCIENTIST_BOOKING`
6. `NUTRITIONIST_BOOKING`
7. `COMPLETED`

### Onboarding Status (embedded on User document)

```typescript
onboardingStatus: {
  currentStep: OnboardingStep         // what the user must do next
  completedSteps: OnboardingStep[]    // history
  healthMarkersCompleted: boolean
  healthGoalsCompleted: boolean
  consentCompleted: boolean
  reportsUploaded: boolean
  sportsScientistBooked: boolean
  nutritionistBooked: boolean
  onboardingCompleted: boolean
  startedAt?: Date
  completedAt?: Date
}
```

### Onboarding API Endpoints (`/onboarding/*`, user role only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/onboarding/status` | Get current step, completedSteps, allowedNextStep |
| POST | `/onboarding/health-markers` | Submit markers; auto-calculates BMI |
| POST | `/onboarding/health-goals` | Submit goals |
| POST | `/onboarding/consent` | Submit consent; captures IP |
| POST | `/onboarding/reports` | Upload report metadata (multiple allowed) |
| POST | `/onboarding/appointments` | Book expert; sports_scientist before nutritionist |
| POST | `/onboarding/complete` | Finalize; sets `user.onboarded = true` |

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
| `ENABLE_GMAIL_WATCH` | No | — | Gmail pub/sub for HPOD reports |
| `PUBSUB_TOPIC` | No | — | Google Pub/Sub topic |

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
