# Fitflix Backend — API Reference

Single-source HTTP reference for the Fitflix Express + MongoDB backend that powers the Fitflix Flutter app and the FrontDesk admin dashboard. Covers every endpoint mounted in [src/app.ts](../src/app.ts).

- **Base URL (production):** `https://api.example.com`
- **Base URL (local):** `http://localhost:3000` (configurable via `PORT`)
- **Content type:** `application/json` for all request bodies
- **Date format:** ISO-8601 (`2026-05-22T10:30:00.000Z`)
- **Object IDs:** 24-character MongoDB hex strings

---

## Table of contents

1. [Authentication](#authentication)
2. [Conventions](#conventions)
3. [Error responses](#error-responses)
4. [Enums](#enums)
5. [Auth — `/auth`](#auth--auth)
6. [Admins — `/admins`](#admins--admins)
7. [Users — `/users`](#users--users)
8. [Onboarding — `/onboarding`](#onboarding--onboarding)
9. [Doctors — `/doctors`](#doctors--doctors)
10. [Trainers — `/trainers`](#trainers--trainers)
11. [Slots — `/slots`](#slots--slots)
12. [Services — `/services`](#services--services)
13. [Therapies — `/therapies`](#therapies--therapies)
14. [Bookings — `/bookings`](#bookings--bookings)
15. [Appointments — `/appointments`](#appointments--appointments)
16. [Credits — `/credits`](#credits--credits)
17. [Memberships — `/memberships`](#memberships--memberships)
18. [Schedules — `/schedules`](#schedules--schedules)
19. [Exercises — `/exercises`](#exercises--exercises)
20. [Workouts — `/workouts`](#workouts--workouts)
21. [Workout plans — `/workout-plans`](#workout-plans--workout-plans)
22. [Leads — `/leads`](#leads--leads)
23. [Webhook — `/webhook`](#webhook--webhook)
24. [Nutrition — `/nutrition`](#nutrition--nutrition)
25. [Health check — `/health`](#health-check--health)
26. [Appendix A: Onboarding step order](#appendix-a-onboarding-step-order)

---

## Authentication

Most endpoints use **JWT bearer tokens**. Obtain a token via [`POST /auth/login`](#post-authlogin) and pass it on subsequent requests:

```
Authorization: Bearer <token>
```

- **Token lifetime:** 12 hours (configurable via `JWT_EXPIRES_IN`).
- **Roles:** `user`, `admin`, `doctor`, `trainer`, `nutritionist`. The token's role determines which endpoints are accessible.
- **Public endpoints** are explicitly labelled `Auth: Public`.
- **Webhook endpoint** uses a shared-secret header (`X-Webhook-Secret`) instead of JWT.

Failed authentication returns `401 UNAUTHORIZED`. Insufficient role returns `403 FORBIDDEN`.

## Conventions

### Request

- All bodies are JSON. Set `Content-Type: application/json`.
- Query parameters use standard URL encoding.
- Path params noted as `:id` accept a 24-character MongoDB ObjectId. Anything else returns `400 BAD_REQUEST`.

### Response

- Successful responses use `2xx` status codes with a JSON body.
- Pagination, when supported, returns:

```json
{
  "data": [ /* ... */ ],
  "pagination": { "page": 1, "limit": 20, "total": 137, "totalPages": 7 }
}
```

(The `data` key varies per endpoint — e.g., `users`, `exercises`, `bookings`.)

### Rate limiting

- `/auth/signup` and `/auth/login` are rate-limited (default: 10 attempts per 15 minutes per IP; configurable via `AUTH_RATE_LIMIT_WINDOW_MS` and `AUTH_RATE_LIMIT_MAX`).
- `/leads/public-capture` is rate-limited and CAPTCHA-protected.

### CORS

Allowed origins are configured via `CORS_ALLOWED_ORIGINS` (comma-separated). In development with no value set, all origins are permitted.

## Error responses

Every error response follows this envelope (normalized by global middleware in `src/app.ts`):

```json
{
  "error": "Human-readable message",
  "code": "VALIDATION_ERROR",
  "details": { "fieldName": "validation message" }
}
```

`details` is omitted for non-validation errors.

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Zod validation failed; `details` lists per-field messages |
| `BAD_REQUEST` | 400 | Malformed request, invalid ObjectId, or business-rule violation |
| `UNAUTHORIZED` | 401 | Missing/invalid/expired JWT |
| `FORBIDDEN` | 403 | Valid JWT but role not permitted |
| `NOT_FOUND` | 404 | Resource does not exist |
| `CONFLICT` | 409 | Resource conflict (duplicate email, overbooked slot, step already completed) |
| `NOT_IMPLEMENTED` | 501 | Endpoint stub — feature not yet available |
| `INTERNAL_ERROR` | 500 | Unhandled server error |
| `API_ERROR` | other | Catch-all for non-standard status codes |

## Enums

Authoritative source: [src/models/Enums.ts](../src/models/Enums.ts). Numeric enums are listed in declaration order (index = value).

| Enum | Values |
|---|---|
| `Gender` *(numeric)* | `Male` (0), `Female` (1), `Others` (2) |
| `BookingStatus` *(numeric)* | `Booked` (0), `Confirmed` (1), `Cancelled` (2), `Attended` (3), `Unattended` (4) |
| `MembershipStatus` | `Active`, `Paused`, `Cancelled`, `Expired` |
| `TodoStatus` *(numeric)* | `Todo` (0), `Doing` (1), `Done` (2) |
| `LeadStatus` | `New`, `Contacted`, `Qualified`, `Warm`, `Hot`, `Cold`, `Converted`, `Lost` |
| `CreditTransactionType` | `Consume`, `Refund`, `AdminTopUp`, `Void` |
| `CreditTransactionSource` | `Booking`, `Appointment`, `Admin` |
| `MuscleGroup` | `Chest`, `Back`, `Legs`, `Shoulders`, `Arms`, `Core` |
| `ExerciseDifficulty` | `Beginner`, `Intermediate`, `Advanced` |
| `WorkoutSessionStatus` | `Active`, `Completed`, `Abandoned` |
| `OnboardingStep` | `HEALTH_MARKERS`, `HEALTH_GOALS`, `CONSENT`, `REPORT_UPLOAD`, `SPORTS_SCIENTIST_BOOKING`, `NUTRITIONIST_BOOKING`, `COMPLETED` |
| `ExpertType` | `sports_scientist`, `nutritionist` |
| `AppointmentBookingStatus` | `Pending`, `Confirmed`, `Cancelled` |
| `PlanGoal` *(workout)* | `Strength`, `Hypertrophy`, `Endurance`, `WeightLoss`, `Maintenance`, `Custom` |
| `PlanStatus` *(workout)* | `Draft`, `Active`, `Paused`, `Completed`, `Archived` |
| `SplitType` | `FullBody`, `UpperLower`, `PushPull`, `PushPullLegs`, `Custom` |
| `NutritionGoal` | `WeightLoss`, `MuscleGain`, `Maintenance`, `Endurance`, `Medical`, `Custom` |
| `NutritionPlanStatus` | `Draft`, `Scheduled`, `Active`, `Paused`, `Completed`, `Archived` |
| `MealType` | `Breakfast`, `Lunch`, `Dinner`, `Snack`, `PreWorkout`, `PostWorkout`, `EarlyMorning`, `DuringWorkout`, `EveningSnack`, `Bedtime` |
| `DietaryPreference` | `Veg`, `NonVeg`, `Vegan`, `Eggetarian` |
| `NutritionFoodSource` | `System`, `Custom` |
| `MealLogStatus` | `Logged`, `Skipped`, `Partial`, `Pending` |
| `MealLogSource` | `Manual`, `AI`, `Wearable`, `Scan` |
| `ProgressRecordedBy` | `User`, `Nutritionist` |
| `ActivityLevel` *(health markers)* | `Sedentary`, `Light`, `Moderate`, `Active`, `VeryActive` |
| `WorkoutExperience` *(health goals)* | `None`, `Beginner`, `Intermediate`, `Advanced` |

> Each endpoint section below uses this template:
> **Auth → Path params → Query params → Request body → Example request (curl + TypeScript/axios) → Success response → Error responses → Notes.**
> Sections are omitted when they don't apply.

---

## Auth — `/auth`

### POST /auth/signup

Register a new end-user account. Returns a `userId`; the client must call `/auth/login` afterwards to obtain a JWT.

**Auth:** Public (rate-limited)

**Request body**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `username` | string | yes | min 1 |
| `phone` | string | yes | min 1 |
| `email` | string | yes | valid email, unique |
| `age` | number | yes | 0–130 |
| `gender` | Gender | yes | `Male` \| `Female` \| `Others` or numeric (0–2) |
| `password` | string | yes | min 8, must contain letter + number |
| `healthGoals` | string[] | no | default `[]` |

**Example request**

```bash
curl -X POST "https://api.example.com/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "jane.doe",
    "phone": "+15555550123",
    "email": "user@example.com",
    "age": 29,
    "gender": "Female",
    "password": "Sup3rSecret!",
    "healthGoals": ["weight loss", "better sleep"]
  }'
```

```ts
import axios from "axios";

const { data } = await axios.post("https://api.example.com/auth/signup", {
  username: "jane.doe",
  phone: "+15555550123",
  email: "user@example.com",
  age: 29,
  gender: "Female",
  password: "Sup3rSecret!",
  healthGoals: ["weight loss", "better sleep"],
});
```

**Success response (201)**

```json
{
  "message": "User signup successful",
  "userId": "5f1a2b3c4d5e6f7a8b9c0d1e",
  "onboarded": false
}
```

**Error responses**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing / malformed field |
| 409 | `CONFLICT` | Email already registered |
| 429 | `API_ERROR` | Rate limit exceeded |

### POST /auth/login

Exchange credentials for a JWT. The login route resolves identity across `User`, `Admin`, `Doctor`, and `Trainer` collections by email; the returned `role` reflects which collection matched.

**Auth:** Public (rate-limited)

**Request body**

| Field | Type | Required |
|---|---|---|
| `email` | string (email) | yes |
| `password` | string | yes |

**Example request**

```bash
curl -X POST "https://api.example.com/auth/login" \
  -H "Content-Type: application/json" \
  -d '{ "email": "user@example.com", "password": "Sup3rSecret!" }'
```

```ts
import axios from "axios";

const { data } = await axios.post("https://api.example.com/auth/login", {
  email: "user@example.com",
  password: "Sup3rSecret!",
});
const token: string = data.token;
```

**Success response (200)**

```json
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "tokenType": "Bearer",
  "expiresIn": 43200,
  "user": {
    "id": "5f1a2b3c4d5e6f7a8b9c0d1e",
    "email": "user@example.com",
    "role": "user"
  }
}
```

**Error responses**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing email/password |
| 401 | `UNAUTHORIZED` | Email not found or password mismatch |
| 429 | `API_ERROR` | Rate limit exceeded |

**Notes**

- Legacy users with weakly-hashed passwords are silently re-hashed on first successful login.

---

## Admins — `/admins`

All routes require `Authorization: Bearer <token>` with role `admin`.

### POST /admins

Create a new admin account.

**Request body**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `adminName` | string | yes | min 1 |
| `email` | string | yes | valid email, unique |
| `phone` | string | yes | min 1 |
| `password` | string | yes | min 6 |

**Example request**

```bash
curl -X POST "https://api.example.com/admins" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "adminName": "Admin User",
    "email": "admin@example.com",
    "phone": "+15555550100",
    "password": "ChangeMe123"
  }'
```

```ts
const { data } = await axios.post(
  "https://api.example.com/admins",
  { adminName: "Admin User", email: "admin@example.com", phone: "+15555550100", password: "ChangeMe123" },
  { headers: { Authorization: `Bearer ${token}` } }
);
```

**Success response (201):** `{ "message": "Admin created", "admin": { /* admin doc */ } }`

**Errors:** 400 `VALIDATION_ERROR`, 401 `UNAUTHORIZED`, 403 `FORBIDDEN`, 409 `CONFLICT` (email exists).

### GET /admins

List all admins.

**Example request**

```bash
curl "https://api.example.com/admins" -H "Authorization: Bearer $TOKEN"
```

```ts
const { data } = await axios.get("https://api.example.com/admins", {
  headers: { Authorization: `Bearer ${token}` },
});
```

**Success response (200):** `{ "admins": [{ "_id": "...", "adminName": "...", "email": "...", "phone": "..." }] }`

### GET /admins/:id

Get one admin by ID.

**Path params:** `id` — admin ObjectId.

**Example request**

```bash
curl "https://api.example.com/admins/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

```ts
const { data } = await axios.get(
  `https://api.example.com/admins/${id}`,
  { headers: { Authorization: `Bearer ${token}` } }
);
```

**Success (200):** `{ "admin": { /* ... */ } }` — **Errors:** 400 invalid id, 404 not found.

### PATCH /admins/:id

Update an admin. All body fields optional; at least one required.

**Request body:** any of `adminName`, `email`, `phone`, `password` (same constraints as POST).

**Example request**

```bash
curl -X PATCH "https://api.example.com/admins/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "phone": "+15555550199" }'
```

```ts
await axios.patch(
  `https://api.example.com/admins/${id}`,
  { phone: "+15555550199" },
  { headers: { Authorization: `Bearer ${token}` } }
);
```

**Success (200):** `{ "message": "Admin updated", "admin": { /* ... */ } }` — **Errors:** 400, 404, 409.

### DELETE /admins/:id

Delete an admin.

```bash
curl -X DELETE "https://api.example.com/admins/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

```ts
await axios.delete(`https://api.example.com/admins/${id}`, {
  headers: { Authorization: `Bearer ${token}` },
});
```

**Success (200):** `{ "message": "Admin deleted" }`

---

## Users — `/users`

All routes require authentication. Role requirements vary per endpoint.

### POST /users

Create a user (admin-managed). Use `/auth/signup` for self-service signup.

**Auth:** Bearer (`admin`)

**Request body**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `username`, `phone`, `email`, `password`, `age`, `gender` | — | yes | Same as `/auth/signup` |
| `healthGoals` | string[] | no | default `[]` |
| `dateOfBirth` | string/Date | no | ISO date |
| `emergencyContact` | string | no | |
| `address` | string | no | |
| `onboarded` | boolean | no | default `false` |

**Example request**

```bash
curl -X POST "https://api.example.com/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "jane.doe",
    "phone": "+15555550123",
    "email": "user@example.com",
    "age": 29,
    "gender": "Female",
    "password": "Sup3rSecret!"
  }'
```

```ts
const { data } = await axios.post(
  "https://api.example.com/users",
  { username: "jane.doe", phone: "+15555550123", email: "user@example.com", age: 29, gender: "Female", password: "Sup3rSecret!" },
  { headers: { Authorization: `Bearer ${token}` } }
);
```

**Success (201):** `{ "message": "User created", "user": { /* ... */ } }` — **Errors:** 400, 409.

### GET /users

List users with search, filter, pagination.

**Auth:** Bearer (`admin`, `doctor`)

**Query params**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `search` | string | no | — | Searches `username`, `email`, `phone` |
| `status` | enum | no | `all` | `all` \| `pending` \| `booked` |
| `page` | number | no | 1 | min 1 |
| `limit` | number | no | 20 | 1–100 |
| `sort` | enum | no | `createdAt` | `username` \| `email` \| `phone` \| `createdAt` |
| `order` | enum | no | `desc` | `asc` \| `desc` |

**Example request**

```bash
curl "https://api.example.com/users?search=jane&status=booked&page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

```ts
const { data } = await axios.get("https://api.example.com/users", {
  params: { search: "jane", status: "booked", page: 1, limit: 20 },
  headers: { Authorization: `Bearer ${token}` },
});
```

**Success (200)**

```json
{
  "users": [
    {
      "_id": "5f1a2b3c4d5e6f7a8b9c0d1e",
      "username": "jane.doe",
      "email": "user@example.com",
      "phone": "+15555550123",
      "age": 29,
      "gender": "Female",
      "onboardingStep": "COMPLETED",
      "bookingStatus": "booked",
      "healthMarkers": { "weight": 65, "height": 168, "gender": "Female", "activityLevel": "Moderate" },
      "healthGoals": ["weight loss"]
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 137, "totalPages": 7 }
}
```

### GET /users/me

Get the authenticated user's profile.

**Auth:** Bearer (`user`)

```bash
curl "https://api.example.com/users/me" -H "Authorization: Bearer $TOKEN"
```

```ts
const { data } = await axios.get("https://api.example.com/users/me", {
  headers: { Authorization: `Bearer ${token}` },
});
```

**Success (200):** `{ "user": { /* full user doc */ } }`

### GET /users/me/reports

List the authenticated user's HPOD reports (summary form).

**Auth:** Bearer (`user`)

```bash
curl "https://api.example.com/users/me/reports" -H "Authorization: Bearer $TOKEN"
```

**Success (200)**

```json
{
  "reports": [
    {
      "id": "5f1a2b3c4d5e6f7a8b9c0d1e",
      "title": "HPOD Wellness Report",
      "summary": "Markers within healthy range overall.",
      "suggestions": [],
      "recommendations": [],
      "insights": [],
      "generated_date": "2026-05-22T08:00:00.000Z",
      "pdf_url": null
    }
  ]
}
```

### GET /users/me/hpod-metrics

Return the authenticated user's HPOD metric history.

**Auth:** Bearer (`user`)

```bash
curl "https://api.example.com/users/me/hpod-metrics" -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "history": [ /* HpodMetric documents */ ] }`

### GET /users/me/reports/:id/pdf

Fetch a report PDF. Currently a stub.

**Auth:** Bearer (`user`)

**Path params:** `id` — report ObjectId.

```bash
curl "https://api.example.com/users/me/reports/5f1a2b3c4d5e6f7a8b9c0d1e/pdf" \
  -H "Authorization: Bearer $TOKEN"
```

**Response (501):**

```json
{
  "error": "Report PDF endpoint is not available yet",
  "code": "NOT_IMPLEMENTED",
  "details": { "id": "5f1a2b3c4d5e6f7a8b9c0d1e", "hasPdf": false }
}
```

### PATCH /users/me/password

Change the authenticated user's password.

**Auth:** Bearer (`user`)

**Request body**

| Field | Type | Constraints |
|---|---|---|
| `currentPassword` | string | min 1 |
| `newPassword` | string | min 8, letter + number, must differ from current |

```bash
curl -X PATCH "https://api.example.com/users/me/password" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "currentPassword": "Sup3rSecret!", "newPassword": "NewSecret9!" }'
```

```ts
await axios.patch(
  "https://api.example.com/users/me/password",
  { currentPassword: "Sup3rSecret!", newPassword: "NewSecret9!" },
  { headers: { Authorization: `Bearer ${token}` } }
);
```

**Success (200):** `{ "message": "Password updated successfully" }` — **Errors:** 400 validation, 401 wrong current password.

### GET /users/:id

Get any user (admin/doctor).

**Auth:** Bearer (`admin`, `doctor`)

**Path params:** `id` — user ObjectId.

```bash
curl "https://api.example.com/users/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "user": { /* ... */ } }`

### PATCH /users/:id/onboard

Mark a user as onboarded (legacy single-step flow). Sets `onboarded: true`.

**Auth:** Bearer (`admin`, `user` — users can only onboard themselves)

**Path params:** `id` — user ObjectId.

**Request body:** any combination of profile fields (same as `POST /users`, excluding `onboarded`).

```bash
curl -X PATCH "https://api.example.com/users/5f1a2b3c4d5e6f7a8b9c0d1e/onboard" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "address": "221B Baker Street, London" }'
```

**Success (200):** `{ "message": "User onboarded", "user": { /* onboarded: true */ } }`

> Prefer the granular [`/onboarding/*`](#onboarding--onboarding) endpoints for new clients.

### PATCH /users/:id

Update a user.

**Auth:** Bearer (`admin`, `user` — users can only update themselves; password forbidden for `user` role on this endpoint)

```bash
curl -X PATCH "https://api.example.com/users/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "phone": "+15555550199" }'
```

**Success (200):** `{ "user": { /* ... */ } }`

### DELETE /users/:id

Delete a user.

**Auth:** Bearer (`admin`)

```bash
curl -X DELETE "https://api.example.com/users/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "message": "User deleted" }`

---

## Onboarding — `/onboarding`

Multi-step onboarding workflow. The backend is the single source of truth — steps must be completed in the order shown in [Appendix A](#appendix-a-onboarding-step-order).

All routes require `Authorization: Bearer <token>` with role `user`.

Common step-order errors:

| Status | Code | When |
|---|---|---|
| 403 | `STEP_NOT_ALLOWED` | Submitting a step out of order |
| 409 | `ALREADY_COMPLETED` | Onboarding has already been finalized |
| 400 | `MISSING_STEPS` | `POST /onboarding/complete` called before all steps done |

### GET /onboarding/status

Get the current step, completed steps, and per-step flags.

```bash
curl "https://api.example.com/onboarding/status" -H "Authorization: Bearer $TOKEN"
```

**Success (200)**

```json
{
  "currentStep": "HEALTH_GOALS",
  "completedSteps": ["HEALTH_MARKERS"],
  "healthMarkersCompleted": true,
  "healthGoalsCompleted": false,
  "consentCompleted": false,
  "reportsUploaded": false,
  "sportsScientistBooked": false,
  "nutritionistBooked": false,
  "onboardingCompleted": false,
  "startedAt": "2026-05-22T08:00:00.000Z"
}
```

### POST /onboarding/health-markers

Step 1. BMI is computed server-side from `weight / (height/100)^2`.

**Request body**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `weight` | number | yes | > 0 (kg) |
| `height` | number | yes | > 0 (cm) |
| `allergies` | string[] | no | default `[]` |
| `medications` | string[] | no | default `[]` |
| `diseaseHistory` | string[] | no | default `[]` |
| `sleepHours` | number | no | 0–24 |
| `activityLevel` | `ActivityLevel` | no | enum |

```bash
curl -X POST "https://api.example.com/onboarding/health-markers" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "weight": 65, "height": 168, "sleepHours": 7, "activityLevel": "Moderate" }'
```

```ts
await axios.post(
  "https://api.example.com/onboarding/health-markers",
  { weight: 65, height: 168, sleepHours: 7, activityLevel: "Moderate" },
  { headers: { Authorization: `Bearer ${token}` } }
);
```

**Success (201):** `{ "message": "Health markers submitted", "healthMarkers": { /* incl. bmi */ } }`

### POST /onboarding/health-goals

Step 2.

**Request body**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `goals` | string[] | yes | min 1 entry |
| `targetWeight` | number | no | > 0 |
| `timeline` | string | no | |
| `workoutExperience` | `WorkoutExperience` | no | enum |
| `foodPreferences` | string[] | no | default `[]` |

```bash
curl -X POST "https://api.example.com/onboarding/health-goals" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "goals": ["weight loss"], "targetWeight": 60, "workoutExperience": "Beginner" }'
```

**Success (201):** `{ "message": "Health goals submitted", "healthGoals": { /* ... */ } }`

### POST /onboarding/consent

Step 3. Captures the requester IP automatically.

**Request body**

| Field | Type | Required |
|---|---|---|
| `accepted` | literal `true` | yes |
| `signatureUrl` | string | no |

```bash
curl -X POST "https://api.example.com/onboarding/consent" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "accepted": true }'
```

**Success (201):** `{ "message": "Consent submitted", "consentForm": { /* ... */ } }`

### POST /onboarding/reports

Step 4. Multiple reports allowed; call repeatedly.

**Request body**

| Field | Type | Required |
|---|---|---|
| `reportName` | string | yes |
| `reportType` | string | yes |
| `reportUrl` | string | no |

```bash
curl -X POST "https://api.example.com/onboarding/reports" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "reportName": "Blood Panel", "reportType": "lab", "reportUrl": "https://files.example.com/report.pdf" }'
```

**Success (201):** `{ "message": "Report uploaded", "report": { /* ... */ } }`

### POST /onboarding/appointments

Steps 5 & 6. `sports_scientist` must be booked before `nutritionist`.

**Request body**

| Field | Type | Required |
|---|---|---|
| `expertType` | `ExpertType` | yes |
| `appointmentDate` | ISO date | no |
| `meetingLink` | string | no |
| `calComBookingId` | string | no |

```bash
curl -X POST "https://api.example.com/onboarding/appointments" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "expertType": "sports_scientist", "appointmentDate": "2026-06-01T10:00:00.000Z" }'
```

**Success (201):** `{ "message": "sports_scientist appointment booked", "appointment": { /* ... */ } }`

### POST /onboarding/complete

Finalize onboarding. Validates all prior steps. Sets both `user.onboarded = true` and `onboardingStatus.onboardingCompleted = true`.

```bash
curl -X POST "https://api.example.com/onboarding/complete" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
```

**Success (200):** `{ "message": "Onboarding completed", "completedAt": "2026-05-22T12:00:00.000Z" }`

**Errors:** 400 `MISSING_STEPS`, 409 `ALREADY_COMPLETED`.

---

## Doctors — `/doctors`

### GET /doctors/public

Public listing of doctors (no auth) with minimal fields.

```bash
curl "https://api.example.com/doctors/public"
```

```ts
const { data } = await axios.get("https://api.example.com/doctors/public");
```

**Success (200)**

```json
{ "doctors": [ { "_id": "...", "name": "Dr. Jane Doe", "description": "...", "specialities": ["Cardiology"] } ] }
```

### GET /doctors/public/:id

Public single doctor.

```bash
curl "https://api.example.com/doctors/public/5f1a2b3c4d5e6f7a8b9c0d1e"
```

**Success (200):** `{ "doctor": { /* limited fields */ } }`

### POST /doctors

Create a doctor.

**Auth:** Bearer (`admin`)

**Request body**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `doctorName` | string | yes | min 1 |
| `email` | string | yes | valid, unique |
| `phone` | string | yes | min 1 |
| `password` | string | yes | min 6 |
| `description` | string | no | default `""` |
| `specialities` | string[] | no | default `[]` |

```bash
curl -X POST "https://api.example.com/doctors" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "doctorName": "Dr. Jane Doe", "email": "doctor@example.com", "phone": "+15555550150", "password": "ChangeMe123", "specialities": ["Cardiology"] }'
```

**Success (201):** `{ "message": "Doctor created", "doctor": { /* ... */ } }`

### GET /doctors

List all doctors (full fields).

**Auth:** Bearer (`admin`)

```bash
curl "https://api.example.com/doctors" -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "doctors": [ /* ... */ ] }`

### GET /doctors/:id

**Auth:** Bearer (`doctor`, `trainer`)

```bash
curl "https://api.example.com/doctors/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "doctor": { /* ... */ } }`

### PATCH /doctors/:id

**Auth:** Bearer (`doctor`, `trainer`)

**Request body:** any of `doctorName`, `email`, `phone`, `password`, `description`, `specialities`.

```bash
curl -X PATCH "https://api.example.com/doctors/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "description": "Updated bio." }'
```

**Success (200):** `{ "message": "Doctor updated", "doctor": { /* ... */ } }`

### DELETE /doctors/:id

**Auth:** Bearer (`admin`)

```bash
curl -X DELETE "https://api.example.com/doctors/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "message": "Doctor deleted" }`

---

## Trainers — `/trainers`

Identical shape to `/doctors`. Substitute `trainerName` for `doctorName` and `trainer` for `doctor` everywhere.

| Method | Path | Auth |
|---|---|---|
| GET | `/trainers/public` | Public |
| GET | `/trainers/public/:id` | Public |
| POST | `/trainers` | `admin` |
| GET | `/trainers` | `admin` |
| GET | `/trainers/:id` | `trainer`, `doctor` |
| PATCH | `/trainers/:id` | `trainer`, `doctor` |
| DELETE | `/trainers/:id` | `admin` |

**Example: create trainer**

```bash
curl -X POST "https://api.example.com/trainers" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "trainerName": "Alex Coach", "email": "trainer@example.com", "phone": "+15555550160", "password": "ChangeMe123", "specialities": ["Strength"] }'
```

```ts
await axios.post(
  "https://api.example.com/trainers",
  { trainerName: "Alex Coach", email: "trainer@example.com", phone: "+15555550160", password: "ChangeMe123", specialities: ["Strength"] },
  { headers: { Authorization: `Bearer ${token}` } }
);
```

Bodies, responses, and errors mirror the doctor section above.

---

## Slots — `/slots`

All routes require authentication.

### GET /slots

**Auth:** Bearer (`admin`, `doctor`, `trainer`, `user`)

```bash
curl "https://api.example.com/slots" -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "slots": [ /* ... */ ] }`

### GET /slots/:id

**Auth:** Bearer (`admin`, `doctor`, `trainer`, `user`)

```bash
curl "https://api.example.com/slots/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "slot": { /* ... */ } }`

### POST /slots

Create a slot template or one-off slot.

**Auth:** Bearer (`admin`)

**Request body**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `startTime` | string | yes | min 1 |
| `endTime` | string | yes | min 1 |
| `date` | ISO date | no | required when not daily |
| `isDaily` | boolean | no | |
| `capacity` | number | no | > 0, default 1 |
| `remainingCapacity` | number | no | ≥ 0, ≤ capacity |
| `isBooked` | boolean | no | |

```bash
curl -X POST "https://api.example.com/slots" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "startTime": "09:00", "endTime": "09:30", "date": "2026-06-01", "capacity": 4 }'
```

```ts
await axios.post(
  "https://api.example.com/slots",
  { startTime: "09:00", endTime: "09:30", date: "2026-06-01", capacity: 4 },
  { headers: { Authorization: `Bearer ${token}` } }
);
```

**Success (201):** `{ "message": "Slot created", "slot": { /* ... */ } }`

### PATCH /slots/:id

**Auth:** Bearer (`admin`) — partial body, at least one field.

```bash
curl -X PATCH "https://api.example.com/slots/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "capacity": 6 }'
```

**Success (200):** `{ "message": "Slot updated", "slot": { /* ... */ } }`

### DELETE /slots/:id

**Auth:** Bearer (`admin`)

```bash
curl -X DELETE "https://api.example.com/slots/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "message": "Slot deleted" }`

---

## Services — `/services`

### GET /services

**Auth:** Bearer (`admin`, `doctor`, `trainer`, `user`)

```bash
curl "https://api.example.com/services" -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "services": [ /* ... */ ] }`

### GET /services/:id

**Auth:** Bearer (`admin`, `doctor`, `trainer`, `user`)

```bash
curl "https://api.example.com/services/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "service": { /* ... */ } }`

### POST /services

**Auth:** Bearer (`admin`)

**Request body**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `serviceName` | string | yes | min 1 |
| `serviceTime` | number | yes | > 0 (minutes) |
| `creditCost` | number | no | positive integer, default 1 |
| `description` | string | yes | min 1 |
| `tags` | string[] | no | default `[]` |
| `slots` | string[] (ObjectIds) | yes | min 1 |

```bash
curl -X POST "https://api.example.com/services" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "serviceName": "Recovery Massage",
    "serviceTime": 45,
    "creditCost": 2,
    "description": "45-minute deep tissue session",
    "slots": ["5f1a2b3c4d5e6f7a8b9c0d1e"]
  }'
```

```ts
await axios.post(
  "https://api.example.com/services",
  { serviceName: "Recovery Massage", serviceTime: 45, creditCost: 2, description: "45-minute deep tissue session", slots: [slotId] },
  { headers: { Authorization: `Bearer ${token}` } }
);
```

**Success (201):** `{ "message": "Service created", "service": { /* ... */ } }`

### PATCH /services/:id

**Auth:** Bearer (`admin`) — partial body, at least one field.

```bash
curl -X PATCH "https://api.example.com/services/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "creditCost": 3 }'
```

**Success (200):** `{ "message": "Service updated", "service": { /* ... */ } }`

### DELETE /services/:id

**Auth:** Bearer (`admin`)

```bash
curl -X DELETE "https://api.example.com/services/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "message": "Service deleted" }`

---

## Therapies — `/therapies`

Mirrors `/services` with therapy-specific fields. Two public endpoints + five protected.

| Method | Path | Auth |
|---|---|---|
| GET | `/therapies/public` | Public |
| GET | `/therapies/public/:id` | Public |
| GET | `/therapies` | `admin`, `doctor`, `trainer`, `user` |
| GET | `/therapies/:id` | `admin`, `doctor`, `trainer`, `user` |
| POST | `/therapies` | `admin` |
| PATCH | `/therapies/:id` | `admin` |
| DELETE | `/therapies/:id` | `admin` |

**Request body** (POST / PATCH partial): `therapyName` (string), `therapyTime` (number > 0), `creditCost` (positive int, default 1), `description` (string), `tags` (string[]), `slots` (ObjectId[] — min 1 on POST).

**Example: list public**

```bash
curl "https://api.example.com/therapies/public"
```

```ts
const { data } = await axios.get("https://api.example.com/therapies/public");
```

**Success (200):** `{ "therapies": [ { "_id", "therapyName", "therapyTime", "description", "tags" } ] }`

---

## Bookings — `/bookings`

Service / therapy bookings. Most actions trigger credit-ledger updates (consumption on create, refund on cancel).

### POST /bookings

Book a service. Users book for themselves; admins may book on behalf of any user via `userId`.

**Auth:** Bearer (`admin`, `user`)

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `bookingDate` | ISO date | yes | |
| `userId` | string | conditional | required when admin books for another user |
| `slotId` | string | yes | |
| `serviceId` | string | yes | |
| `reportId` | string | no | |
| `bypassCredits` | boolean | no | admin-only; default `false` |

```bash
curl -X POST "https://api.example.com/bookings" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "bookingDate": "2026-06-01T09:00:00.000Z",
    "slotId": "5f1a2b3c4d5e6f7a8b9c0d1e",
    "serviceId": "5f1a2b3c4d5e6f7a8b9c0d2f"
  }'
```

```ts
await axios.post(
  "https://api.example.com/bookings",
  { bookingDate: "2026-06-01T09:00:00.000Z", slotId, serviceId },
  { headers: { Authorization: `Bearer ${token}` } }
);
```

**Success (201)**

```json
{
  "message": "Booking created",
  "booking": { "_id": "...", "user": "...", "slot": "...", "service": "...", "status": 0 },
  "credits": { "consumed": 2, "bypassed": false }
}
```

**Errors:** 400 validation, 401, 403, 404 (slot/service missing), 409 (slot full, insufficient credits).

### GET /bookings

**Auth:** Bearer (`admin`)

```bash
curl "https://api.example.com/bookings" -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "bookings": [ /* ... */ ] }`

### GET /bookings/me

**Auth:** Bearer (`user`)

```bash
curl "https://api.example.com/bookings/me" -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "bookings": [ /* user's own */ ] }`

### GET /bookings/:id

**Auth:** Bearer (`admin`)

```bash
curl "https://api.example.com/bookings/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "booking": { /* ... */ } }`

### PATCH /bookings/:id

Reschedule a booking. Users may only update their own.

**Auth:** Bearer (`admin`, `user`)

**Request body:** any of `bookingDate`, `slotId`, `serviceId`, `reportId`.

```bash
curl -X PATCH "https://api.example.com/bookings/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "bookingDate": "2026-06-02T09:00:00.000Z" }'
```

**Success (200):** `{ "message": "Booking updated", "booking": { /* ... */ } }`

### DELETE /bookings/:id

**Auth:** Bearer (`admin`). Refunds credits in the same transaction.

```bash
curl -X DELETE "https://api.example.com/bookings/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "message": "Booking deleted" }`

### PATCH /bookings/:id/status

Change booking status (e.g., mark `Attended`, `Cancelled`). Refund triggered on `Cancelled`.

**Auth:** Bearer (`admin`)

**Request body**

| Field | Type | Required | Values |
|---|---|---|---|
| `status` | number | yes | `BookingStatus` enum index (0–4) |

```bash
curl -X PATCH "https://api.example.com/bookings/5f1a2b3c4d5e6f7a8b9c0d1e/status" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "status": 2 }'
```

**Success (200):** `{ "message": "Booking status updated", "booking": { /* ... */ }, "credits": { "refunded": 2 } }`

---

## Appointments — `/appointments`

Doctor appointments. Mirrors `/bookings` with a `doctorId` field and doctor-specific endpoints.

### POST /appointments

**Auth:** Bearer (`admin`)

**Request body**

| Field | Type | Required |
|---|---|---|
| `appointmentDate` | ISO date | yes |
| `userId` | string | yes |
| `slotId` | string | yes |
| `doctorId` | string | yes |
| `serviceId` | string | no |
| `reportId` | string | no |
| `bypassCredits` | boolean | no |

```bash
curl -X POST "https://api.example.com/appointments" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "appointmentDate": "2026-06-01T10:00:00.000Z",
    "userId": "5f1a2b3c4d5e6f7a8b9c0d1e",
    "slotId": "5f1a2b3c4d5e6f7a8b9c0d2f",
    "doctorId": "5f1a2b3c4d5e6f7a8b9c0d3a"
  }'
```

```ts
await axios.post(
  "https://api.example.com/appointments",
  { appointmentDate, userId, slotId, doctorId },
  { headers: { Authorization: `Bearer ${token}` } }
);
```

**Success (201):** `{ "message": "Appointment created", "appointment": { /* ... */ }, "credits": { "consumed": 1, "bypassed": false } }`

### GET /appointments

**Auth:** Bearer (`admin`) — list all.

```bash
curl "https://api.example.com/appointments" -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "appointments": [ /* ... */ ] }`

### GET /appointments/me

**Auth:** Bearer (`doctor`) — appointments assigned to the requesting doctor.

```bash
curl "https://api.example.com/appointments/me" -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "appointments": [ /* ... */ ] }`

### GET /appointments/:id

**Auth:** Bearer (`admin`)

```bash
curl "https://api.example.com/appointments/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "appointment": { /* ... */ } }`

### PATCH /appointments/:id

**Auth:** Bearer (`admin`, `user` — users may update their own only).

**Request body:** any of `appointmentDate`, `slotId`, `doctorId`, `serviceId`, `reportId`.

```bash
curl -X PATCH "https://api.example.com/appointments/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "appointmentDate": "2026-06-02T10:00:00.000Z" }'
```

**Success (200):** `{ "message": "Appointment updated", "appointment": { /* ... */ } }`

### DELETE /appointments/:id

**Auth:** Bearer (`admin`)

```bash
curl -X DELETE "https://api.example.com/appointments/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "message": "Appointment deleted" }`

### PATCH /appointments/:id/status

**Auth:** Bearer (`admin`, `doctor` — doctors can only update their own).

**Request body:** `{ status: number }` (`BookingStatus` index).

```bash
curl -X PATCH "https://api.example.com/appointments/5f1a2b3c4d5e6f7a8b9c0d1e/status" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "status": 3 }'
```

**Success (200):** `{ "message": "Appointment status updated", "appointment": { /* ... */ }, "credits": { "refunded": 0 } }`

---

## Credits — `/credits`

Credit ledger. Backed by Membership credit pools + a `CreditTransaction` audit log.

### GET /credits/me/balance

**Auth:** Bearer (`user`)

```bash
curl "https://api.example.com/credits/me/balance" -H "Authorization: Bearer $TOKEN"
```

**Success (200)**

```json
{
  "userId": "5f1a2b3c4d5e6f7a8b9c0d1e",
  "totalCredits": 24,
  "availableCredits": 18,
  "membershipDetails": [ { "membershipId": "...", "creditsRemaining": 18, "endDate": "2026-12-31" } ]
}
```

### GET /credits/me/history

**Auth:** Bearer (`user`)

**Query params**

| Name | Type | Default | Constraints |
|---|---|---|---|
| `limit` | number | 50 | 1–200 |
| `sourceType` | `CreditTransactionSource` | — | `Booking` \| `Appointment` \| `Admin` |

```bash
curl "https://api.example.com/credits/me/history?limit=20&sourceType=Booking" \
  -H "Authorization: Bearer $TOKEN"
```

```ts
const { data } = await axios.get("https://api.example.com/credits/me/history", {
  params: { limit: 20, sourceType: "Booking" },
  headers: { Authorization: `Bearer ${token}` },
});
```

**Success (200):** `{ "userId": "...", "transactions": [ /* CreditTransaction */ ] }`

### GET /credits/users/:userId/balance

**Auth:** Bearer (`admin`) — admin view of any user's balance.

```bash
curl "https://api.example.com/credits/users/5f1a2b3c4d5e6f7a8b9c0d1e/balance" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** identical shape to `/credits/me/balance`.

### GET /credits/users/:userId/history

**Auth:** Bearer (`admin`)

Same query params as `/credits/me/history`.

```bash
curl "https://api.example.com/credits/users/5f1a2b3c4d5e6f7a8b9c0d1e/history?limit=50" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "userId": "...", "transactions": [ /* ... */ ] }`

### POST /credits/users/:userId/topup

Admin top-up. Adds credits to a specific membership pool (or creates one if `membershipId` omitted — implementation may vary).

**Auth:** Bearer (`admin`)

**Request body**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `amount` | number | yes | > 0 |
| `membershipId` | string | no | target membership |
| `reason` | string | no | min 1 |

```bash
curl -X POST "https://api.example.com/credits/users/5f1a2b3c4d5e6f7a8b9c0d1e/topup" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "amount": 10, "reason": "Goodwill credit" }'
```

```ts
await axios.post(
  `https://api.example.com/credits/users/${userId}/topup`,
  { amount: 10, reason: "Goodwill credit" },
  { headers: { Authorization: `Bearer ${token}` } }
);
```

**Success (200):** `{ "message": "Top-up successful", "membershipId": "...", "creditsRemaining": 28 }`

---

## Memberships — `/memberships`

### POST /memberships

**Auth:** Bearer (`admin`)

**Request body**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `userId` | string | no | required when admin assigns to a specific user |
| `planName` | string | yes | min 1 |
| `creditsIncluded` | number | no | ≥ 0 integer, default 0 |
| `status` | `MembershipStatus` | no | |
| `price` | number | yes | ≥ 0 |
| `currency` | string | no | default `"USD"` |
| `startDate` | ISO date string | yes | min 1 |
| `endDate` | ISO date string | no | |
| `features` | string[] | no | default `[]` |
| `notes` | string | no | |

```bash
curl -X POST "https://api.example.com/memberships" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "userId": "5f1a2b3c4d5e6f7a8b9c0d1e",
    "planName": "Pro Monthly",
    "creditsIncluded": 20,
    "price": 49.99,
    "startDate": "2026-06-01",
    "endDate": "2026-07-01"
  }'
```

**Success (201):** `{ "message": "Membership created", "membership": { /* ... */ } }`

### GET /memberships

**Auth:** Bearer (`admin`)

```bash
curl "https://api.example.com/memberships" -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "memberships": [ /* ... */ ] }`

### GET /memberships/me

**Auth:** Bearer (`user`)

```bash
curl "https://api.example.com/memberships/me" -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "memberships": [ /* user's own */ ] }`

### GET /memberships/:id

**Auth:** Bearer (`admin`)

```bash
curl "https://api.example.com/memberships/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "membership": { /* ... */ } }`

### PATCH /memberships/:id

**Auth:** Bearer (`admin`) — partial body, at least one field.

```bash
curl -X PATCH "https://api.example.com/memberships/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "status": "Paused" }'
```

**Success (200):** `{ "message": "Membership updated", "membership": { /* ... */ } }`

### DELETE /memberships/:id

**Auth:** Bearer (`admin`)

```bash
curl -X DELETE "https://api.example.com/memberships/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "message": "Membership deleted" }`

---

## Schedules — `/schedules`

Per-user daily todo list. Users may manage their own schedule; staff (`doctor`, `trainer`, `admin`) may manage any.

### GET /schedules/my-schedule

**Auth:** Bearer (any authenticated role)

```bash
curl "https://api.example.com/schedules/my-schedule" -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "message": "Schedule fetched", "schedule": { /* populated user & todos */ } }`

### POST /schedules

**Auth:** Bearer (any authenticated role; user may only target themselves)

**Request body**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `userId` | string | yes | ObjectId |
| `scheduledDate` | ISO date | yes | |
| `status` | `TodoStatus` | no | default `Todo` (0) |
| `todoIds` | string[] | no | default `[]` |

```bash
curl -X POST "https://api.example.com/schedules" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "userId": "5f1a2b3c4d5e6f7a8b9c0d1e", "scheduledDate": "2026-05-23T00:00:00.000Z", "todoIds": [] }'
```

**Success (201):** `{ "message": "Schedule created", "schedule": { /* ... */ } }`

### GET /schedules/:userId

**Auth:** Bearer (any authenticated role)

```bash
curl "https://api.example.com/schedules/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "message": "Schedule fetched", "schedule": { /* ... */ } }`

### PATCH /schedules/:userId

**Auth:** Bearer (any authenticated role)

**Request body:** any of `scheduledDate`, `status`, `todoIds`.

```bash
curl -X PATCH "https://api.example.com/schedules/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "status": 1 }'
```

**Success (200):** `{ "message": "Schedule updated", "schedule": { /* ... */ } }`

### PATCH /schedules/:userId/reschedule

**Auth:** Bearer (any authenticated role)

**Request body**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `newScheduledDate` | ISO date | yes | within next 7 days |

```bash
curl -X PATCH "https://api.example.com/schedules/5f1a2b3c4d5e6f7a8b9c0d1e/reschedule" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "newScheduledDate": "2026-05-25T00:00:00.000Z" }'
```

**Success (200):** `{ "message": "Schedule rescheduled", "schedule": { /* ... */ } }`

### DELETE /schedules/:userId

**Auth:** Bearer (`admin`)

```bash
curl -X DELETE "https://api.example.com/schedules/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "message": "Schedule deleted" }`

---

## Exercises — `/exercises`

Exercise library. Both system-defined and user-defined exercises.

### GET /exercises

List exercises with filters.

**Auth:** Bearer (`admin`, `user`)

**Query params**

| Name | Type | Default | Notes |
|---|---|---|---|
| `muscleGroup` | `MuscleGroup` | — | |
| `difficulty` | `ExerciseDifficulty` | — | |
| `equipment` | string | — | |
| `search` | string | — | text search on `name` |
| `isSystem` | boolean | — | |
| `page` | number | 1 | |
| `limit` | number | 50 | |

```bash
curl "https://api.example.com/exercises?muscleGroup=Chest&difficulty=Beginner&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

```ts
const { data } = await axios.get("https://api.example.com/exercises", {
  params: { muscleGroup: "Chest", difficulty: "Beginner", limit: 10 },
  headers: { Authorization: `Bearer ${token}` },
});
```

**Success (200):** `{ "exercises": [ /* ... */ ], "pagination": { /* ... */ } }`

### POST /exercises

**Auth:** Bearer (`admin`, `user`)

**Request body**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `name` | string | yes | 1–100 |
| `muscleGroup` | `MuscleGroup` | yes | |
| `targetedMuscles` | string[] | no | max 10 |
| `difficulty` | `ExerciseDifficulty` | yes | |
| `equipment` | string | no | max 200 |
| `instructions` | string | no | |
| `commonMistakes` | string[] | no | max 20 |
| `tips` | string[] | no | max 20 |
| `caloriesPerSet` | number | no | 0–1000 |
| `imageUrl` | string (url) | no | |

```bash
curl -X POST "https://api.example.com/exercises" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "name": "Bench Press", "muscleGroup": "Chest", "difficulty": "Intermediate", "equipment": "barbell" }'
```

**Success (201):** the created `Exercise` document.

### GET /exercises/:id

**Auth:** Bearer (`admin`, `user`)

```bash
curl "https://api.example.com/exercises/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** the `Exercise` document.

### PUT /exercises/:id

**Auth:** Bearer (`admin`, `user`)

Same body as POST; at least one field required.

```bash
curl -X PUT "https://api.example.com/exercises/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "difficulty": "Advanced" }'
```

**Success (200):** the updated `Exercise` document.

### DELETE /exercises/:id

**Auth:** Bearer (`admin`, `user`)

```bash
curl -X DELETE "https://api.example.com/exercises/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "message": "Exercise deleted" }`

---

## Workouts — `/workouts`

Workout sessions with nested exercises and set logs. All routes require `user` role unless noted.

### GET /workouts/today

Returns today's active session (or creates an empty one if implementation dictates).

```bash
curl "https://api.example.com/workouts/today" -H "Authorization: Bearer $TOKEN"
```

**Success (200):** full session detail (see structure below).

### GET /workouts/me

List sessions for the authenticated user.

**Query params:** `page` (default 1), `limit` (default 20), `status` (`WorkoutSessionStatus`).

```bash
curl "https://api.example.com/workouts/me?status=Completed&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "sessions": [ /* summary */ ], "pagination": { /* ... */ } }`

### GET /workouts/me/stats

```bash
curl "https://api.example.com/workouts/me/stats" -H "Authorization: Bearer $TOKEN"
```

**Success (200)**

```json
{
  "weeklyWorkouts": 4,
  "totalSetsThisWeek": 52,
  "caloriesBurnedWeek": 1450,
  "consistencyScore": 86,
  "currentStreak": 3,
  "totalVolumeKg": 9120,
  "personalRecords": []
}
```

### GET /workouts/me/history

**Query params:** `from`, `to` (ISO dates), `page`, `limit`.

```bash
curl "https://api.example.com/workouts/me/history?from=2026-05-01&to=2026-05-22" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "workouts": [ /* summary */ ], "pagination": { /* ... */ } }`

### POST /workouts

Create a new session.

**Request body**

| Field | Type | Required |
|---|---|---|
| `date` | ISO date | no |
| `notes` | string | no |
| `exercises` | object[] | no |
| `planId` | ObjectId | no |

```bash
curl -X POST "https://api.example.com/workouts" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "date": "2026-05-22", "notes": "Push day" }'
```

```ts
const { data } = await axios.post(
  "https://api.example.com/workouts",
  { date: "2026-05-22", notes: "Push day" },
  { headers: { Authorization: `Bearer ${token}` } }
);
```

**Success (201):** full session detail.

### GET /workouts/:id

```bash
curl "https://api.example.com/workouts/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200)**

```json
{
  "_id": "5f1a2b3c4d5e6f7a8b9c0d1e",
  "userId": "5f1a2b3c4d5e6f7a8b9c0d2f",
  "date": "2026-05-22T00:00:00.000Z",
  "status": "Active",
  "startedAt": "2026-05-22T07:00:00.000Z",
  "completedAt": null,
  "notes": "Push day",
  "exercises": [
    {
      "_id": "...", "exerciseId": "...", "orderIndex": 0,
      "targetSets": 4, "targetReps": 8, "targetWeightKg": 60, "restSeconds": 90,
      "isCompleted": false,
      "exercise": { "name": "Bench Press", "muscleGroup": "Chest", "difficulty": "Intermediate" },
      "sets": []
    }
  ]
}
```

### PATCH /workouts/:id

**Request body:** any of `status` (`Active` | `Completed`), `notes`.

```bash
curl -X PATCH "https://api.example.com/workouts/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "status": "Completed" }'
```

**Success (200):** updated session.

### DELETE /workouts/:id

```bash
curl -X DELETE "https://api.example.com/workouts/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "message": "Workout session deleted" }`

### POST /workouts/:sessionId/exercises

Add an exercise to a session.

**Request body**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `exerciseId` | string | yes | |
| `targetSets` | number | yes | 1–50 |
| `targetReps` | number | yes | 1–100 |
| `targetWeightKg` | number | no | 0–999.99 |
| `restSeconds` | number | no | 0–600 |

```bash
curl -X POST "https://api.example.com/workouts/5f1a2b3c4d5e6f7a8b9c0d1e/exercises" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "exerciseId": "5f1a2b3c4d5e6f7a8b9c0d2f", "targetSets": 4, "targetReps": 8, "targetWeightKg": 60 }'
```

**Success (201):** the new `WorkoutExercise`.

### PATCH /workouts/:sessionId/exercises/reorder

**Request body:** `{ order: ["exerciseId1", "exerciseId2", ...] }`.

```bash
curl -X PATCH "https://api.example.com/workouts/5f1a2b3c4d5e6f7a8b9c0d1e/exercises/reorder" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "order": ["5f1a2b3c4d5e6f7a8b9c0d2f", "5f1a2b3c4d5e6f7a8b9c0d3a"] }'
```

**Success (200):** sorted array of `WorkoutExercise`.

### PATCH /workouts/:sessionId/exercises/:id

**Request body:** any of `targetSets`, `targetReps`, `targetWeightKg`, `restSeconds`.

```bash
curl -X PATCH "https://api.example.com/workouts/5f1a2b3c4d5e6f7a8b9c0d1e/exercises/5f1a2b3c4d5e6f7a8b9c0d2f" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "targetSets": 5 }'
```

**Success (200):** updated `WorkoutExercise`.

### DELETE /workouts/:sessionId/exercises/:id

```bash
curl -X DELETE "https://api.example.com/workouts/5f1a2b3c4d5e6f7a8b9c0d1e/exercises/5f1a2b3c4d5e6f7a8b9c0d2f" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "message": "Exercise removed from session" }`

### POST /workouts/:sessionId/exercises/:exerciseId/sets

Log a set.

**Request body**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `actualReps` | number | yes | 1–999 |
| `actualWeightKg` | number | yes | 0–999.99 |
| `rpe` | number | no | 1–10 |
| `isWarmup` | boolean | no | |
| `notes` | string | no | |

```bash
curl -X POST "https://api.example.com/workouts/5f1a2b3c4d5e6f7a8b9c0d1e/exercises/5f1a2b3c4d5e6f7a8b9c0d2f/sets" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "actualReps": 8, "actualWeightKg": 60, "rpe": 7 }'
```

**Success (201):** `{ "set": { /* SetLog */ }, "exerciseCompleted": false, "setsRemaining": 3 }`

### PATCH /workouts/:sessionId/exercises/:exerciseId/sets/:setId

**Request body:** any of `actualReps`, `actualWeightKg`, `rpe`, `isWarmup`, `notes`.

```bash
curl -X PATCH "https://api.example.com/workouts/.../sets/5f1a2b3c4d5e6f7a8b9c0d3a" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "actualReps": 7 }'
```

**Success (200):** updated `SetLog`.

### DELETE /workouts/:sessionId/exercises/:exerciseId/sets/:setId

```bash
curl -X DELETE "https://api.example.com/workouts/.../sets/5f1a2b3c4d5e6f7a8b9c0d3a" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "message": "Set deleted" }`

---

## Workout plans — `/workout-plans`

Trainer/admin-managed workout plans (templates). All routes require auth + role `admin` or `trainer`.

| Method | Path | Description |
|---|---|---|
| GET | `/workout-plans` | List plans |
| POST | `/workout-plans` | Create plan |
| GET | `/workout-plans/:id` | Get plan |
| PATCH | `/workout-plans/:id` | Update plan |
| DELETE | `/workout-plans/:id` | Delete plan |
| POST | `/workout-plans/:id/assign` | Assign plan to users |

**Example: list**

```bash
curl "https://api.example.com/workout-plans" -H "Authorization: Bearer $TOKEN"
```

```ts
const { data } = await axios.get("https://api.example.com/workout-plans", {
  headers: { Authorization: `Bearer ${token}` },
});
```

**Example: assign**

```bash
curl -X POST "https://api.example.com/workout-plans/5f1a2b3c4d5e6f7a8b9c0d1e/assign" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "userIds": ["5f1a2b3c4d5e6f7a8b9c0d2f"] }'
```

> See [src/validators/workout-plan.validator.ts](../src/validators/workout-plan.validator.ts) for the full plan-body schema (uses `PlanGoal`, `PlanStatus`, `SplitType` enums).

---

## Leads — `/leads`

Sales / marketing pipeline. One public capture endpoint, six protected.

### POST /leads/public-capture

Public lead capture from marketing forms. Rate-limited and CAPTCHA-protected (`X-Captcha-Token` header).

**Auth:** Public

**Headers**

| Name | Required | Description |
|---|---|---|
| `X-Captcha-Token` | yes | CAPTCHA token verified server-side |

**Request body** (one of the following identity shapes; all other fields optional):

- **Callback form:** `{ name, phone, email }`
- **Legacy form:** `{ leadName, email }`
- **Fitflix form:** `{ personalDetails: { fullName, emailAddress, ... } }`

Optional groups:

- `personalDetails` *(object)* — `fullName`, `phoneNumber`, `emailAddress`, `age`, `gender`, `city`, `primaryHealthGoal`, `fitnessLevel`, `wellnessInterests`, `notes`
- `assessment` *(object)* — `version` + `answers` (map of question-id to 1–4 score)
- `notes`, `tags[]`, `followUpDate`, `source`
- `website` (honeypot — if present, request silently accepted with 202 and no data written)

```bash
curl -X POST "https://api.example.com/leads/public-capture" \
  -H "Content-Type: application/json" \
  -H "X-Captcha-Token: 03AGdBq..." \
  -d '{
    "personalDetails": {
      "fullName": "Jane Doe",
      "emailAddress": "user@example.com",
      "phoneNumber": "+15555550123",
      "primaryHealthGoal": "weight loss"
    }
  }'
```

```ts
await axios.post(
  "https://api.example.com/leads/public-capture",
  { personalDetails: { fullName: "Jane Doe", emailAddress: "user@example.com", phoneNumber: "+15555550123" } },
  { headers: { "X-Captcha-Token": captchaToken } }
);
```

**Success (202)**

```json
{
  "message": "Lead captured",
  "leadId": "5f1a2b3c4d5e6f7a8b9c0d1e",
  "healthScore": { "overallScore": 72, "categoryScores": { /* ... */ }, "brand": "Fitflix", "tier": "Bronze" }
}
```

`healthScore` is omitted if the form did not include an `assessment`.

**Errors:** 400 validation, 403 invalid CAPTCHA, 429 rate-limited.

### POST /leads

Create a lead (back office).

**Auth:** Bearer (`admin`, `doctor`, `trainer`)

**Request body**

| Field | Type | Required |
|---|---|---|
| `leadName` | string | yes |
| `email` | email | yes |
| `phone` | string | no |
| `source` | string | no |
| `interestedIn` | string | no |
| `notes` | string | no |
| `tags` | string[] | no |
| `followUpDate` | ISO date | no |
| `ownerId` | ObjectId | no |
| `status` | `LeadStatus` | no |

```bash
curl -X POST "https://api.example.com/leads" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "leadName": "Jane Doe", "email": "user@example.com", "source": "Instagram" }'
```

**Success (201):** `{ "message": "Lead created", "lead": { /* ... */ } }`

### GET /leads

**Auth:** Bearer (`admin`)

```bash
curl "https://api.example.com/leads" -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "leads": [ /* ... */ ] }`

### GET /leads/:id

**Auth:** Bearer (`admin`, `doctor`, `trainer`)

```bash
curl "https://api.example.com/leads/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "lead": { /* ... */ } }`

### PATCH /leads/:id

**Auth:** Bearer (`admin`, `doctor`, `trainer`)

**Request body:** any of POST fields.

```bash
curl -X PATCH "https://api.example.com/leads/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "status": "Warm" }'
```

**Success (200):** `{ "message": "Lead updated", "lead": { /* ... */ } }`

### DELETE /leads/:id

**Auth:** Bearer (`admin`)

```bash
curl -X DELETE "https://api.example.com/leads/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "message": "Lead deleted" }`

### POST /leads/:id/convert

Convert a lead into a `User`. If a user with that email already exists, the existing user is linked (returns 200). Otherwise a new user is created (returns 201).

**Auth:** Bearer (`admin`)

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `username` | string | no | defaults to lead name |
| `phone` | string | yes | |
| `age` | string | yes | numeric string |
| `gender` | enum | yes | `M` \| `F` \| `Other` \| `PreferNotToSay` |
| `healthGoals` | string[] | no | |
| `password` | string | yes | |

```bash
curl -X POST "https://api.example.com/leads/5f1a2b3c4d5e6f7a8b9c0d1e/convert" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "phone": "+15555550123", "age": "29", "gender": "F", "password": "Sup3rSecret!" }'
```

**Success (201 or 200)**

```json
{
  "message": "Lead converted",
  "lead": { /* ... */ },
  "user": { "id": "5f1a2b3c4d5e6f7a8b9c0d1e", "email": "user@example.com", "role": "user" }
}
```

---

## Webhook — `/webhook`

### POST /webhook/email

Gmail Pub/Sub push handler. Decodes the base64 message data to extract `historyId`, fetches new messages from `noreply@hpod.in`, parses the PDF, summarizes with the LLM service, and stores `HpodReport` + `HpodMetric` documents.

**Auth:** Shared webhook secret via header `X-Webhook-Secret`.

**Request body** (Google Pub/Sub push format)

```json
{
  "message": { "data": "<base64-encoded { \"historyId\": \"12345\" }>" }
}
```

```bash
curl -X POST "https://api.example.com/webhook/email" \
  -H "X-Webhook-Secret: $WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{ "message": { "data": "eyJoaXN0b3J5SWQiOiAiMTIzNDUifQ==" } }'
```

**Success (200):** `{ "status": "ok", "processed": 2 }` or `{ "status": "no historyId" }`.

**Errors:** 401 invalid secret, 400 malformed payload.

### GET /webhook/reports

**Auth:** Bearer (`admin`)

```bash
curl "https://api.example.com/webhook/reports" -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "reports": [ /* HpodReport (without rawBody, userId populated) */ ] }`

### GET /webhook/reports/:id

**Auth:** Bearer (`admin`)

```bash
curl "https://api.example.com/webhook/reports/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** full `HpodReport` (userId populated).

### GET /webhook/reports/user/:userId

**Auth:** Bearer (`admin`)

```bash
curl "https://api.example.com/webhook/reports/user/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "reports": [ /* filtered by user */ ] }`

---

## Nutrition — `/nutrition`

The largest section of the API. All routes require authentication. Three role aliases used below:

- **USER** = `user`
- **STAFF** = `nutritionist`, `admin`
- **ADMIN** = `admin`

### Shared schemas (referenced by multiple endpoints)

**`Macros`**

```ts
{ proteinG?: number, carbsG?: number, fatG?: number, fiberG?: number, sugarG?: number }
```

**`MealItem`**

```ts
{ foodId: ObjectId, quantityG: number }
```

**`MealOption`**

```ts
{ title: string, isDefault?: boolean, reasoning?: string, foods: MealItem[] }
```

**`Meal`**

```ts
{
  mealType: MealType,
  name: string,
  timeOfDay?: string,
  notes?: string,
  items: MealItem[],
  options: MealOption[]
}
```

**`Day`**

```ts
{ dayNumber: number /* 1-366 */, meals: Meal[] }
```

**`LifestyleRecommendation`**

```ts
{ title: string, description?: string, category?: string }
```

### Nutrition profile

#### GET /nutrition/my/profile

**Auth:** USER

```bash
curl "https://api.example.com/nutrition/my/profile" -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "profile": { /* NutritionProfile */ } }`

#### POST /nutrition/profiles

**Auth:** STAFF

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `userId` | ObjectId | yes | |
| `goal` | `NutritionGoal` | yes | |
| `dietaryPreference` | `DietaryPreference` | no | |
| `allergies`, `medicalConditions`, `preferredFoods`, `dislikedFoods` | string[] | no | |
| `targetCaloriesKcal` | number | no | |
| `targetMacros` | `Macros` | no | |
| `mealsPerDay` | number | no | 1–12 |
| `waterTargetLiters` | number | no | |
| `notes` | string | no | |

```bash
curl -X POST "https://api.example.com/nutrition/profiles" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "userId": "5f1a2b3c4d5e6f7a8b9c0d1e", "goal": "WeightLoss", "dietaryPreference": "Veg" }'
```

**Success (201):** `{ "message": "Profile created", "profile": { /* ... */ } }`

#### GET /nutrition/profiles/:userId — STAFF
#### PATCH /nutrition/profiles/:userId — STAFF (partial body)
#### DELETE /nutrition/profiles/:userId — STAFF

```bash
curl "https://api.example.com/nutrition/profiles/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

### Food catalog

#### GET /nutrition/foods

**Auth:** STAFF or `user`

**Query params:** `query` (string), `source` (`System` | `Custom`), `page`, `limit`.

```bash
curl "https://api.example.com/nutrition/foods?query=oats&source=System" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "foods": [ /* ... */ ], "pagination": { /* ... */ } }`

#### POST /nutrition/foods

**Auth:** STAFF

**Request body**

| Field | Type | Required |
|---|---|---|
| `name` | string | yes |
| `brand`, `servingLabel`, `barcode` | string | no |
| `basePer` | number | no |
| `caloriesKcal`, `proteinG`, `carbsG`, `fatG` | number | yes |
| `fiberG`, `sugarG` | number | no |
| `isVeg` | boolean | no |
| `allergens`, `mealTypes`, `tags` | string[] | no |

```bash
curl -X POST "https://api.example.com/nutrition/foods" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "name": "Rolled Oats", "caloriesKcal": 379, "proteinG": 13, "carbsG": 67, "fatG": 7, "isVeg": true }'
```

**Success (201):** `{ "message": "Food created", "food": { /* ... */ } }`

#### PATCH /nutrition/foods/:id — STAFF
#### DELETE /nutrition/foods/:id — STAFF
#### POST /nutrition/admin/foods — ADMIN (system food creation; same body as POST /nutrition/foods)

### Templates

#### POST /nutrition/templates — STAFF

Create a reusable plan template.

**Request body**

| Field | Type | Required |
|---|---|---|
| `name` | string | yes |
| `description` | string | no |
| `goal` | `NutritionGoal` | yes |
| `status` | `NutritionPlanStatus` | no |
| `tags` | string[] | no |
| `targetCaloriesKcal` | number | no |
| `targetMacros` | `Macros` | no |
| `durationDays` | number | no (1–366) |
| `days` | `Day[]` | yes |
| `lifestyleRecommendations` | `LifestyleRecommendation[]` | no |

```bash
curl -X POST "https://api.example.com/nutrition/templates" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "name": "Veg Weight-loss 4-week",
    "goal": "WeightLoss",
    "durationDays": 28,
    "days": []
  }'
```

**Success (201):** `{ "message": "Template created", "template": { /* ... */ } }`

#### GET /nutrition/templates — STAFF

**Query params:** `status`, `goal`, `tag`.

```bash
curl "https://api.example.com/nutrition/templates?goal=WeightLoss" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "templates": [ /* ... */ ] }`

#### GET /nutrition/templates/recommend — STAFF

**Query params:** `userId` (required, ObjectId).

```bash
curl "https://api.example.com/nutrition/templates/recommend?userId=5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "templates": [ /* ranked */ ] }`

#### GET /nutrition/templates/:id — STAFF
#### PATCH /nutrition/templates/:id — STAFF
#### DELETE /nutrition/templates/:id — STAFF

#### POST /nutrition/templates/:id/assign — STAFF

Assign a template to a user, creating a `NutritionPlan`.

**Request body**

| Field | Type | Required |
|---|---|---|
| `userId` | ObjectId | yes |
| `startDate` | ISO date | yes |
| `endDate` | ISO date | no |

```bash
curl -X POST "https://api.example.com/nutrition/templates/5f1a2b3c4d5e6f7a8b9c0d1e/assign" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "userId": "5f1a2b3c4d5e6f7a8b9c0d2f", "startDate": "2026-06-01" }'
```

**Success (201):** `{ "message": "Template assigned", "plan": { /* ... */ }, "warnings": [] }`

#### POST /nutrition/templates/:id/filter — STAFF

Preview a template filtered for a user's preferences/allergies.

**Request body** (one of):

```ts
{ userId?: ObjectId, profile?: { dietaryPreference?, allergies?, dislikedFoods?, goal? } }
```

```bash
curl -X POST "https://api.example.com/nutrition/templates/5f1a2b3c4d5e6f7a8b9c0d1e/filter" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "profile": { "dietaryPreference": "Vegan", "allergies": ["peanut"] } }'
```

**Success (200):** filtered template with food substitutions.

### Plans (managed)

#### POST /nutrition/plans — STAFF

**Request body**

| Field | Type | Required |
|---|---|---|
| `userId` | ObjectId | yes |
| `name` | string | yes |
| `goal` | `NutritionGoal` | yes |
| `startDate` | ISO date | yes |
| `endDate` | ISO date | no |
| `targetCaloriesKcal` | number | no |
| `targetMacros` | `Macros` | no |
| `durationDays` | number (1–366) | no |
| `days` | `Day[]` | yes |
| `lifestyleRecommendations` | `LifestyleRecommendation[]` | no |

```bash
curl -X POST "https://api.example.com/nutrition/plans" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "userId": "5f1a2b3c4d5e6f7a8b9c0d1e",
    "name": "Jane custom plan",
    "goal": "WeightLoss",
    "startDate": "2026-06-01",
    "days": []
  }'
```

**Success (201):** `{ "message": "Plan created", "plan": { /* ... */ }, "warnings": [] }`

#### GET /nutrition/plans — STAFF (`status?`)
#### GET /nutrition/plans/:id — STAFF
#### PATCH /nutrition/plans/:id — STAFF
#### PATCH /nutrition/plans/:id/status — STAFF — body: `{ status: NutritionPlanStatus }`
#### POST /nutrition/plans/:id/pdf — STAFF — generates PDF, returns binary or `{ url }`
#### POST /nutrition/plans/:id/duplicate — STAFF — body: `{ targetUserId?, name? }`
#### GET /nutrition/plans/:id/adherence — STAFF — query `from`, `to`
#### GET /nutrition/plans/:id/adherence/weekly — STAFF — query `from`, `to`
#### GET /nutrition/plans/:id/progress — STAFF
#### POST /nutrition/plans/:id/progress — STAFF — body: `{ planId?, recordedAt?, weightKg?, bodyFatPct?, measurements?, photoUrls?, note? }`

```bash
curl -X PATCH "https://api.example.com/nutrition/plans/5f1a2b3c4d5e6f7a8b9c0d1e/status" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "status": "Active" }'
```

### Plans (user-facing)

#### GET /nutrition/my/plans — USER

```bash
curl "https://api.example.com/nutrition/my/plans" -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "plans": [ /* user's assigned */ ] }`

#### GET /nutrition/my/plans/:id — USER
#### GET /nutrition/my/plans/:id/pdf — USER — PDF binary or `{ url }`

#### POST /nutrition/my/plans/:id/meals/complete — USER

Mark a planned meal as complete.

**Request body**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `dayNumber` | number | yes | 1–366 |
| `mealIndex` | number | yes | 0–50 |
| `date` | ISO date | no | |
| `completedOptionId` | ObjectId | no | which meal option was eaten |

```bash
curl -X POST "https://api.example.com/nutrition/my/plans/5f1a2b3c4d5e6f7a8b9c0d1e/meals/complete" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "dayNumber": 3, "mealIndex": 1 }'
```

**Success (200):** `{ "message": "Meal logged", "log": { /* MealLog */ } }`

### Meal logs (user)

#### POST /nutrition/my/meal-logs — USER

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `items` | `MealItem[]` | yes | |
| `planId` | ObjectId | no | |
| `logDate` | ISO date | no | |
| `status` | `MealLogStatus` | no | |
| `source` | `MealLogSource` | no | |
| `plannedMealRef` | `{ dayNumber, mealIndex, selectedOptionId?, completedOptionId? }` | no | |
| `notes` | string | no | |
| `photoUrls` | string[] (urls) | no | |

```bash
curl -X POST "https://api.example.com/nutrition/my/meal-logs" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "items": [ { "foodId": "5f1a2b3c4d5e6f7a8b9c0d1e", "quantityG": 50 } ] }'
```

**Success (201):** `{ "message": "Meal log created", "log": { /* ... */ } }`

#### GET /nutrition/my/meal-logs — USER

**Query:** `planId`, `from`, `to`, `page`, `limit`.

#### PATCH /nutrition/my/meal-logs/:id — USER — partial body of POST fields
#### DELETE /nutrition/my/meal-logs/:id — USER

### Hydration (user)

#### POST /nutrition/my/hydration — USER

**Request body:** `{ amountMl: number (1–20000), source?: string, date?: ISO-date }`

```bash
curl -X POST "https://api.example.com/nutrition/my/hydration" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "amountMl": 500 }'
```

**Success (201):** `{ "message": "Hydration logged", "hydration": { /* ... */ } }`

#### PATCH /nutrition/my/hydration/goal — USER

**Request body:** `{ goalMl: number (1–20000), date?: ISO-date }`

#### GET /nutrition/my/hydration — USER

**Query:** `date?`.

### Progress (user)

#### POST /nutrition/my/progress — USER

**Request body**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `planId` | ObjectId | no | |
| `recordedAt` | ISO date | no | |
| `weightKg` | number | no | 0–1000 |
| `bodyFatPct` | number | no | 0–100 |
| `measurements` | `{ chestCm?, waistCm?, hipCm?, armCm?, thighCm? }` | no | |
| `photoUrls` | string[] (urls) | no | |
| `note` | string | no | |

```bash
curl -X POST "https://api.example.com/nutrition/my/progress" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "weightKg": 64.2, "bodyFatPct": 22 }'
```

**Success (201):** `{ "message": "Progress recorded", "entry": { /* ... */ } }`

#### GET /nutrition/my/progress — USER (`planId?`, `from?`, `to?`)

### Adherence (user)

#### GET /nutrition/my/adherence — USER

**Query:** `planId` (required), `from` (required, ISO date), `to` (required, ISO date).

```bash
curl "https://api.example.com/nutrition/my/adherence?planId=5f1a2b3c4d5e6f7a8b9c0d1e&from=2026-05-01&to=2026-05-22" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "days": [ { "date": "2026-05-15", "adherenceScore": 87, "mealStats": { /* ... */ } } ] }`

#### GET /nutrition/my/adherence/weekly — USER

Same query, returns `{ "weeks": [ { "weekStart": "...", "adherenceScore": 88, "mealStats": { /* ... */ } } ] }`.

### Dashboard (staff)

#### GET /nutrition/dashboard/stats — STAFF

```bash
curl "https://api.example.com/nutrition/dashboard/stats" -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "totalMembers": 124, "activePlans": 87, "thisWeek": { "newMembers": 6, "completedMeals": 312 } }`

#### GET /nutrition/dashboard/members — STAFF

**Query:** `status`, `page`, `limit`.

**Success (200):** `{ "members": [ { "_id", "username", "email", "activeStatus", "lastActive", "adherence" } ], "pagination": { /* ... */ } }`

#### GET /nutrition/members — STAFF

Alias of `/dashboard/members` (same handler).

#### GET /nutrition/users/:userId/dashboard — STAFF

```bash
curl "https://api.example.com/nutrition/users/5f1a2b3c4d5e6f7a8b9c0d1e/dashboard" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "profile": { /* ... */ }, "activePlan": { /* ... */ }, "recentProgress": [ /* ... */ ], "weeklyAdherence": [ /* ... */ ] }`

### Admin nutrition tools

#### POST /nutrition/admin/foods — ADMIN — system food (same body as POST /nutrition/foods)
#### POST /nutrition/admin/adherence/rebuild — ADMIN — body: `{ planId: ObjectId }` — re-computes adherence for a plan

```bash
curl -X POST "https://api.example.com/nutrition/admin/adherence/rebuild" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "planId": "5f1a2b3c4d5e6f7a8b9c0d1e" }'
```

**Success (200):** `{ "message": "Adherence rebuilt", "planId": "..." }`

> Full request schema details for every nutrition endpoint live in the per-area validator files under [`src/validators/`](../src/validators):
> [`nutrition-profile.validator.ts`](../src/validators/nutrition-profile.validator.ts),
> [`nutrition-food.validator.ts`](../src/validators/nutrition-food.validator.ts),
> [`nutrition-template.validator.ts`](../src/validators/nutrition-template.validator.ts),
> [`nutrition-plan.validator.ts`](../src/validators/nutrition-plan.validator.ts),
> [`nutrition-meal-log.validator.ts`](../src/validators/nutrition-meal-log.validator.ts),
> [`nutrition-hydration.validator.ts`](../src/validators/nutrition-hydration.validator.ts),
> [`nutrition-progress.validator.ts`](../src/validators/nutrition-progress.validator.ts),
> [`nutrition-dashboard.validator.ts`](../src/validators/nutrition-dashboard.validator.ts),
> [`nutrition-shared.validator.ts`](../src/validators/nutrition-shared.validator.ts).
> The doc above lists the essential field set — for edge-case constraints, consult the relevant validator.

---

## Health check — `/health`

### GET /health

Liveness probe. Always returns `{ ok: true }` when the process is running.

**Auth:** Public

```bash
curl "https://api.example.com/health"
```

**Success (200)**

```json
{ "ok": true }
```

---

## Appendix A: Onboarding step order

Steps are enforced server-side via [src/utils/onboarding.service.ts](../src/utils/onboarding.service.ts). Calling a later step before earlier steps complete returns `403 STEP_NOT_ALLOWED`.

| Order | Step | Endpoint | Notes |
|---|---|---|---|
| 1 | `HEALTH_MARKERS` | `POST /onboarding/health-markers` | BMI computed server-side |
| 2 | `HEALTH_GOALS` | `POST /onboarding/health-goals` | |
| 3 | `CONSENT` | `POST /onboarding/consent` | Captures IP automatically |
| 4 | `REPORT_UPLOAD` | `POST /onboarding/reports` | Multiple submissions allowed |
| 5 | `SPORTS_SCIENTIST_BOOKING` | `POST /onboarding/appointments` (`expertType: "sports_scientist"`) | Must precede step 6 |
| 6 | `NUTRITIONIST_BOOKING` | `POST /onboarding/appointments` (`expertType: "nutritionist"`) | |
| 7 | `COMPLETED` | `POST /onboarding/complete` | Sets `user.onboarded = true` |

Legacy single-step alternative: `PATCH /users/:id/onboard` — still supported but bypasses the granular step tracking. New clients should use the steps above.

---

## Changelog

- **2026-05-22** — Initial consolidated reference covering all 17 routers and `/health`.
