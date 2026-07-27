# HybridHuman Backend API Documentation

**Base URL:** `http://localhost:3000`  
**API Version:** 1.0.0  
**Last Updated:** May 27, 2026

---

## 📋 Table of Contents

1. [Authentication](#authentication)
2. [Endpoints Overview](#endpoints-overview)
3. [Auth Routes](#auth-routes)
4. [Admin Routes](#admin-routes)
5. [User Routes](#user-routes)
6. [Doctor Routes](#doctor-routes)
7. [Trainer Routes](#trainer-routes)
8. [Slot Routes](#slot-routes)
9. [Membership Routes](#membership-routes)
10. [Service Routes](#service-routes)
11. [Therapy Routes](#therapy-routes)
12. [Lead Routes](#lead-routes)
13. [Booking Routes](#booking-routes)
14. [Appointment Routes](#appointment-routes)
15. [Expert Appointment Routes](#expert-appointment-routes)
16. [Credit Routes](#credit-routes)
17. [Schedule Routes](#schedule-routes)
18. [Exercise Routes](#exercise-routes)
19. [Workout Routes](#workout-routes)
20. [Workout Plan Routes](#workout-plan-routes)
21. [Nutrition Routes](#nutrition-routes)
22. [Nutritionist Booking Routes](#nutritionist-booking-routes)
23. [Notification Routes](#notification-routes)
24. [Webhook Routes](#webhook-routes)
25. [Internal Routes](#internal-routes)
26. [Onboarding Routes](#onboarding-routes)
27. [Enums & Status Codes](#enums--status-codes)
28. [Error Handling](#error-handling)
29. [Health Check](#health-check)

---

## Authentication

### JWT Authentication

All protected endpoints use **JWT Bearer authentication** with the following format:

```
Authorization: Bearer <accessToken>
```

**Example:**
```bash
curl -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/doctors
```

Tokens are issued by `POST /auth/login` and can be refreshed via `POST /auth/refresh` when refresh tokens are enabled.

**Webhook/Internal Auth Notes:**
- `/webhook/email` uses `X-Webhook-Secret` instead of JWT.
- `/webhooks/cal` uses `X-Cal-Signature-256` (HMAC signature on raw body).
- `/internal/*` uses `X-Internal-Secret` (or `X-Webhook-Secret` alias) instead of JWT.

### Migration Notes (Basic Auth → JWT)

- Protected routes no longer accept `Authorization: Basic ...` headers.
- Use `POST /auth/login` to obtain an `accessToken`, then send `Authorization: Bearer <accessToken>`.
- If `JWT_REFRESH_SECRET` is configured, use `POST /auth/refresh` to rotate access tokens.
- Prefer `POST /onboarding/sports-scientist` and `POST /onboarding/nutritionist` over the legacy `/onboarding/appointments` endpoint.

### User Roles

The system supports 5 role types:
- **`user`** — Patient/end-user (non-medical)
- **`doctor`** — Healthcare provider
- **`trainer`** — Fitness/wellness trainer
- **`nutritionist`** — Nutrition specialist (dashboard role)
- **`admin`** — Front desk/system administrator

---

## Endpoints Overview

| Route | Purpose | Auth | Endpoints |
|-------|---------|------|-----------|
| `/auth` | User authentication | ❌ Public | 4 endpoints |
| `/admins` | Admin management | ✅ Admin only | 5 endpoints |
| `/users` | Member management | ✅ Admin/Doctor/Nutritionist (read), Admin/User self (updates), User self-service profile/report/password | 14 endpoints |
| `/doctors` | Doctor management | ✅ Public list + Admin + role-based | 7 endpoints |
| `/trainers` | Trainer management | ✅ Public list + Admin + role-based | 7 endpoints |
| `/slots` | Time slot management | ✅ Authenticated read, Admin write | 6 endpoints |
| `/api/v1/classes` | Group class & capacity management | ✅ Admin write/read, Member active list | 7 endpoints |
| `/memberships` | Membership plans per user | ✅ Admin + User (self) | 6 endpoints |
| `/services` | Catalog of services | ✅ Admin write, all roles read | 5 endpoints |
| `/therapies` | Catalog of therapies | ✅ Public list + Admin write | 7 endpoints |
| `/leads` | Lead intake and conversion | ✅ Mixed roles + 1 public capture endpoint | 8 endpoints |
| `/bookings` | Service bookings | ✅ Admin + User | 7 endpoints |
| `/appointments` | Doctor appointments | ✅ Admin + Doctor | 7 endpoints |
| `/expert-appointments` | Expert appointments (nutritionist/sports scientist) | ✅ User + Admin | 8 endpoints |
| `/credits` | Credit balance, history, top-up | ✅ Admin + User (self-service for user) | 5 endpoints |
| `/schedules` | User schedules/todos | ✅ All authenticated | 6 endpoints |
| `/exercises` | Exercise library | ✅ Admin + User | 5 endpoints |
| `/workouts` | Workout sessions, exercises, set logging, stats | ✅ User | 15 endpoints |
| `/workout-plans` | Workout plan templates + assignments | ✅ Admin/Trainer + User assignments | 13 endpoints |
| `/nutrition` | Nutrition system | ✅ User + Nutritionist/Admin | 48 endpoints |
| `/nutritionist` | Nutritionist bookings | ✅ Admin + User | 4 endpoints |
| `/notifications` | Notifications | ✅ All authenticated | 4 endpoints |
| `/webhook` | HPOD webhook + reports | ✅ Webhook secret + Admin read | 4 endpoints |
| `/webhooks/cal` | Cal ID webhook | ✅ Signature header | 1 endpoint |
| `/internal` | Internal cron hooks | ✅ Internal secret | 1 endpoint |
| `/onboarding` | Onboarding workflow — health markers, goals, dual-consent, reports, appointments | ✅ User only (+ 1 admin cancel) | 11 endpoints |
| `/health` | Health check | ❌ Public | 1 endpoint |

**Total Endpoints:** 209

---

## Auth Routes

### Base Path: `/auth`

#### 1. User Signup
```
POST /auth/signup
```

**Authentication:** ❌ None  
**Authorization:** N/A

**Request Body:**
```json
{
  "username": "john_doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "password": "securePassword123",
  "age": 28,
  "gender": "Male"
}
```

**Validation Notes:**
- `password` must be at least 8 characters and include at least one letter and one number.
- `age` must be an integer in range `0` to `130`.
- `gender` accepts `Male`, `Female`, or `Other` (legacy numeric `0`–`2` is normalized).

**Response (201 Created):**
```json
{
  "message": "User signup successful",
  "userId": "507f1f77bcf86cd799439011",
  "onboarded": false
}
```

**Error Responses:**
- `400` — Missing or invalid fields
- `409` — Email already exists

---

#### 2. Unified Login (User/Admin/Doctor/Trainer)
```
POST /auth/login
```

**Authentication:** ❌ None  
**Authorization:** N/A

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "securePassword123"
}
```

**Response (200 OK):**
```json
{
  "message": "Login successful",
  "accessToken": "<jwt>",
  "refreshToken": "<jwt or null>",
  "tokenType": "Bearer",
  "expiresIn": "12h",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "john@example.com",
    "role": "user",
    "onboarded": false,
    "onboardingStatus": {
      "currentStep": "HEALTH_MARKERS",
      "completedSteps": [],
      "healthMarkersCompleted": false,
      "healthGoalsCompleted": false,
      "consentCompleted": false,
      "reportsUploaded": false,
      "sportsScientistBooked": false,
      "nutritionistBooked": false,
      "onboardingCompleted": false
    }
  }
}
```

**Admin Login Response Example (200 OK):**
```json
{
  "message": "Login successful",
  "accessToken": "<jwt>",
  "refreshToken": "<jwt or null>",
  "tokenType": "Bearer",
  "expiresIn": "12h",
  "user": {
    "id": "507f1f77bcf86cd799439099",
    "email": "admin@hybridhuman.com",
    "role": "admin"
  }
}
```

**Doctor Login Response Example (200 OK):**
```json
{
  "message": "Login successful",
  "accessToken": "<jwt>",
  "refreshToken": "<jwt or null>",
  "tokenType": "Bearer",
  "expiresIn": "12h",
  "user": {
    "id": "507f1f77bcf86cd799439055",
    "email": "dr.jane@hybridhuman.com",
    "role": "doctor"
  }
}
```

**Trainer Login Response Example (200 OK):**
```json
{
  "message": "Login successful",
  "accessToken": "<jwt>",
  "refreshToken": "<jwt or null>",
  "tokenType": "Bearer",
  "expiresIn": "12h",
  "user": {
    "id": "507f1f77bcf86cd799439077",
    "email": "coach.mike@hybridhuman.com",
    "role": "trainer"
  }
}
```

**Notes:**
- `refreshToken` is only issued when `JWT_REFRESH_SECRET` is configured.
- User logins include `onboarded` and `onboardingStatus` for onboarding-aware clients.

**Error Responses:**
- `400` — Invalid login payload
- `401` — Invalid email or password

---

#### 3. Refresh Access Token
```
POST /auth/refresh
```

**Authentication:** ❌ None  
**Authorization:** N/A

**Request Body:**
```json
{
  "refreshToken": "<jwt>"
}
```

**Response (200 OK):**
```json
{
  "message": "Token refreshed",
  "accessToken": "<jwt>",
  "tokenType": "Bearer",
  "expiresIn": "12h"
}
```

**Notes:**
- Refresh tokens are issued only when `JWT_REFRESH_SECRET` is configured.
- If refresh is not configured, this endpoint returns `503`.
- Use a distinct refresh secret so refresh tokens cannot be used as access tokens.

**Error Responses:**
- `400` — Missing or invalid refresh token
- `401` — Invalid or expired refresh token
- `503` — Refresh not configured

---

#### 4. Logout
```
POST /auth/logout
```

**Authentication:** ✅ Bearer token required

**Response (200 OK):**
```json
{ "message": "Logged out successfully" }
```

**Notes:**
- The access token is blacklisted until it naturally expires.

**Error Responses:**
- `400` — Missing Bearer token

---

## Admin Routes

### Base Path: `/admins`

**Global Requirements:**
- ✅ JWT Bearer token required
- ✅ Admin role required for all admin routes

#### 1. Create Admin
```
POST /admins
```

**Request Body:**
```json
{
  "adminName": "Alice Manager",
  "email": "alice@hybridhuman.com",
  "phone": "+1234567890",
  "password": "adminPass123"
}
```

**Response (201 Created):**
```json
{
  "message": "Admin created successfully",
  "admin": {
    "_id": "507f1f77bcf86cd799439011",
    "adminName": "Alice Manager",
    "email": "alice@hybridhuman.com",
    "phone": "+1234567890",
    "createdAt": "2026-03-20T10:00:00Z",
    "updatedAt": "2026-03-20T10:00:00Z"
  }
}
```

---

#### 2. Get All Admins
```
GET /admins
```

**Response (200 OK):**
```json
{
  "admins": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "adminName": "Alice Manager",
      "email": "alice@hybridhuman.com",
      "phone": "+1234567890",
      "createdAt": "2026-03-20T10:00:00Z",
      "updatedAt": "2026-03-20T10:00:00Z"
    }
  ]
}
```

---

#### 3. Get Admin by ID
```
GET /admins/:id
```

**URL Params:**
- `id` (string, required) — Admin MongoDB ObjectId

**Response (200 OK):**
```json
{
  "admin": {
    "_id": "507f1f77bcf86cd799439011",
    "adminName": "Alice Manager",
    "email": "alice@hybridhuman.com",
    "phone": "+1234567890",
    "createdAt": "2026-03-20T10:00:00Z",
    "updatedAt": "2026-03-20T10:00:00Z"
  }
}
```

---

#### 4. Update Admin
```
PATCH /admins/:id
```

**URL Params:**
- `id` (string, required) — Admin MongoDB ObjectId

**Request Body (all fields optional):**
```json
{
  "adminName": "Alice Manager Updated",
  "email": "alice.new@hybridhuman.com",
  "phone": "+9876543210",
  "password": "newPassword123"
}
```

**Response (200 OK):**
```json
{
  "message": "Admin updated successfully",
  "admin": { /* updated admin object */ }
}
```

---

#### 5. Delete Admin
```
DELETE /admins/:id
```

**URL Params:**
- `id` (string, required) — Admin MongoDB ObjectId

**Response (200 OK):**
```json
{
  "message": "Admin deleted successfully"
}
```

---

## User Routes

### Base Path: `/users`

**Global Requirements:**
- ✅ JWT Bearer token required
- ✅ Admin can create and delete users
- ✅ Admin, Doctor, or Nutritionist can view full onboarding profile (`GET /users/:id/onboarding-profile`)
- ✅ Admin or user-self can update profile (`PATCH /users/:id`)
- ✅ Users can access self-service endpoints (`/me`, `/me/reports`, `/me/password`)

#### 1. Create User
```
POST /users
```

**Authorization:** Admin only

**Request Body:**
```json
{
  "username": "john_doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "password": "securePassword123",
  "age": 28,
  "gender": "Male",
  "healthGoals": ["Build muscle", "Improve stamina"],
  "dateOfBirth": "1998-09-12T00:00:00.000Z",
  "emergencyContact": "+1987654321",
  "address": "221B Baker Street"
}
```

**Validation Notes:**
- `password` must be at least 8 characters and include at least one letter and one number.
- `age` must be an integer in range `0` to `130`.

**Response (201 Created):**
```json
{
  "message": "User created",
  "user": {
    "_id": "507f1f77bcf86cd799439011",
    "username": "john_doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "age": 28,
    "gender": "Male",
    "healthGoals": ["Build muscle", "Improve stamina"],
    "dateOfBirth": "1998-09-12T00:00:00.000Z",
    "emergencyContact": "+1987654321",
    "address": "221B Baker Street",
    "onboarded": false,
    "createdAt": "2026-03-21T10:00:00Z",
    "updatedAt": "2026-03-21T10:00:00Z"
  }
}
```

---

#### 2. Get All Users
```
GET /users
```

**Authorization:** Admin, Doctor, or Nutritionist

**Response (200 OK):**
```json
{
  "users": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "username": "john_doe",
      "email": "john@example.com",
      "phone": "+1234567890",
      "age": 28,
      "gender": "Male",
      "healthGoals": ["Build muscle", "Improve stamina"],
      "createdAt": "2026-03-21T10:00:00Z",
      "updatedAt": "2026-03-21T10:00:00Z"
    }
  ]
}
```

---

#### 3. Get User by ID
```
GET /users/:id
```

**URL Params:**
- `id` (string, required) — User MongoDB ObjectId

**Authorization:** Admin, Doctor, or Nutritionist

**Response (200 OK):**
```json
{
  "user": {
    "_id": "507f1f77bcf86cd799439011",
    "username": "john_doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "age": 28,
    "gender": "Male",
    "healthGoals": ["Build muscle", "Improve stamina"],
    "onboarded": false,
    "onboardingStatus": {
      "currentStep": "HEALTH_GOALS",
      "completedSteps": ["HEALTH_MARKERS"],
      "healthMarkersCompleted": true,
      "healthGoalsCompleted": false,
      "consentCompleted": false,
      "reportsUploaded": false,
      "sportsScientistBooked": false,
      "nutritionistBooked": false,
      "onboardingCompleted": false,
      "startedAt": "2026-05-15T09:00:00Z",
      "completedAt": null
    },
    "createdAt": "2026-03-21T10:00:00Z",
    "updatedAt": "2026-03-21T10:00:00Z"
  }
}
```

---

#### 3b. Get User Onboarding Profile
```
GET /users/:id/onboarding-profile
```

**URL Params:**
- `id` (string, required) — User MongoDB ObjectId

**Authorization:** Admin, Doctor, or Nutritionist

Returns the full onboarding data submitted by a user, aggregated from all onboarding collections. Used by the FrontDesk dashboard to display member onboarding details.

**Response (200 OK):**
```json
{
  "user": {
    "_id": "507f1f77bcf86cd799439011",
    "username": "john_doe",
    "email": "john@example.com",
    "age": 28,
    "gender": "Male",
    "onboarded": true,
    "onboardingStatus": { "..." }
  },
  "healthMarkers": {
    "weight": 75,
    "height": 178,
    "bmi": 23.7,
    "allergies": ["Peanuts"],
    "medications": [],
    "diseaseHistory": [],
    "sleepHours": 7,
    "activityLevel": "Moderate"
  },
  "healthGoals": {
    "goals": ["Build muscle", "Improve stamina"],
    "targetWeight": 80,
    "timeline": "6 months",
    "workoutExperience": "Intermediate",
    "foodPreferences": ["Vegetarian"]
  },
  "consents": [
    {
      "type": "WELLNESS_SERVICES",
      "accepted": true,
      "acceptedAt": "2026-05-16T09:10:00Z",
      "signatureName": "Rahul"
    },
    {
      "type": "GYM_FITNESS",
      "accepted": true,
      "acceptedAt": "2026-05-16T09:10:00Z",
      "signatureName": "Rahul"
    }
  ],
  "reports": [
    {
      "reportName": "Blood Panel April 2026",
      "reportType": "Blood Test",
      "reportUrl": null,
      "uploadedAt": "2026-05-16T10:00:00Z"
    }
  ],
  "appointments": [
    {
      "expertType": "sports_scientist",
      "bookingStatus": "Confirmed",
      "appointmentDate": "2026-05-20T10:00:00Z",
      "meetingLink": "https://meet.example.com/abc"
    }
  ]
}
```

**Notes:**
- `healthMarkers`, `healthGoals` are `null` if the user has not completed that step.
- `consents` is an empty array if no consent submitted, or contains legacy data for older records.
- `reports` and `appointments` are always arrays (may be empty).

**Error Responses:**
- `400` — Invalid user ID format
- `404` — User not found

---

#### 3c. Get Medical Report Signed URL
```
GET /users/:id/reports/:reportId/url
```

**URL Params:**
- `id` (string, required) — User MongoDB ObjectId
- `reportId` (string, required) — Medical Report MongoDB ObjectId

**Authorization:** Admin, Doctor, or Nutritionist

Generates a secure, temporary pre-signed URL to view the user's uploaded medical report inline.

**Security Features:**
- Overrides response headers to enforce **inline Content-Disposition** (`response-content-disposition=inline`) and correct MIME type.
- Expires strictly after **15 minutes** (900 seconds) to mitigate access leakage risks.

**Response (200 OK):**
```json
{
  "url": "https://fitflix-storage.s3.ap-south-1.amazonaws.com/medical-reports/507f1f77bcf86cd799439011/1779698949706-507f1f77bcf86cd799439204.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=...&X-Amz-Date=20260525T084909Z&X-Amz-Expires=900&X-Amz-Signature=...&response-content-disposition=inline&response-content-type=application%2Fpdf",
  "expiresIn": 900
}
```

**Error Responses:**
- `400` — Invalid user ID or report ID format
- `403` — `FORBIDDEN` — Caller is not an admin, doctor, or nutritionist
- `404` — Report not found, or no S3 file attached to the report

---

#### 4. Get My User
```
GET /users/me
```

**Authorization:** User only

**Response (200 OK):**
```json
{
  "user": {
    "_id": "507f1f77bcf86cd799439011",
    "username": "john_doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "age": 28,
    "gender": "Male",
    "healthGoals": ["Build muscle", "Improve stamina"],
    "dateOfBirth": "1998-09-12T00:00:00.000Z",
    "emergencyContact": "+1987654321",
    "address": "221B Baker Street",
    "onboarded": true
  }
}
```

---

#### 5. Get My Reports (Unified Feed)
```
GET /users/me/reports
```

**Authorization:** User only

Returns a combined, chronological feed of both HPOD optimization reports and user-uploaded medical/DNA documents.

**Response (200 OK):**
```json
{
  "reports": [
    {
      "id": "6a140d05b2b1391ed1952b3b",
      "title": "My DNA Genotype Profile",
      "type": "DNA",
      "summary": "Uploaded DNA report",
      "suggestions": [],
      "recommendations": [],
      "insights": [],
      "generated_date": "2026-05-25T08:49:09.885Z",
      "pdf_url": "https://fitflix-storage.s3.ap-south-1.amazonaws.com/medical-reports/...&response-content-disposition=inline&response-content-type=application%2Fpdf..."
    },
    {
      "id": "report-001",
      "title": "April Personalized Optimization Report",
      "type": "HPOD",
      "summary": "Your recovery markers improved, but sleep consistency needs attention.",
      "suggestions": [
        "Maintain 7.5-8 hours sleep window for 14 days.",
        "Shift caffeine cutoff to 2 PM."
      ],
      "recommendations": [
        "Maintain 7.5-8 hours sleep window for 14 days."
      ],
      "insights": [
        "Shift caffeine cutoff to 2 PM."
      ],
      "generated_date": "2026-04-10T08:00:00.000Z",
      "pdf_url": "http://localhost:3000/users/me/reports/report-001/pdf"
    }
  ]
}
```

---

#### 5a. Get My Medical & DNA Reports
```
GET /users/me/medical-reports
```

**Authorization:** User only

Exclusively returns the list of medical and DNA reports uploaded by the user, dynamically generating secure pre-signed S3 download/rendering URLs (15-minute expiry).

**Response (200 OK):**
```json
{
  "reports": [
    {
      "_id": "6a140d05b2b1391ed1952b3b",
      "userId": "6a140d05b2b1391ed1952b1f",
      "reportName": "My DNA Genotype Profile",
      "reportType": "DNA",
      "s3Key": "medical-reports/6a140d05b2b1391ed1952b1f/1779698949706-6a140d05b2b1391ed1952b3a.pdf",
      "mimeType": "application/pdf",
      "fileSize": 24581,
      "reportUrl": "https://fitflix-storage.s3.ap-south-1.amazonaws.com/medical-reports/...&response-content-disposition=inline&response-content-type=application%2Fpdf...",
      "createdAt": "2026-05-25T08:49:09.886Z",
      "updatedAt": "2026-05-25T08:49:09.886Z"
    }
  ]
}
```

---

#### 6. Get My HPOD Metrics History
```
GET /users/me/hpod-metrics
```

**Authorization:** User only

**Response (200 OK):**
```json
{
  "history": [
    {
      "_id": "507f1f77bcf86cd799439120",
      "reportId": "507f1f77bcf86cd799439111",
      "reportDate": "2026-04-10",
      "recordedAt": "2026-04-10T08:00:00.000Z",
      "receivedAt": "2026-04-10T08:05:00.000Z",
      "patientName": "John Doe",
      "patientEmail": "john@example.com",
      "patientPhone": "+1234567890",
      "age": "28",
      "gender": "Male",
      "vitals": {
        "weight_kg": 76.2,
        "height_cm": 178.0,
        "bmi": 24.1,
        "bmi_category": "Normal",
        "spo2_percent": 98,
        "body_temperature_f": 98.6,
        "pulse": 72,
        "blood_pressure": "118/76"
      },
      "bodyComposition": {
        "body_fat_mass_kg": 14.5,
        "body_fat_percent": 19.0,
        "total_body_water_L": 41.2,
        "protein_kg": 10.6,
        "minerals_kg": 3.6,
        "skeletal_muscle_mass_kg": 31.8,
        "visceral_fat_cm2": 82,
        "basal_metabolic_rate_cal": 1650,
        "intracellular_water_L": 24.8,
        "extracellular_water_L": 16.4
      },
      "ecg": {
        "pr_interval": "160 ms",
        "qrs_interval": "90 ms",
        "qtc_interval": "420 ms",
        "heart_rate": "72 bpm"
      },
      "idealBodyWeight_kg": 72.5,
      "weightToLose_kg": 4.0,
      "testsNotTaken": [],
      "healthInsight": "Overall metrics are within normal range with a slight opportunity to improve body composition.",
      "concerns": []
    }
  ]
}
```

---

#### 7. Get My Report PDF
```
GET /users/me/reports/:id/pdf
```

**Authorization:** User only

**URL Params:**
- `id` (string, required) — Report ObjectId

**Current Behavior:**
- Endpoint validates ownership and currently returns `501 Not Implemented` while PDF byte storage/streaming is being finalized.

**Error Responses:**
- `403` — Report does not belong to authenticated user
- `404` — Report not found
- `501` — PDF endpoint not available yet

---

#### 8. Update My Password
```
PATCH /users/me/password
```

**Authorization:** User only

**Request Body:**
```json
{
  "currentPassword": "old-password",
  "newPassword": "newStrongPass123"
}
```

**Validation Notes:**
- `newPassword` must be at least 8 characters and include at least one letter and one number.
- `newPassword` must be different from `currentPassword`.

**Success Response (200 OK):**
```json
{
  "message": "Password updated successfully"
}
```

**Error Responses:**
- `400` — Invalid payload or weak password
- `401` — Current password is incorrect
- `404` — Authenticated user not found

---

#### 9. Onboard User (self or admin)
```
PATCH /users/:id/onboard
```

**Authorization:** Admin (any user) or User (self)

**Purpose:** Mark the user as onboarded and optionally update profile fields in one call.

**URL Params:**
- `id` (string, required) — User MongoDB ObjectId

**Request Body (all fields optional; at least one required):**
```json
{
  "username": "john_doe",
  "phone": "+1234567890",
  "age": 28,
  "gender": "Male",
  "healthGoals": ["Build muscle"],
  "onboarded": true
}
```

**Response (200 OK):**
```json
{
  "message": "User onboarded",
  "user": {
    "_id": "507f1f77bcf86cd799439011",
    "username": "john_doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "age": 28,
    "gender": "Male",
    "healthGoals": ["Build muscle"],
    "onboarded": true,
    "createdAt": "2026-03-21T10:00:00Z",
    "updatedAt": "2026-03-21T10:05:00Z"
  }
}
```

**Notes:**
- Users can only onboard themselves; admins can onboard any user.
- The endpoint forces `onboarded` to `true` even if omitted.

---

#### 9. Update User
```
PATCH /users/:id
```

**Authorization:** Admin (any user) or User (self)

**URL Params:**
- `id` (string, required) — User MongoDB ObjectId

**Request Body (all fields optional):**
```json
{
  "username": "john_updated",
  "phone": "+1987654321",
  "age": 29,
  "gender": "Male",
  "healthGoals": ["Weight loss", "Sleep improvement"],
  "dateOfBirth": "1998-09-12T00:00:00.000Z",
  "emergencyContact": "+1987654321",
  "address": "221B Baker Street"
}
```

**Notes:**
- For role `user`, password changes are not allowed in this endpoint. Use `PATCH /users/me/password`.

**Response (200 OK):**
```json
{
  "user": { /* updated user object */ }
}
```

---

#### 10. Delete User
```
DELETE /users/:id
```

**Authorization:** Admin only

**URL Params:**
- `id` (string, required) — User MongoDB ObjectId

**Response (200 OK):**
```json
{
  "message": "User deleted"
}
```

---

## Doctor Routes

### Base Path: `/doctors`

**Global Requirements:**
- ✅ JWT Bearer token required for protected endpoints
- ❌ `/doctors/public` endpoints are unauthenticated

| Endpoint | POST | GET | PATCH | DELETE |
|----------|------|-----|-------|--------|
| `/doctors/public` | - | Public | - | - |
| `/doctors/public/:id` | - | Public | - | - |
| `/doctors` | Admin | Admin | - | - |
| `/doctors/:id` | - | Doctor, Trainer | Doctor, Trainer | Admin |

#### 0. Public Doctors
```
GET /doctors/public
GET /doctors/public/:id
```

**Authentication:** ❌ None

#### 1. Create Doctor
```
POST /doctors
```

**Authorization:** Admin only

**Request Body:**
```json
{
  "doctorName": "Dr. Smith",
  "email": "smith@hybridhuman.com",
  "phone": "+1234567890",
  "password": "docPass123",
  "description": "Cardiologist with 10+ years experience",
  "specialities": ["Cardiology", "Preventive Medicine"]
}
```

**Response (201 Created):**
```json
{
  "message": "Doctor created successfully",
  "doctor": {
    "_id": "507f1f77bcf86cd799439012",
    "doctorName": "Dr. Smith",
    "email": "smith@hybridhuman.com",
    "phone": "+1234567890",
    "description": "Cardiologist with 10+ years experience",
    "specialities": ["Cardiology", "Preventive Medicine"],
    "createdAt": "2026-03-20T10:00:00Z",
    "updatedAt": "2026-03-20T10:00:00Z"
  }
}
```

---

#### 2. Get All Doctors
```
GET /doctors
```

**Authorization:** Admin only

**Response (200 OK):**
```json
{
  "doctors": [ /* array of doctor objects */ ]
}
```

---

#### 3. Get Doctor by ID
```
GET /doctors/:id
```

**Authorization:** Doctor, Trainer

**URL Params:**
- `id` (string, required) — Doctor MongoDB ObjectId

**Response (200 OK):**
```json
{
  "doctor": { /* doctor object */ }
}
```

---

#### 4. Update Doctor
```
PATCH /doctors/:id
```

**Authorization:** Doctor, Trainer

**URL Params:**
- `id` (string, required) — Doctor MongoDB ObjectId

**Request Body (all fields optional):**
```json
{
  "doctorName": "Dr. Smith Updated",
  "description": "Cardiologist with 15+ years experience",
  "specialities": ["Cardiology", "Preventive Medicine", "Pediatric Cardiology"]
}
```

**Response (200 OK):**
```json
{
  "message": "Doctor updated successfully",
  "doctor": { /* updated doctor object */ }
}
```

---

#### 5. Delete Doctor
```
DELETE /doctors/:id
```

**Authorization:** Admin only

**Response (200 OK):**
```json
{
  "message": "Doctor deleted successfully"
}
```

---

## Trainer Routes

### Base Path: `/trainers`

**Global Requirements:**
- ✅ JWT Bearer token required for protected endpoints
- ❌ `/trainers/public` endpoints are unauthenticated
- Similar structure to Doctor routes

| Endpoint | POST | GET | PATCH | DELETE |
|----------|------|-----|-------|--------|
| `/trainers/public` | - | Public | - | - |
| `/trainers/public/:id` | - | Public | - | - |
| `/trainers` | Admin | Admin | - | - |
| `/trainers/:id` | - | Trainer, Doctor | Trainer, Doctor | Admin |

#### 0. Public Trainers
```
GET /trainers/public
GET /trainers/public/:id
```

**Authentication:** ❌ None

#### 1. Create Trainer
```
POST /trainers
```

**Authorization:** Admin only

**Request Body:**
```json
{
  "trainerName": "Coach John",
  "email": "john@hybridhuman.com",
  "phone": "+1234567890",
  "password": "trainerPass123",
  "description": "Fitness trainer specializing in HIIT",
  "specialities": ["HIIT", "Strength Training", "Yoga"]
}
```

**Response (201 Created):** Similar to Doctor creation

---

#### 2. Get All Trainers
```
GET /trainers
```

**Authorization:** Admin only

---

#### 3. Get Trainer by ID
```
GET /trainers/:id
```

**Authorization:** Trainer, Doctor

---

#### 4. Update Trainer
```
PATCH /trainers/:id
```

**Authorization:** Trainer, Doctor

---

#### 5. Delete Trainer
```
DELETE /trainers/:id
```

**Authorization:** Admin only

---

## Group Class Routes

### Base Path: `/api/v1`

**Global Requirements:**
- ✅ JWT Bearer token required for all endpoints
- ✅ Admin role required for `/admin/classes` CRUD & Publish endpoints
- ✅ Authenticated members (`user`, `trainer`, `doctor`, `admin`) can view active/published classes

#### 1. Create Group Class
```
POST /api/v1/admin/classes
```

**Authorization:** Admin only

**Request Body:**
```json
{
  "name": "Spinning Class Updated",
  "description": "High intensity cycling workout",
  "status": "ACTIVE",
  "creditCost": 4,
  "mode": "offline",
  "instructor": "Jane Doe",
  "durationMinutes": 60,
  "maxParticipants": 20,
  "tags": ["spin", "cardio"],
  "scheduleInfo": "Weekly: Mon, Wed 07:00 – 08:00",
  "slots": ["slot_uuid_1", "slot_uuid_2"],
  "locationAddress": "Room 2B, Main Gym",
  "enableWaitlist": false,
  "isPublished": true
}
```

**Response (201 Created):**
```json
{
  "message": "Class created",
  "class": {
    "_id": "010db997-dfd7-4798-9da9-b332765c0670",
    "name": "Spinning Class Updated",
    "description": "High intensity cycling workout",
    "status": "ACTIVE",
    "creditCost": 4,
    "isPublished": true,
    "createdAt": "2026-07-27T10:00:00.000Z",
    "updatedAt": "2026-07-27T10:00:00.000Z"
  }
}
```

---

#### 2. Get All Group Classes (Admin)
```
GET /api/v1/admin/classes
```

**Authorization:** Admin only  
**Description:** Retrieves all group classes regardless of status or publish state (includes drafts & retired classes).

---

#### 3. Update Group Class
```
PUT /api/v1/admin/classes/:id
```

**Authorization:** Admin only

**Request Body:**
```json
{
  "name": "HIIT Masterclass",
  "creditCost": 5,
  "maxParticipants": 15,
  "isPublished": true
}
```

---

#### 4. Publish / Unpublish Group Class
```
PATCH /api/v1/admin/classes/:id/publish
PATCH /api/v1/admin/classes/schedule/:id/publish
```

**Authorization:** Admin only  
**Description:** Toggles the `isPublished` state of a class/schedule session. Setting `isPublished: false` immediately hides the session from member app listings.

**Request Body:**
```json
{
  "isPublished": false
}
```

---

#### 5. Soft Delete / Retire Group Class
```
DELETE /api/v1/admin/classes/:id
```

**Authorization:** Admin only  
**Description:** Marks the class status as `INACTIVE`.

---

#### 6. Get Active & Published Group Classes (Members)
```
GET /api/v1/classes
```

**Authorization:** Authenticated Users (`user`, `trainer`, `doctor`, `admin`)  
**Description:** Retrieves only active (`status: ACTIVE`) and published (`isPublished: true`) group classes for member display.

---

#### 7. Get Group Class Details by ID
```
GET /api/v1/classes/:id
```

**Authorization:** Authenticated Users

---

## Slot Routes

### Base Path: `/slots`

**Global Requirements:**
- ✅ JWT Bearer token required for all slot endpoints
- ✅ Admin role required for `POST`, `PATCH`, and `DELETE`

#### 1. Create Slot
```
POST /slots
```

**Authorization:** Admin only

**Request Body:**
```json
{
  "isDaily": true,
  "startTime": "09:00",
  "endTime": "10:00",
  "capacity": 3,
  "isBooked": false
}
```

**Notes:**
- `isDaily` defaults to `true` when `date` is omitted.
- `date` is optional and only needed for one-off (non-recurring) slots.
- `capacity` is optional and defaults to `1`.
- `remainingCapacity` is initialized from `capacity`.
- `isBooked` is derived from `remainingCapacity <= 0`.

**Response (201 Created):**
```json
{
  "message": "Slot created successfully",
  "slot": {
    "_id": "507f1f77bcf86cd799439020",
    "isDaily": true,
    "startTime": "09:00",
    "endTime": "10:00",
    "capacity": 3,
    "remainingCapacity": 3,
    "isBooked": false,
    "createdAt": "2026-03-20T10:00:00Z",
    "updatedAt": "2026-03-20T10:00:00Z"
  }
}
```

---

#### 2. Get All Slots
```
GET /slots
```

**Authorization:** Admin, Doctor, Trainer, User
#### 2a. Get Available Slots (by date)
```
GET /slots/available?date=YYYY-MM-DD
```

**Authorization:** Admin, Doctor, Trainer, User

**Response (200 OK):**
```json
{
  "date": "2026-06-01T00:00:00.000Z",
  "slots": [
    {
      "slotId": "507f1f77bcf86cd799439020",
      "date": "2026-06-01T00:00:00.000Z",
      "startTime": "09:00",
      "endTime": "09:30",
      "capacity": 4,
      "remainingCapacity": 4
    }
  ]
}
```


**Response (200 OK):**
```json
{
  "slots": [ /* array of slot objects */ ]
}
```

---

#### 3. Get Slot by ID
```
GET /slots/:id
```

**Authorization:** Admin, Doctor, Trainer, User

---

#### 4. Update Slot
```
PATCH /slots/:id
```

**Authorization:** Admin only

**Request Body (all fields optional):**
```json
{
  "isDaily": true,
  "startTime": "10:00",
  "endTime": "11:00",
  "capacity": 4,
  "remainingCapacity": 2,
  "isBooked": true
}
```

**Notes:**
- `remainingCapacity` cannot exceed `capacity`.
- `isBooked` should be treated as derived state (`remainingCapacity <= 0`).

---

#### 5. Delete Slot
```
DELETE /slots/:id
```

**Authorization:** Admin only

---

## Membership Routes

### Base Path: `/memberships`

**Global Requirements:**
- ✅ JWT Bearer token required
- ✅ Role-based: `admin` for admin endpoints; users can only view their memberships

**Membership Status Values:** `Active`, `Paused`, `Cancelled`, `Expired`

#### 1. Create Membership (Admin)
```
POST /memberships
```

**Authorization:** Admin only

**Request Body:**
```json
{
  "userId": "507f1f77bcf86cd799439011",
  "planName": "Gold Plan",
  "creditsIncluded": 12,
  "price": 49.99,
  "currency": "USD",
  "status": "Active",
  "startDate": "2026-04-01",
  "endDate": "2026-07-01",
  "features": ["unlimited-sessions", "priority-support"],
  "notes": "Spring promo"
}
```

**Credit Notes:**
- `creditsIncluded` defaults to `0` if omitted.
- `creditsRemaining` is initialized to `creditsIncluded` on create.

**Responses:**
- `201` — Created; returns membership
- `400` — Invalid payload, invalid dates, or missing `userId`
- `401` — Unauthorized

**Response (201 Created) Example:**
```json
{
  "message": "Membership created",
  "membership": {
    "_id": "507f1f77bcf86cd799439101",
    "user": "507f1f77bcf86cd799439011",
    "planName": "Gold Plan",
    "creditsIncluded": 12,
    "creditsRemaining": 12,
    "status": "Active",
    "price": 49.99,
    "currency": "USD",
    "startDate": "2026-04-01T00:00:00.000Z",
    "endDate": "2026-07-01T00:00:00.000Z",
    "features": ["unlimited-sessions", "priority-support"],
    "notes": "Spring promo"
  }
}
```

#### 2. Get All Memberships (Admin)
```
GET /memberships
```

**Authorization:** Admin

**Responses:**
- `200` — `{ memberships: [...] }`
- `401` / `403` — Unauthorized / Forbidden

#### 3. Get My Memberships (User)
```
GET /memberships/me
```

**Authorization:** User

**Responses:**
- `200` — Memberships for the authenticated user
- `403` — If role is not `user`

#### 4. Get Membership by ID (Admin)
```
GET /memberships/:id
```

**Authorization:** Admin

**Responses:**
- `200` — Returns membership
- `400` — Invalid id
- `404` — Not found

#### 5. Update Membership (Admin)
```
PATCH /memberships/:id
```

**Authorization:** Admin

**Request Body:** Any subset of fields from create payload; at least one field required.

**Credit Notes:**
- If `creditsIncluded` changes, backend adjusts `creditsRemaining` by the same delta.
- `creditsRemaining` never drops below `0`.

**Responses:**
- `200` — Updated membership
- `400` — Invalid payload/ids/dates
- `404` — Not found

#### 6. Delete Membership (Admin)
```
DELETE /memberships/:id
```

**Authorization:** Admin

**Responses:**
- `200` — Deleted
- `400` — Invalid id
- `404` — Not found

---

## Service Routes

### Base Path: `/services`

**Global Requirements:**
- ✅ JWT Bearer token required for protected endpoints
- ❌ `/therapies/public` endpoints are unauthenticated
- ✅ Admin creates/updates/deletes; all roles can read

#### 0. Public Therapies
```
GET /therapies/public
GET /therapies/public/:id
```

**Authentication:** ❌ None

**Implementation Notes:**
- Therapies are persisted in the same underlying collection as services with `serviceType = "Therapy"`.
- The therapy `_id` returned by `/therapies` is a valid `serviceId` for `/bookings` and `/appointments`.

#### 1. Create Service
```
POST /services
```

**Authorization:** Admin only

**Request Body:**
```json
{
  "serviceName": "Body Composition Analysis",
  "serviceTime": 45,
  "creditCost": 2,
  "description": "Includes BMI, body fat %, muscle mass",
  "tags": ["assessment", "baseline"],
  "slots": ["507f1f77bcf86cd799439020"]
}
```

**Credit Notes:**
- `creditCost` is required by schema and defaults to `1` when omitted.
- Booking and appointment credit deduction uses this value.

#### 2. Get All Services
```
GET /services
```

**Authorization:** Admin, Doctor, Trainer, User

#### 3. Get Service by ID
```
GET /services/:id
```

**Authorization:** Admin, Doctor, Trainer, User

#### 4. Update Service
```
PATCH /services/:id
```

**Authorization:** Admin only

**Notes:** Any subset of fields from create payload; at least one field required.

**Credit Notes:**
- `creditCost` can be updated to change future deduction behavior.

#### 5. Delete Service
```
DELETE /services/:id
```

**Authorization:** Admin only

---

## Therapy Routes

### Base Path: `/therapies`

**Global Requirements:**
- ✅ JWT Bearer token required
- ✅ Admin creates/updates/deletes; all roles can read

#### 1. Create Therapy
```
POST /therapies
```

**Authorization:** Admin only

**Request Body:**
```json
{
  "therapyName": "Deep Tissue Massage",
  "therapyTime": 60,
  "creditCost": 2,
  "description": "Focus on muscle recovery",
  "tags": ["recovery", "massage"],
  "slots": ["507f1f77bcf86cd799439020"]
}
```

**Credit Notes:**
- `creditCost` is optional and defaults to `1` when omitted.
- Booking and appointment deduction uses this value when the therapy `_id` is used as `serviceId`.

#### 2. Get All Therapies
```
GET /therapies
```

**Authorization:** Admin, Doctor, Trainer, User

#### 3. Get Therapy by ID
```
GET /therapies/:id
```

**Authorization:** Admin, Doctor, Trainer, User

#### 4. Update Therapy
```
PATCH /therapies/:id
```

**Authorization:** Admin only

**Notes:** Any subset of fields from create payload; at least one field required.

**Credit Notes:**
- `creditCost` can be updated to change future deduction behavior.

#### 5. Delete Therapy
```
DELETE /therapies/:id
```

**Authorization:** Admin only

---

## Lead Routes

### Base Path: `/leads`

**Global Requirements:**
- ✅ `POST /leads/public-capture` is public (no auth)
- ✅ All other lead endpoints require JWT Bearer authentication
- ✅ Admin can list/delete/convert; Admin/Doctor/Trainer can create/read/update
- **Lead Status Values:** `New`, `Contacted`, `Qualified`, `Warm`, `Hot`, `Cold`, `Converted`, `Lost`

#### 1. Public Lead Capture
```
POST /leads/public-capture
```

**Authentication:** ❌ None  
**Authorization:** N/A

**Request Body A (fitflix.in health score form):**
```json
{
  "formType": "healthscore",
  "personalDetails": {
    "fullName": "Arjun Sharma",
    "phoneNumber": "+91 98765 43210",
    "emailAddress": "arjun@email.com",
    "age": 32,
    "gender": "Male",
    "city": "Hyderabad",
    "primaryHealthGoal": "Longevity & Disease Prevention",
    "fitnessLevel": "Intermediate (6mo - 2yrs)",
    "wellnessInterests": ["Yoga & Mindfulness", "Sleep Optimisation"],
    "notes": "Mild lower-back stiffness"
  },
  "assessment": {
    "version": "v1_quick_vitality_check",
    "answers": {
      "v1_q1": 3,
      "v1_q2": 3,
      "v1_q3": 2,
      "v1_q4": 3,
      "v1_q5": 2,
      "v1_q6": 3,
      "v1_q7": 2
    }
  },
  "source": "fitflix.in",
  "tags": ["website", "campaign-april"],
  "followUpDate": "2026-04-15T00:00:00Z",
  "captchaToken": "<token-from-client-captcha>",
  "website": ""
}
```

**Request Body B (plain callback form):**
```json
{
  "formType": "callback",
  "name": "Arjun Sharma",
  "phone": "+91 98765 43210",
  "email": "arjun@email.com",
  "interests": ["Nutrition & Diet", "Sleep Optimisation"],
  "source": "fitflix.in",
  "tags": ["website", "call-me"],
  "captchaToken": "<token-from-client-captcha>",
  "website": ""
}
```

**Compatibility Notes:**
- Plain callback supports `name`, `phone`, `email`, and `interests` array.
- `intrests` is also accepted as a compatibility alias for `interests`.
- Legacy shape with top-level `leadName` + `email` is still accepted.
- `assessment.version` supports `v1_quick_vitality_check` and `v2_deep_longevity_assessment`.
- `assessment.answers` must include all required question IDs for the selected version, with score values from `1` to `4`.

**Security Behavior:**
- IP-based rate limit is applied.
- Captcha verification is temporarily disabled for MVP testing.
- `website` is a honeypot field. If non-empty, the API returns `202` but ignores the payload.
- Health score and brand tier are computed automatically when `assessment` is provided.

**Response (202 Accepted):**
```json
{
  "message": "Lead captured",
  "leadId": "507f1f77bcf86cd799439011",
  "healthScore": {
    "overallScore": 64,
    "categoryScores": {
      "Movement": 75,
      "Nutrition": 75,
      "Sleep": 50,
      "Mental Wellness": 75,
      "Hydration": 50,
      "Recovery": 75,
      "Energy": 50
    },
    "brand": "SHA Wellness Clinic",
    "tier": "Medical Nutrition & Longevity Science"
  }
}
```

#### 2. Create Lead
```
POST /leads
```

**Authorization:** Admin, Doctor, Trainer

**Request Body:**
```json
{
  "leadName": "Jane Prospect",
  "email": "jane@example.com",
  "phone": "+1234567890",
  "source": "Landing Page",
  "interestedIn": "Premium Membership",
  "notes": "Prefers evening calls",
  "tags": ["premium", "warm"],
  "followUpDate": "2026-04-05T00:00:00Z",
  "ownerId": "507f1f77bcf86cd799439099"
}
```

#### 3. Get All Leads
```
GET /leads
```

**Authorization:** Admin only

#### 3a. Get Lead Stats
```
GET /leads/stats
```

**Authorization:** Admin only

**Response (200 OK):**
```json
{
  "byStatus": { "New": 42, "Warm": 11, "Converted": 9 },
  "bySource": { "fitflix.in": 30, "app-signup": 18 },
  "signupFunnel": [
    { "_id": { "onboarded": true, "currentStep": "COMPLETED" }, "count": 5 }
  ]
}
```

#### 4. Get Lead by ID
```
GET /leads/:id
```

**Authorization:** Admin, Doctor, Trainer

#### 5. Update Lead
```
PATCH /leads/:id
```

**Authorization:** Admin, Doctor, Trainer

**Notes:** Any subset of fields from create payload; at least one field required.
**Field Notes:** `followUpDate` accepts ISO 8601 date-time strings.

#### 6. Delete Lead
```
DELETE /leads/:id
```

**Authorization:** Admin only

#### 7. Convert Lead to User
```
POST /leads/:id/convert
```

**Authorization:** Admin only

**Request Body:**
```json
{
  "username": "jane_member", // optional, defaults to leadName
  "phone": "+1234567890",
  "age": "32",
  "gender": "Female",
  "healthGoals": ["weight loss", "sleep"],
  "password": "securePass"
}
```

**Behavior:**
- If a user already exists with the lead email, the lead links to that user and is marked `Converted`.
- Otherwise, a new user is created with the provided details and the lead is marked `Converted`.

---

## Booking Routes

### Base Path: `/bookings`

**Global Requirements:**
- ✅ JWT Bearer token required for all endpoints

#### 1. Create Booking
```
POST /bookings
```

**Authorization:** User (own), Admin (any user)

**Request Body:**
```json
{
  "bookingDate": "2026-03-25T10:00:00Z",
  "userId": "507f1f77bcf86cd799439011",
  "slotId": "507f1f77bcf86cd799439020",
  "serviceId": "507f1f77bcf86cd799439030",
  "reportId": "507f1f77bcf86cd799439040",
  "bypassCredits": false
}
```

**Notes:**
- `userId` — Required for admin. Optional for users (uses their ID).
- `reportId` — Optional field.
- `bypassCredits` — Optional; only admins can set `true`.
- `serviceId` can be either a regular service ID (from `/services`) or a therapy ID (from `/therapies`) because both are stored under the same bookable service identity.
- `slotId` can be a one-off slot instance or a daily slot template ID.
- When `slotId` references a daily template, backend resolves/creates a dated slot inventory record for `bookingDate` and books against that concrete record.
- Credit consumption amount is read from `service.creditCost`.
- Booking creation atomically decrements slot `remainingCapacity` by `1`.
- If slot `remainingCapacity` is `0`, booking creation must fail.

**Response (201 Created):**
```json
{
  "message": "Booking created",
  "booking": {
    "_id": "507f1f77bcf86cd799439050",
    "bookingDate": "2026-03-25T10:00:00Z",
    "startTime": "10:00",
    "endTime": "11:00",
    "status": 0,
    "user": "507f1f77bcf86cd799439011",
    "slot": "507f1f77bcf86cd799439020",
    "service": "507f1f77bcf86cd799439030",
    "report": "507f1f77bcf86cd799439040",
    "creditCostSnapshot": 2,
    "creditsBypassed": false,
    "createdAt": "2026-03-20T10:00:00Z",
    "updatedAt": "2026-03-20T10:00:00Z"
  },
  "credits": {
    "consumed": 2,
    "bypassed": false
  }
}
```

**Error Responses:**
- `402` — Insufficient credits.
- `403` — No active membership with available credits, or non-admin bypass attempt.
- `404` — Service not found.
- `409` — Slot is full or no longer available.

---

#### 2. Get All Bookings
```
GET /bookings
```

**Authorization:** Admin only

---

#### 3. Get My Bookings
```
GET /bookings/me
```

**Authorization:** User only

**Response (200 OK):**
```json
{
  "bookings": [ /* array of current user's bookings */ ]
}
```

---

#### 4. Get Booking by ID
```
GET /bookings/:id
```

**Authorization:** Admin only

---

#### 5. Update Booking (Reschedule)
```
PATCH /bookings/:id
```

**Authorization:** Admin (any user) or User (self only)

**Request Body (all fields optional; at least one required):**
```json
{
  "bookingDate": "2026-03-26T10:00:00Z",
  "slotId": "507f1f77bcf86cd799439021",
  "serviceId": "507f1f77bcf86cd799439031",
  "reportId": "507f1f77bcf86cd799439041"
}
```

**Reschedule Logic (when `slotId` or `bookingDate` changes):**
- New slot is validated against the service slot list
- New slot capacity is reserved (decremented by 1)
- Old slot capacity is released (incremented by 1)
- If slot is a daily template, a dated concrete slot inventory record is resolved/created for the new `bookingDate`
- If the booking was previously cancelled, reschedule rebooks it: status is set to `Booked` and credits are consumed again (unless credits were bypassed)
- If any validation fails (slot full, slot not linked to service), old slot remains unchanged
- On error, any newly reserved slot capacity is automatically released (rollback)

**Response (200 OK):**
```json
{
  "message": "Booking updated",
  "booking": {
    "_id": "507f1f77bcf86cd799439050",
    "bookingDate": "2026-03-26T10:00:00Z",
    "startTime": "10:00",
    "endTime": "11:00",
    "status": 0,
    "user": "507f1f77bcf86cd799439011",
    "slot": "507f1f77bcf86cd799439021",
    "service": "507f1f77bcf86cd799439031",
    "report": "507f1f77bcf86cd799439041",
    "creditCostSnapshot": 2,
    "creditsBypassed": false,
    "createdAt": "2026-03-20T10:00:00Z",
    "updatedAt": "2026-03-21T11:00:00Z"
  }
}
```

**Error Responses:**
- `403` — Forbidden (user trying to update another user's booking)
- `404` — Booking or service not found
- `409` — Slot is full or no longer available, or slot not linked to service

---

#### 6. Delete Booking
```
DELETE /bookings/:id
```

**Authorization:** Admin only

**Behavior:**
- If the booking is not already cancelled, delete first applies cancellation compensation: refund consumed credits once and release one slot capacity for the dated inventory slot.
- If the booking is already cancelled, delete does not apply additional compensation.

---

#### 7. Change Booking Status
```
PATCH /bookings/:id/status
```

**Authorization:** Admin only

**Request Body:**
```json
{
  "status": 1
}
```

**Behavior:**
- When status transitions to `Cancelled`, credits previously consumed for that booking are refunded once.
- When status transitions to `Cancelled`, one slot capacity is released back to the same dated slot inventory record.
- Cancellation compensation is idempotent for repeated cancel requests. Subsequent cancel requests return `refunded: 0`.
- Cancelled bookings cannot be reactivated via this endpoint. Use reschedule to rebook (returns `409`).

**Response (200 OK) Example:**
```json
{
  "message": "Booking status changed",
  "booking": {
    "_id": "507f1f77bcf86cd799439050",
    "status": 2
  },
  "credits": {
    "refunded": 2
  }
}
```

**Status Values:**
- `0` — Booked
- `1` — Confirmed
- `2` — Cancelled
- `3` — Attended
- `4` — Unattended

---

## Appointment Routes

### Base Path: `/appointments`

**Global Requirements:**
- ✅ JWT Bearer token required for all endpoints

#### 1. Create Appointment
```
POST /appointments
```

**Authorization:** Admin only

**Request Body:**
```json
{
  "appointmentDate": "2026-03-25T10:00:00Z",
  "userId": "507f1f77bcf86cd799439011",
  "slotId": "507f1f77bcf86cd799439020",
  "doctorId": "507f1f77bcf86cd799439012",
  "serviceId": "507f1f77bcf86cd799439030",
  "reportId": "507f1f77bcf86cd799439040",
  "bypassCredits": false
}
```

**Notes:**
- `serviceId` is optional. If provided, credits consumed use `service.creditCost`.
- If `serviceId` is not provided, default deduction is `1` credit.
- `bypassCredits` is optional and admin-only.
- `serviceId` may point to a regular service (`/services`) or therapy (`/therapies`) ID.
- `slotId` can be a one-off slot instance or a daily slot template ID.
- When `slotId` references a daily template, backend resolves/creates a dated slot inventory record for `appointmentDate` and books against that concrete record.
- Appointment creation uses the same slot-capacity pool as bookings and atomically decrements `remainingCapacity` by `1`.
- If slot capacity is unavailable, appointment creation fails.

**Response (201 Created) Example:**
```json
{
  "message": "Appointment created",
  "appointment": {
    "_id": "507f1f77bcf86cd799439150",
    "appointmentDate": "2026-03-25T10:00:00Z",
    "startTime": "10:00",
    "endTime": "11:00",
    "status": 0,
    "user": "507f1f77bcf86cd799439011",
    "slot": "507f1f77bcf86cd799439020",
    "doctor": "507f1f77bcf86cd799439012",
    "service": "507f1f77bcf86cd799439030",
    "report": "507f1f77bcf86cd799439040",
    "creditCostSnapshot": 2,
    "creditsBypassed": false
  },
  "credits": {
    "consumed": 2,
    "bypassed": false
  }
}
```

---

## Expert Appointment Routes

### Base Path: `/expert-appointments`

**Global Requirements:**
- ✅ JWT Bearer token required for all endpoints

#### 1. Availability
```
GET /expert-appointments/availability
```

**Authentication:** ✅ User

**Query Parameters:**
```txt
expertType: "nutritionist" | "sports_scientist"
startDate: YYYY-MM-DD
endDate: YYYY-MM-DD
timezone: e.g. "Asia/Kolkata"
```

**Response (200 OK):**
```json
{
  "days": [
    {
      "date": "YYYY-MM-DD",
      "slots": [
        { "start": "ISO_timestamp_string", "end": "ISO_timestamp_string" }
      ]
    }
  ]
}
```

---

#### 2. Book
```
POST /expert-appointments/book
```

**Authentication:** ✅ User

**Request Body:**
```json
{
  "expertType": "nutritionist" | "sports_scientist",
  "slotStart": "ISO_timestamp_string",
  "timezone": "Asia/Kolkata"
}
```

---

#### 3. Get My Expert Appointment
```
GET /expert-appointments/me
```

**Authentication:** ✅ User

---

#### 4. Reschedule
```
PATCH /expert-appointments/:id/reschedule
```

**Authentication:** ✅ User

**Request Body:**
```json
{
  "slotStart": "ISO_timestamp_string",
  "timezone": "Asia/Kolkata",
  "reason": "optional string"
}
```

---

#### 5. Cancel
```
PATCH /expert-appointments/:id/cancel
```

**Authentication:** ✅ User

**Request Body:**
```json
{
  "reason": "optional string"
}
```

---

### Admin Routes: `/admin/expert-appointments`

#### 6. List Expert Appointments
```
GET /admin/expert-appointments
```

**Authentication:** ✅ Admin

---

#### 7. Get Expert Appointment by ID
```
GET /admin/expert-appointments/:id
```

**Authentication:** ✅ Admin

---

#### 8. Cancel Expert Appointment
```
PATCH /admin/expert-appointments/:id/cancel
```

**Authentication:** ✅ Admin

**Error Responses:**
- `402` — Insufficient credits.
- `403` — No active membership with available credits, or non-admin bypass attempt.
- `404` — Service not found (when `serviceId` is provided).
- `409` — Slot is full or no longer available.

---

#### 2. Get All Appointments
```
GET /appointments
```

**Authorization:** Admin only

---

#### 3. Get My Appointments
```
GET /appointments/me
```

**Authorization:** Doctor only

**Response (200 OK):**
```json
{
  "appointments": [ /* array of doctor's appointments */ ]
}
```

---

#### 4. Get Appointment by ID
```
GET /appointments/:id
```

**Authorization:** Admin only

---

#### 5. Update Appointment (Reschedule)
```
PATCH /appointments/:id
```

**Authorization:** Admin (any appointment) or User (self only)

**Request Body (all fields optional; at least one required):**
```json
{
  "appointmentDate": "2026-03-26T10:00:00Z",
  "slotId": "507f1f77bcf86cd799439021",
  "doctorId": "507f1f77bcf86cd799439013",
  "serviceId": "507f1f77bcf86cd799439031",
  "reportId": "507f1f77bcf86cd799439041"
}
```

**Reschedule Logic (when `slotId` or `appointmentDate` changes):**
- New slot is validated against the service slot list (if a service is linked)
- New slot capacity is reserved (decremented by 1)
- Old slot capacity is released (incremented by 1)
- If slot is a daily template, a dated concrete slot inventory record is resolved/created for the new `appointmentDate`
- If the appointment was previously cancelled, reschedule rebooks it: status is set to `Booked` and credits are consumed again (unless credits were bypassed)
- If any validation fails (slot full, slot not linked to service), old slot remains unchanged
- On error, any newly reserved slot capacity is automatically released (rollback)

**Response (200 OK):**
```json
{
  "message": "Appointment updated",
  "appointment": {
    "_id": "507f1f77bcf86cd799439150",
    "appointmentDate": "2026-03-26T10:00:00Z",
    "startTime": "10:00",
    "endTime": "11:00",
    "status": 0,
    "user": "507f1f77bcf86cd799439011",
    "slot": "507f1f77bcf86cd799439021",
    "doctor": "507f1f77bcf86cd799439013",
    "service": "507f1f77bcf86cd799439031",
    "report": "507f1f77bcf86cd799439041",
    "creditCostSnapshot": 2,
    "creditsBypassed": false,
    "createdAt": "2026-03-20T10:00:00Z",
    "updatedAt": "2026-03-21T11:00:00Z"
  }
}
```

**Error Responses:**
- `403` — Forbidden (user trying to update another user's appointment)
- `404` — Appointment, service, or doctor not found
- `409` — Slot is full or no longer available, or slot not linked to service

---

#### 6. Delete Appointment
```
DELETE /appointments/:id
```

**Authorization:** Admin only

**Behavior:**
- If the appointment is not already cancelled, delete first applies cancellation compensation: refund consumed credits once and release one slot capacity for the dated inventory slot.
- If the appointment is already cancelled, delete does not apply additional compensation.

---

#### 7. Change Appointment Status
```
PATCH /appointments/:id/status
```

**Authorization:** Admin, Doctor

**Request Body:**
```json
{
  "status": 1
}
```

**Behavior:**
- When status transitions to `Cancelled`, credits previously consumed for that appointment are refunded once.
- When status transitions to `Cancelled`, one slot capacity is released back to the same dated slot inventory record.
- Cancellation compensation is idempotent for repeated cancel requests. Subsequent cancel requests return `refunded: 0`.
- Cancelled appointments cannot be reactivated via this endpoint. Use reschedule to rebook (returns `409`).

**Response (200 OK) Example:**
```json
{
  "message": "Appointment status changed",
  "appointment": {
    "_id": "507f1f77bcf86cd799439150",
    "status": 2
  },
  "credits": {
    "refunded": 2
  }
}
```

**Status Values:** (See Booking status values)

---

## Credit Routes

### Base Path: `/credits`

**Global Requirements:**
- ✅ JWT Bearer token required
- ✅ Users can access only their own credit endpoints (`/me/*`)
- ✅ Admin can access any user credit endpoints (`/users/:userId/*`)

#### 1. Get My Credit Balance
```
GET /credits/me/balance
```

**Authorization:** User only

**Response (200 OK) Example:**
```json
{
  "userId": "507f1f77bcf86cd799439011",
  "totalIncluded": 12,
  "totalRemaining": 9,
  "memberships": [
    {
      "id": "507f1f77bcf86cd799439101",
      "planName": "Gold Plan",
      "creditsIncluded": 12,
      "creditsRemaining": 9,
      "endDate": "2026-07-01T00:00:00.000Z"
    }
  ]
}
```

---

#### 2. Get My Credit History
```
GET /credits/me/history?limit=50&sourceType=Booking
```

**Authorization:** User only

**Query Params:**
- `limit` (optional, number, min `1`, max `200`, default `50`)
- `sourceType` (optional): `Booking` | `Appointment` | `Admin`

**Response (200 OK) Example:**
```json
{
  "userId": "507f1f77bcf86cd799439011",
  "count": 2,
  "transactions": [
    {
      "id": "507f1f77bcf86cd799439501",
      "membershipId": "507f1f77bcf86cd799439101",
      "amount": -2,
      "type": "Consume",
      "sourceType": "Booking",
      "sourceId": "507f1f77bcf86cd799439050",
      "reason": "Booking 507f1f77bcf86cd799439050",
      "actorId": "507f1f77bcf86cd799439011",
      "actorRole": "user",
      "createdAt": "2026-04-11T09:00:00.000Z"
    }
  ]
}
```

---

#### 3. Get User Credit Balance (Admin)
```
GET /credits/users/:userId/balance
```

**Authorization:** Admin only

**Responses:**
- `200` — Balance details for the target user
- `400` — Invalid `userId`

---

#### 4. Get User Credit History (Admin)
```
GET /credits/users/:userId/history?limit=100&sourceType=Appointment
```

**Authorization:** Admin only

**Query Params:** same as `/credits/me/history`

**Responses:**
- `200` — Credit transaction history for the target user
- `400` — Invalid `userId` or query params

---

#### 5. Top Up User Credits (Admin)
```
POST /credits/users/:userId/topup
```

**Authorization:** Admin only

**Request Body:**
```json
{
  "membershipId": "507f1f77bcf86cd799439101",
  "amount": 5,
  "reason": "Manual goodwill top-up"
}
```

**Notes:**
- `membershipId` is optional; when omitted, backend tops up the earliest-expiring eligible active membership.
- `amount` must be positive.

**Response (200 OK) Example:**
```json
{
  "message": "Credits topped up",
  "membershipId": "507f1f77bcf86cd799439101",
  "toppedUp": 5,
  "creditsRemaining": 14
}
```

**Error Responses:**
- `400` — Invalid payload or IDs
- `404` — No eligible membership found for top-up

---

## Schedule Routes

### Base Path: `/schedules`

**Global Requirements:**
- ✅ JWT Bearer token required for all endpoints

#### 1. Get My Schedule
```
GET /schedules/my-schedule
```

**Authorization:** All authenticated users

**Response (200 OK):**
```json
{
  "message": "Schedule retrieved",
  "schedule": {
    "_id": "507f1f77bcf86cd799439060",
    "user": {
      "_id": "507f1f77bcf86cd799439011",
      "username": "john_doe",
      "email": "john@example.com"
    },
    "scheduledDate": "2026-03-25T00:00:00Z",
    "status": 0,
    "todos": [ /* array of todo objects */ ],
    "createdAt": "2026-03-20T10:00:00Z",
    "updatedAt": "2026-03-20T10:00:00Z"
  }
}
```

---

#### 2. Create Schedule
```
POST /schedules
```

**Authorization:** User (own), Doctor/Trainer/Admin (any user)

**Request Body:**
```json
{
  "userId": "507f1f77bcf86cd799439011",
  "scheduledDate": "2026-03-25T00:00:00Z",
  "status": 0,
  "todoIds": ["507f1f77bcf86cd799439070", "507f1f77bcf86cd799439071"]
}
```

**Notes:**
- `status` — Optional, defaults to 0 (Todo)
- `todoIds` — Optional, defaults to empty array

**Response (201 Created):**
```json
{
  "message": "Schedule created successfully",
  "schedule": { /* schedule object with populated user and todos */ }
}
```

---

#### 3. Get Schedule by User ID
```
GET /schedules/:userId
```

**Authorization:** User (own), Doctor/Trainer/Admin (any user)

**URL Params:**
- `userId` (string, required) — User MongoDB ObjectId

**Response (200 OK):**
```json
{
  "message": "Schedule retrieved successfully",
  "schedule": { /* schedule object */ }
}
```

---

#### 4. Update Schedule
```
PATCH /schedules/:userId
```

**Authorization:** User (own), Doctor/Trainer/Admin (any user)

**URL Params:**
- `userId` (string, required) — User MongoDB ObjectId

**Request Body (all fields optional):**
```json
{
  "scheduledDate": "2026-03-26T00:00:00Z",
  "status": 1,
  "todoIds": ["507f1f77bcf86cd799439070"]
}
```

**Response (200 OK):**
```json
{
  "message": "Schedule updated successfully",
  "schedule": { /* updated schedule object */ }
}
```

---

#### 5. Reschedule (Within 7 Days)
```
PATCH /schedules/:userId/reschedule
```

**Authorization:** User (own), Doctor/Trainer/Admin (any user)

**URL Params:**
- `userId` (string, required) — User MongoDB ObjectId

**Request Body:**
```json
{
  "newScheduledDate": "2026-03-27T00:00:00Z"
}
```

**Business Logic:**
- New date must be within **next 7 days** (0-7 days from today)
- Returns `400` if date is beyond 7 days

**Response (200 OK):**
```json
{
  "message": "Schedule rescheduled successfully",
  "schedule": { /* rescheduled schedule object */ }
}
```

---

#### 6. Delete Schedule
```
DELETE /schedules/:userId
```

**Authorization:** Admin only

**URL Params:**
- `userId` (string, required) — User MongoDB ObjectId

**Response (200 OK):**
```json
{
  "message": "Schedule deleted successfully"
}
```

---

## Exercise Routes

### Base Path: `/exercises`

**Global Requirements:**
- ✅ JWT Authentication required for all endpoints
- ✅ Admin and User roles can access all endpoints
- System exercises are visible to all users and cannot be modified or deleted
- User-created exercises are private to the creator

#### 1. List Exercises
```
GET /exercises
```

**Authorization:** Admin, User

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `muscleGroup` | string | - | Filter by muscle group: `Chest`, `Back`, `Legs`, `Shoulders`, `Arms`, `Core`, `FullBody` |
| `difficulty` | string | - | Filter by difficulty: `Beginner`, `Intermediate`, `Advanced` |
| `section` | string | - | Filter by section the exercise can be used in: `warmup`, `workout`, `stretching` |
| `equipment` | string | - | Partial match (case-insensitive) on equipment field |
| `search` | string | - | Case-insensitive search on exercise name |
| `isSystem` | boolean | - | `true` = system only, `false` = user's own only, omit = both |
| `page` | number | 1 | Page number |
| `limit` | number | 50 | Items per page (max 100) |

**Response (200 OK):**
```json
{
  "exercises": [
    {
      "_id": "664a...",
      "name": "Bench Press",
      "muscleGroup": "Chest",
      "targetedMuscles": ["Pectoralis Major", "Anterior Deltoids", "Triceps"],
      "difficulty": "Intermediate",
      "equipment": "Barbell & Bench",
      "instructions": "Lie flat on a bench...",
      "commonMistakes": ["Bouncing the bar off the chest"],
      "tips": ["Keep your wrists straight..."],
      "caloriesPerSet": 12,
      "sectionTypes": ["workout"],
      "imageUrl": null,
      "isSystem": true,
      "createdBy": null,
      "createdAt": "2026-05-01T00:00:00Z",
      "updatedAt": "2026-05-01T00:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 87,
    "totalPages": 2
  }
}
```

---

#### 2. Get Exercise by ID
```
GET /exercises/:id
```

**Authorization:** Admin, User

**URL Params:**
- `id` (string, required) — Exercise MongoDB ObjectId

**Notes:**
- Returns the exercise if it is a system exercise or was created by the authenticated user.
- Returns `404` if the exercise is user-created and belongs to another user.

**Response (200 OK):**
```json
{
  "_id": "664a...",
  "name": "Bench Press",
  "muscleGroup": "Chest",
  "targetedMuscles": ["Pectoralis Major", "Anterior Deltoids", "Triceps"],
  "difficulty": "Intermediate",
  "equipment": "Barbell & Bench",
  "instructions": "Lie flat on a bench...",
  "commonMistakes": ["Bouncing the bar off the chest"],
  "tips": ["Keep your wrists straight..."],
  "caloriesPerSet": 12,
  "imageUrl": null,
  "isSystem": true,
  "createdBy": null,
  "createdAt": "2026-05-01T00:00:00Z",
  "updatedAt": "2026-05-01T00:00:00Z"
}
```

---

#### 3. Create Exercise
```
POST /exercises
```

**Authorization:** Admin, User

**Request Body:**
```json
{
  "name": "Lat Pulldown",
  "muscleGroup": "Back",
  "targetedMuscles": ["Latissimus Dorsi", "Biceps"],
  "difficulty": "Beginner",
  "equipment": "Cable Machine",
  "instructions": "Sit at the lat pulldown...",
  "commonMistakes": ["Leaning too far back"],
  "tips": ["Focus on pulling with your elbows"],
  "caloriesPerSet": 10,
  "imageUrl": "https://example.com/lat-pulldown.jpg"
}
```

**Validation Rules:**

| Field | Rule |
|-------|------|
| `name` | 1-100 chars, required |
| `muscleGroup` | Must be valid enum, required |
| `difficulty` | Must be valid enum, required |
| `equipment` | 1-200 chars, optional |
| `instructions` | Max 5000 chars, optional |
| `commonMistakes` | Array of max 20 strings, each max 500 chars |
| `tips` | Array of max 20 strings, each max 500 chars |
| `targetedMuscles` | Array of 1-10 strings, each max 100 chars |
| `caloriesPerSet` | 1-1000, integer, optional |
| `sectionTypes` | Array of 1-3 of `warmup`/`workout`/`stretching`, optional, default `["workout"]` |
| `imageUrl` | Valid URL, optional |

**Notes:**
- `isSystem` is forced to `false` — users cannot create system exercises.
- `createdBy` is set to the authenticated user's ID automatically.

**Response (201 Created):**
```json
{
  "_id": "664f...",
  "name": "Lat Pulldown",
  "muscleGroup": "Back",
  "isSystem": false,
  "createdBy": "663a...",
  ...
}
```

---

#### 4. Update Exercise
```
PUT /exercises/:id
```

**Authorization:** Admin, User (owner only)

**URL Params:**
- `id` (string, required) — Exercise MongoDB ObjectId

**Request Body (all fields optional; at least one required):**
```json
{
  "name": "Wide-Grip Lat Pulldown",
  "caloriesPerSet": 12
}
```

**Error Responses:**
- `403` — Cannot modify a system exercise
- `403` — Not authorized to modify this exercise (not the creator)
- `404` — Exercise not found

---

#### 5. Delete Exercise
```
DELETE /exercises/:id
```

**Authorization:** Admin, User (owner only)

**URL Params:**
- `id` (string, required) — Exercise MongoDB ObjectId

**Error Responses:**
- `403` — Cannot delete a system exercise
- `403` — Not authorized to delete this exercise (not the creator)
- `404` — Exercise not found

**Response (200 OK):**
```json
{
  "message": "Exercise deleted"
}
```

---

## Workout Routes

### Base Path: `/workouts`

**Global Requirements:**
- ✅ JWT Authentication required for all endpoints
- ✅ User role required for all endpoints
- All workout data is scoped to the authenticated user
- A user can have at most one `Active` session per calendar day (enforced by database index)

### Session Endpoints

#### 1. Get Today's Session
```
GET /workouts/today
```

**Authorization:** User only

**Behavior:**
- Returns the active session for today (UTC date) with full exercise and set data.
- If no active session exists for today, one is automatically created.

**Response (200 OK):**
```json
{
  "_id": "664b...",
  "userId": "663a...",
  "date": "2026-05-15T00:00:00Z",
  "status": "Active",
  "startedAt": "2026-05-15T07:30:00Z",
  "completedAt": null,
  "notes": null,
  "exercises": [
    {
      "_id": "664c...",
      "sessionId": "664b...",
      "exerciseId": "664a...",
      "exercise": {
        "name": "Bench Press",
        "muscleGroup": "Chest",
        "difficulty": "Intermediate",
        "equipment": "Barbell & Bench",
        "caloriesPerSet": 12
      },
      "orderIndex": 0,
      "targetSets": 4,
      "targetReps": 10,
      "targetWeightKg": 60.0,
      "restSeconds": 90,
      "isCompleted": false,
      "sets": [
        {
          "_id": "664d...",
          "setNumber": 1,
          "actualReps": 10,
          "actualWeightKg": 60.0,
          "rpe": 7.0,
          "isWarmup": false,
          "completedAt": "2026-05-15T07:35:22Z",
          "notes": null
        }
      ]
    }
  ],
  "createdAt": "2026-05-15T07:30:00Z",
  "updatedAt": "2026-05-15T07:30:00Z"
}
```

---

#### 2. List My Sessions
```
GET /workouts/me
```

**Authorization:** User only

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 20 | Items per page (max 100) |
| `status` | string | - | Filter by status: `Active`, `Completed`, `Abandoned` |

**Response (200 OK):**
```json
{
  "sessions": [
    {
      "_id": "664b...",
      "userId": "663a...",
      "date": "2026-05-15T00:00:00Z",
      "status": "Active",
      "startedAt": "2026-05-15T07:30:00Z",
      "completedAt": null,
      "notes": null,
      "createdAt": "2026-05-15T07:30:00Z",
      "updatedAt": "2026-05-15T07:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

---

#### 3. Get Session by ID
```
GET /workouts/:id
```

**Authorization:** User only (own sessions)

**URL Params:**
- `id` (string, required) — WorkoutSession MongoDB ObjectId

**Notes:**
- Returns full session detail including exercises and set logs (same structure as `GET /workouts/today`).
- Returns `403` if the session belongs to a different user.

---

#### 4. Create Session
```
POST /workouts
```

**Authorization:** User only

**Request Body:**
```json
{
  "date": "2026-05-15",
  "notes": "Chest and arms day",
  "exercises": [
    {
      "exerciseId": "664a...",
      "targetSets": 4,
      "targetReps": 10,
      "targetWeightKg": 60.0,
      "restSeconds": 90
    },
    {
      "exerciseId": "664a02...",
      "targetSets": 3,
      "targetReps": 12,
      "targetWeightKg": 15.0,
      "restSeconds": 60
    }
  ]
}
```

**Notes:**
- `date` is optional; defaults to today (UTC).
- `exercises` is optional; can create an empty session and add exercises later.
- If an active session already exists for the given date, the existing session is returned instead of creating a duplicate.
- Only exercises visible to the user (system + user's own) are added; invalid exercise IDs are silently skipped.

**Response (201 Created):** Full session object with exercises (same structure as `GET /workouts/today`).
**Response (200 OK):** If active session already exists for that date, returns existing session.

---

#### 5. Update Session
```
PATCH /workouts/:id
```

**Authorization:** User only (own sessions)

**Request Body (at least one field required):**
```json
{
  "status": "Completed",
  "notes": "Great session, felt strong"
}
```

**Notes:**
- When `status` transitions to `Completed`, `completedAt` is set automatically.
- Cannot reactivate a completed session (returns `409`).

**Error Responses:**
- `403` — Not authorized (not the session owner)
- `404` — Session not found
- `409` — Cannot reactivate a completed session

---

#### 6. Delete Session
```
DELETE /workouts/:id
```

**Authorization:** User only (own sessions)

**Notes:**
- Can only delete sessions with status `Active`.
- Cannot delete a session that has logged sets (returns `409`).
- Deleting a session also removes all its WorkoutExercise records.

**Error Responses:**
- `403` — Not authorized
- `404` — Session not found
- `409` — Can only delete active sessions / Cannot delete a session with logged sets

**Response (200 OK):**
```json
{
  "message": "Workout session deleted"
}
```

---

### Exercise-in-Session Endpoints

#### 7. Add Exercise to Session
```
POST /workouts/:sessionId/exercises
```

**Authorization:** User only

**URL Params:**
- `sessionId` (string, required) — WorkoutSession MongoDB ObjectId

**Request Body:**
```json
{
  "exerciseId": "664a...",
  "section": "warmup",
  "targetSets": 3,
  "targetReps": 12,
  "targetWeightKg": 40.0,
  "restSeconds": 60,
  "durationSeconds": 30,
  "notes": "Light pace"
}
```

**Validation:**

| Field | Rule |
|-------|------|
| `exerciseId` | Valid ObjectId, required |
| `section` | `warmup` \| `workout` \| `stretching`, optional, default `workout` |
| `targetSets` | 1-50, integer, required |
| `targetReps` | 1-100, integer, required |
| `targetWeightKg` | 0-999.99, optional |
| `restSeconds` | 0-600, integer, default 60 |
| `durationSeconds` | 1-86400, integer, optional (time-based entries) |
| `notes` | string, max 500, optional |

**Notes:**
- Session must be `Active`.
- `orderIndex` is auto-assigned (appended to end).
- The exercise must be visible to the user (system or user-created).
- `PATCH /workouts/:sessionId/exercises/:id` additionally accepts
  `section`, `durationSeconds`, `notes`, `caloriesBurned`, `isCompleted`.

**Response (201 Created):**
```json
{
  "_id": "664c...",
  "sessionId": "664b...",
  "exerciseId": "664a...",
  "orderIndex": 2,
  "section": "warmup",
  "targetSets": 3,
  "targetReps": 12,
  "targetWeightKg": 40.0,
  "restSeconds": 60,
  "durationSeconds": 30,
  "notes": "Light pace",
  "caloriesBurned": null,
  "isCompleted": false,
  "createdAt": "2026-05-15T07:45:00Z"
}
```

---

#### 8. Update Workout Exercise
```
PATCH /workouts/:sessionId/exercises/:id
```

**Authorization:** User only

**URL Params:**
- `sessionId` (string, required) — WorkoutSession ObjectId
- `id` (string, required) — WorkoutExercise ObjectId

**Request Body (at least one field required):**
```json
{
  "targetSets": 4,
  "targetReps": 8,
  "targetWeightKg": 65.0,
  "restSeconds": 120
}
```

---

#### 9. Delete Workout Exercise
```
DELETE /workouts/:sessionId/exercises/:id
```

**Authorization:** User only

**Notes:**
- Also deletes all associated SetLog records for this exercise.

**Response (200 OK):**
```json
{
  "message": "Exercise removed from session"
}
```

---

#### 10. Reorder Exercises
```
PATCH /workouts/:sessionId/exercises/reorder
```

**Authorization:** User only

**Request Body:**
```json
{
  "order": ["664c01...", "664c02...", "664c03..."]
}
```

**Notes:**
- `order` is an array of WorkoutExercise IDs in the desired display order.
- All IDs must belong to the specified session.

**Response (200 OK):** Array of updated WorkoutExercise objects sorted by new order.

---

### Set Logging Endpoints

#### 11. Log a Set
```
POST /workouts/:sessionId/exercises/:exerciseId/sets
```

**Authorization:** User only

**URL Params:**
- `sessionId` (string, required) — WorkoutSession ObjectId
- `exerciseId` (string, required) — WorkoutExercise ObjectId

**Request Body:**
```json
{
  "actualReps": 10,
  "actualWeightKg": 62.5,
  "rpe": 8.0,
  "isWarmup": false,
  "notes": "Felt strong"
}
```

**Validation:**

| Field | Rule |
|-------|------|
| `actualReps` | 1-999, integer, required |
| `actualWeightKg` | 0-999.99, float (0 = bodyweight), required |
| `rpe` | 1.0-10.0, float, optional |
| `isWarmup` | boolean, default false |
| `notes` | Max 500 chars, optional |

**Notes:**
- `setNumber` is auto-incremented.
- `completedAt` is set automatically.
- Session must be `Active`.
- Weight is always stored in kg.
- When the number of non-warmup sets reaches `targetSets`, the exercise is automatically marked as completed.

**Response (201 Created):**
```json
{
  "_id": "664d...",
  "workoutExerciseId": "664c...",
  "setNumber": 2,
  "actualReps": 10,
  "actualWeightKg": 62.5,
  "rpe": 8.0,
  "isWarmup": false,
  "completedAt": "2026-05-15T07:38:45Z",
  "notes": "Felt strong",
  "exerciseCompleted": false,
  "setsRemaining": 2
}
```

**Extra Fields:**
- `exerciseCompleted` — Whether non-warmup set count has reached `targetSets`
- `setsRemaining` — Number of non-warmup sets still needed

---

#### 12. Update a Set
```
PATCH /workouts/:sessionId/exercises/:exerciseId/sets/:setId
```

**Authorization:** User only

**URL Params:**
- `sessionId`, `exerciseId`, `setId` (all string, required)

**Request Body (at least one field required):**
```json
{
  "actualReps": 12,
  "actualWeightKg": 65.0,
  "rpe": 9.0
}
```

---

#### 13. Delete a Set
```
DELETE /workouts/:sessionId/exercises/:exerciseId/sets/:setId
```

**Authorization:** User only

**Notes:**
- Remaining sets are automatically renumbered after deletion.
- The exercise's `isCompleted` status is recalculated.

**Response (200 OK):**
```json
{
  "message": "Set deleted"
}
```

---

### Stats & History Endpoints

#### 14. Get My Workout Stats
```
GET /workouts/me/stats
```

**Authorization:** User only

**Response (200 OK):**
```json
{
  "weeklyWorkouts": 4,
  "totalSetsThisWeek": 47,
  "caloriesBurnedWeek": 1248,
  "consistencyScore": 0.85,
  "currentStreak": 7,
  "totalVolumeKg": 28500.0,
  "personalRecords": {
    "benchPress": {
      "maxWeightKg": 80.0,
      "maxReps": 12,
      "achievedAt": "2026-05-10T08:00:00Z"
    },
    "barbellSquats": {
      "maxWeightKg": 100.0,
      "maxReps": 8,
      "achievedAt": "2026-05-12T07:00:00Z"
    }
  }
}
```

**Field Descriptions:**

| Field | Description |
|-------|-------------|
| `weeklyWorkouts` | Completed sessions this week (Mon-Sun) |
| `totalSetsThisWeek` | Total non-warmup sets this week |
| `caloriesBurnedWeek` | Sum of (exercise.caloriesPerSet * sets completed) this week |
| `consistencyScore` | Completed sessions / 28 days over last 4 weeks (0.0-1.0) |
| `currentStreak` | Consecutive days with a completed session (from today backward) |
| `totalVolumeKg` | Sum of (actualWeightKg * actualReps) this week |
| `personalRecords` | Max weight and max reps per exercise across all completed sessions |

---

#### 15. Get My Workout History
```
GET /workouts/me/history
```

**Authorization:** User only

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `from` | date | 30 days ago | Start date |
| `to` | date | today | End date |
| `page` | number | 1 | Page number |
| `limit` | number | 20 | Items per page (max 100) |

**Response (200 OK):**
```json
{
  "workouts": [
    {
      "id": "664b...",
      "date": "2026-05-14T00:00:00Z",
      "status": "Completed",
      "duration": 3420,
      "exerciseCount": 5,
      "totalSets": 18,
      "totalReps": 186,
      "totalVolumeKg": 5240.0,
      "caloriesBurned": 216,
      "muscleGroups": ["Chest", "Arms"]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

**Field Descriptions:**

| Field | Description |
|-------|-------------|
| `duration` | Session duration in seconds (completedAt - startedAt) |
| `exerciseCount` | Number of exercises in the session |
| `totalSets` | Total non-warmup sets logged |
| `totalReps` | Sum of all reps in non-warmup sets |
| `totalVolumeKg` | Sum of (weight * reps) for all non-warmup sets |
| `caloriesBurned` | Sum of exercise.caloriesPerSet for each non-warmup set |
| `muscleGroups` | Distinct muscle groups targeted in the session |

---

## Workout Plan Routes

### Base Path: `/workout-plans`

**Assignment Endpoints (User):**
- `GET /workout-plans/assignments/mine`
- `GET /workout-plans/assignments/mine/schedule`
- `GET /workout-plans/assignments/mine/today`
- `GET /workout-plans/assignments/mine/days/:dayNumber`
- `POST /workout-plans/assignments/mine/complete-day`
- `PATCH /workout-plans/assignments/mine/days/:dayNumber`

**Plan Management (Admin/Trainer):**
- `GET /workout-plans`
- `POST /workout-plans`
- `GET /workout-plans/:id`
- `PATCH /workout-plans/:id`
- `DELETE /workout-plans/:id`
- `POST /workout-plans/:id/assign`

**Self-Assign:**
- `POST /workout-plans/:planId/assign-to-me` (User/Trainer/Admin)

---

## Nutrition Routes

### Base Path: `/nutrition`

**Roles:** USER = `user`, STAFF = `nutritionist` or `admin`, ADMIN = `admin`

**Profiles**
- `GET /nutrition/my/profile` (USER)
- `POST /nutrition/profiles` (STAFF)
- `GET /nutrition/profiles/:userId` (STAFF)
- `PATCH /nutrition/profiles/:userId` (STAFF)
- `DELETE /nutrition/profiles/:userId` (STAFF)

**Food Catalog**
- `GET /nutrition/foods` (USER/STAFF)
- `POST /nutrition/foods` (STAFF)
- `PATCH /nutrition/foods/:id` (STAFF)
- `DELETE /nutrition/foods/:id` (STAFF)
- `POST /nutrition/admin/foods` (ADMIN)
- `POST /nutrition/admin/adherence/rebuild` (ADMIN)

**Templates**
- `POST /nutrition/templates` (STAFF)
- `GET /nutrition/templates` (STAFF)
- `GET /nutrition/templates/:id` (STAFF)
- `PATCH /nutrition/templates/:id` (STAFF)
- `DELETE /nutrition/templates/:id` (STAFF)
- `POST /nutrition/templates/:id/assign` (STAFF)

**Plans (Managed)**
- `POST /nutrition/plans` (STAFF)
- `GET /nutrition/plans` (STAFF)
- `GET /nutrition/plans/:id` (STAFF)
- `PATCH /nutrition/plans/:id` (STAFF)
- `DELETE /nutrition/plans/:id` (STAFF)
- `PATCH /nutrition/plans/:id/status` (STAFF)
- `POST /nutrition/plans/:id/pdf` (STAFF)
- `POST /nutrition/plans/:id/duplicate` (STAFF)
- `GET /nutrition/plans/:id/adherence` (STAFF)
- `GET /nutrition/plans/:id/adherence/weekly` (STAFF)
- `GET /nutrition/plans/:id/progress` (STAFF)
- `POST /nutrition/plans/:id/progress` (STAFF)

**Plans (User)**
- `GET /nutrition/my/plans` (USER)
- `GET /nutrition/my/plans/:id` (USER)
- `GET /nutrition/my/plans/:id/pdf` (USER)
- `POST /nutrition/my/plans/:id/meals/complete` (USER)

**Meal Logs (User)**
- `POST /nutrition/my/meal-logs`
- `GET /nutrition/my/meal-logs`
- `PATCH /nutrition/my/meal-logs/:id`
- `DELETE /nutrition/my/meal-logs/:id`

**Hydration (User)**
- `POST /nutrition/my/hydration`
- `PATCH /nutrition/my/hydration/goal`
- `GET /nutrition/my/hydration`

**Progress (User)**
- `POST /nutrition/my/progress`
- `GET /nutrition/my/progress`

**Adherence (User)**
- `GET /nutrition/my/adherence`
- `GET /nutrition/my/adherence/weekly`

**Dashboard (Staff)**
- `GET /nutrition/dashboard/stats`
- `GET /nutrition/dashboard/members`
- `GET /nutrition/members` (alias)
- `GET /nutrition/users/:userId/dashboard`

For full field-level schemas and examples, see [docs/API_REFERENCE.md](docs/API_REFERENCE.md).

---

## Nutritionist Booking Routes

### Base Path: `/nutritionist`

- `GET /nutritionist/my-booking` (User)
- `PATCH /nutritionist/my-booking/switch-to-online` (User) — body: const {} (switches appointment mode to ONLINE and generates meeting URL)
- `GET /nutritionist/bookings` (Admin) — query: `status`, `date`
- `PATCH /nutritionist/bookings/:id/accept` (Admin) — body: `meetingLink`, `clinicLocation`, `calBookingId`
- `PATCH /nutritionist/bookings/:id/reject` (Admin) — body: `reason`
- `PATCH /nutritionist/bookings/:id/complete` (Admin) — body: const {} (marks booking as Completed)

---

## Notification Routes

### Base Path: `/notifications`

- `GET /notifications` — query: `page`, `limit`
- `PATCH /notifications/read-all`
- `PATCH /notifications/:id/read`
- `POST /notifications/fcm-token` — body: `{ token, platform }`

---

## Webhook Routes

### Base Path: `/webhook`

- `POST /webhook/email` — header: `X-Webhook-Secret`
- `GET /webhook/reports` (Admin)
- `GET /webhook/reports/:id` (Admin)
- `GET /webhook/reports/user/:userId` (Admin)

### Cal ID Webhook: `/webhooks/cal`

- `POST /webhooks/cal` — header: `X-Cal-Signature-256`

---

## Internal Routes

### Base Path: `/internal`

- `POST /internal/reminders/tick` — header: `X-Internal-Secret` (or `X-Webhook-Secret` alias)

---

## Onboarding Routes

### Base Path: `/onboarding`

**Global Requirements:**
- ✅ JWT Authentication required for all endpoints
- ✅ User role for onboarding steps; admin-only for `DELETE /onboarding/appointments/nutritionist/:userId`
- Backend is the **single source of truth** for onboarding progression
- Steps must be completed in strict order — skipping returns `403`

**Step Order (enforced by backend):**
```
1. HEALTH_MARKERS
2. HEALTH_GOALS
3. CONSENT
4. REPORT_UPLOAD
5. SPORTS_SCIENTIST_BOOKING
6. NUTRITIONIST_BOOKING
7. COMPLETED
```

**Onboarding Error Codes:**

| Code | HTTP Status | Meaning |
|------|------------|---------|
| `STEP_NOT_ALLOWED` | 403 | Attempted a step out of order |
| `ALREADY_COMPLETED` | 409 | Onboarding already finished |
| `MISSING_STEPS` | 400 | Not all steps done at `/complete` |

---

#### 1. Get Onboarding Status
```
GET /onboarding/status
```

**Authorization:** User only

**Response (200 OK):**
```json
{
  "currentStep": "HEALTH_GOALS",
  "completedSteps": ["HEALTH_MARKERS"],
  "onboardingCompleted": false,
  "allowedNextStep": "HEALTH_GOALS"
}
```

**Notes:**
- `allowedNextStep` mirrors `currentStep` when onboarding is in progress.
- `allowedNextStep` is `null` when `onboardingCompleted` is `true`.

---

#### 2. Submit Health Markers
```
POST /onboarding/health-markers
```

**Authorization:** User only  
**Required step:** `HEALTH_MARKERS`

**Request Body:**
```json
{
  "weight": 76.5,
  "height": 178,
  "allergies": ["Peanuts", "Shellfish"],
  "medications": ["Metformin"],
  "diseaseHistory": ["Type 2 Diabetes"],
  "sleepHours": 7,
  "activityLevel": "Moderate"
}
```

**Validation Notes:**
- `weight` and `height` are required and must be positive numbers (kg and cm respectively).
- BMI is **automatically calculated** by the backend: `weight / (height/100)²`.
- `activityLevel` must be one of: `Sedentary`, `Light`, `Moderate`, `Active`, `VeryActive`.
- `sleepHours` must be between `0` and `24`.
- Array fields default to `[]` if omitted.

**Response (201 Created):**
```json
{
  "message": "Health markers submitted",
  "healthMarkers": {
    "_id": "507f1f77bcf86cd799439201",
    "userId": "507f1f77bcf86cd799439011",
    "weight": 76.5,
    "height": 178,
    "bmi": 24.1,
    "allergies": ["Peanuts", "Shellfish"],
    "medications": ["Metformin"],
    "diseaseHistory": ["Type 2 Diabetes"],
    "sleepHours": 7,
    "activityLevel": "Moderate",
    "createdAt": "2026-05-15T09:00:00Z",
    "updatedAt": "2026-05-15T09:00:00Z"
  }
}
```

**Error Responses:**
- `400` — Missing required fields or invalid values
- `403` — `STEP_NOT_ALLOWED` — current step is not `HEALTH_MARKERS`
- `409` — `ALREADY_COMPLETED` — onboarding already finished

---

#### 3. Submit Health Goals
```
POST /onboarding/health-goals
```

**Authorization:** User only  
**Required step:** `HEALTH_GOALS` (after Health Markers)

**Request Body:**
```json
{
  "goals": ["Lose weight", "Build muscle", "Improve stamina"],
  "targetWeight": 70,
  "timeline": "6 months",
  "workoutExperience": "Intermediate",
  "foodPreferences": ["Vegetarian", "High protein"]
}
```

**Validation Notes:**
- `goals` is required and must contain at least one item.
- `workoutExperience` must be one of: `None`, `Beginner`, `Intermediate`, `Advanced`.
- `targetWeight` must be a positive number.
- Array fields default to `[]` if omitted.

**Response (201 Created):**
```json
{
  "message": "Health goals submitted",
  "healthGoals": {
    "_id": "507f1f77bcf86cd799439202",
    "userId": "507f1f77bcf86cd799439011",
    "goals": ["Lose weight", "Build muscle", "Improve stamina"],
    "targetWeight": 70,
    "timeline": "6 months",
    "workoutExperience": "Intermediate",
    "foodPreferences": ["Vegetarian", "High protein"],
    "createdAt": "2026-05-15T09:05:00Z",
    "updatedAt": "2026-05-15T09:05:00Z"
  }
}
```

**Error Responses:**
- `400` — Validation failed or `goals` array is empty
- `403` — `STEP_NOT_ALLOWED` — Health Markers not completed yet

---

#### 4. Submit Consent (Dual-Consent)
```
POST /onboarding/consent
```

**Authorization:** User only  
**Required step:** `CONSENT` (after Health Goals)

**Consent Types (enum `ConsentType`):**
| Value | Description |
|-------|-------------|
| `WELLNESS_SERVICES` | Wellness Services Consent form |
| `GYM_FITNESS` | Gym & Fitness Facility Consent form |

**Request Body (new dual-consent format):**
```json
{
  "consents": [
    {
      "type": "WELLNESS_SERVICES",
      "accepted": true,
      "signatureName": "Rahul",
      "dateSigned": "2026-05-16"
    },
    {
      "type": "GYM_FITNESS",
      "accepted": true,
      "signatureName": "Rahul",
      "dateSigned": "2026-05-16"
    }
  ]
}
```

**Request Body (legacy format — still accepted for backward compatibility):**
```json
{
  "accepted": true,
  "signatureUrl": "https://cdn.example.com/signatures/john-doe.png"
}
```

**Validation Notes:**
- Both `WELLNESS_SERVICES` and `GYM_FITNESS` consent entries are required.
- `accepted` must be exactly `true` for each entry — `false` is rejected.
- `signatureName` is optional (typed name of the signer).
- `dateSigned` is optional (ISO date string).
- `acceptedAt` timestamp and client IP are captured automatically by the backend.
- Legacy payload (`{ accepted: true }`) is mapped to both consent types internally.

**Response (201 Created):**
```json
{
  "message": "Consent submitted",
  "consentForm": {
    "_id": "507f1f77bcf86cd799439203",
    "userId": "507f1f77bcf86cd799439011",
    "consents": [
      {
        "type": "WELLNESS_SERVICES",
        "accepted": true,
        "acceptedAt": "2026-05-16T09:10:00Z",
        "signatureName": "Rahul",
        "dateSigned": "2026-05-16T00:00:00Z"
      },
      {
        "type": "GYM_FITNESS",
        "accepted": true,
        "acceptedAt": "2026-05-16T09:10:00Z",
        "signatureName": "Rahul",
        "dateSigned": "2026-05-16T00:00:00Z"
      }
    ],
    "ipAddress": "203.0.113.45",
    "createdAt": "2026-05-16T09:10:00Z",
    "updatedAt": "2026-05-16T09:10:00Z"
  }
}
```

**Future-safe fields (not yet implemented):**
- `pdfUrl` — URL to signed PDF document
- `signatureUrl` — URL to captured signature image
- `deviceInfo` — device information at time of signing

**Error Responses:**
- `400` — Missing consent entries, only one type provided, or `accepted` is not `true`
- `403` — `STEP_NOT_ALLOWED` — Health Goals not completed yet

---

#### 5. Upload Medical Report
```
POST /onboarding/reports
```

**Authorization:** User only  
**Required step:** `REPORT_UPLOAD` (after Consent)

**Request Options:**
- **Multipart Form-Data (Recommended for file uploads):**
  - `file`: The medical report file (PDF/Image).
  - `reportName`: string (required)
  - `reportType`: string (required)
- **JSON Payload (Fallback / Legacy):**
  - `reportName`: string (required)
  - `reportType`: string (required)
  - `reportUrl`: string (optional, legacy fallback url)

**Validation & Security Notes:**
- `reportName` and `reportType` are required.
- If a file is uploaded, the backend automatically uploads it to S3:
  - Enforces **Server-Side Encryption (SSE-S3)** with `AES256`.
  - Sets **inline Content-Disposition** to support direct in-browser rendering.
  - Strips any direct/raw S3 bucket URLs from the database, storing only the unique `s3Key`.
- The response `reportUrl` is populated dynamically with a secure **pre-signed S3 URL** (expires in 15 minutes / 900 seconds) forcing inline viewing.
- Users may call this endpoint **multiple times** to upload additional reports — each call creates a new `MedicalReport` document.
- The onboarding step `REPORT_UPLOAD` is marked complete only on the **first** successful report upload.

**Response (201 Created):**
```json
{
  "message": "Report uploaded",
  "report": {
    "_id": "507f1f77bcf86cd799439204",
    "userId": "507f1f77bcf86cd799439011",
    "reportName": "Blood Panel April 2026",
    "reportType": "Blood Test",
    "s3Key": "medical-reports/507f1f77bcf86cd799439011/1779698949706-507f1f77bcf86cd799439204.pdf",
    "mimeType": "application/pdf",
    "fileSize": 24581,
    "reportUrl": "https://fitflix-storage.s3.ap-south-1.amazonaws.com/medical-reports/...&response-content-disposition=inline&response-content-type=application%2Fpdf...",
    "uploadedAt": "2026-05-15T09:15:00Z",
    "createdAt": "2026-05-15T09:15:00Z",
    "updatedAt": "2026-05-15T09:15:00Z"
  }
}
```

**Error Responses:**
- `400` — Missing required fields
- `403` — `STEP_NOT_ALLOWED` — Consent not completed yet

---

#### 6. Book Sports Scientist
```
POST /onboarding/sports-scientist
```

**Authorization:** User only  
**Required step:** `SPORTS_SCIENTIST_BOOKING`

**Request Body:**
```json
{
  "appointmentDate": "2026-06-01T10:00:00Z",
  "meetingLink": "https://cal.id/fitflix/sports-scientist",
  "calComBookingId": "booking_abc123"
}
```

**Validation Notes:**
- `appointmentDate`, `meetingLink`, and `calComBookingId` are optional (for Cal.id integration).
- Submitting again **upserts** the existing appointment (no duplicates).

**Response (201 Created):**
```json
{
  "message": "Sports scientist appointment booked",
  "appointment": {
    "_id": "507f1f77bcf86cd799439205",
    "userId": "507f1f77bcf86cd799439011",
    "expertType": "sports_scientist",
    "bookingStatus": "Pending",
    "appointmentDate": "2026-06-01T10:00:00Z",
    "meetingLink": "https://cal.id/fitflix/sports-scientist",
    "calComBookingId": "booking_abc123",
    "createdAt": "2026-05-15T09:20:00Z",
    "updatedAt": "2026-05-15T09:20:00Z"
  }
}
```

**Error Responses:**
- `403` — `STEP_NOT_ALLOWED` — Reports not uploaded yet

---

#### 7. Book Nutritionist
```
POST /onboarding/nutritionist
```

**Authorization:** User only  
**Required step:** `NUTRITIONIST_BOOKING` (sports scientist must be completed first)

**Request Body:**
```json
{
  "appointmentDate": "2026-06-03T11:00:00Z",
  "meetingLink": null,
  "calComBookingId": null
}
```

**Response (201 Created):**
```json
{
  "message": "Nutritionist appointment booked",
  "appointment": {
    "_id": "507f1f77bcf86cd799439206",
    "userId": "507f1f77bcf86cd799439011",
    "expertType": "nutritionist",
    "bookingStatus": "Pending",
    "appointmentDate": "2026-06-03T11:00:00Z",
    "meetingLink": null,
    "calComBookingId": null,
    "createdAt": "2026-05-15T09:25:00Z",
    "updatedAt": "2026-05-15T09:25:00Z"
  }
}
```

---

#### 7a. Book Nutritionist (Slot-Based)
```
POST /onboarding/nutritionist/book
```

**Authorization:** User only

**Request Body:**
```json
{
  "slotId": "507f1f77bcf86cd799439020",
  "date": "2026-06-03",
  "appointmentMode": "IN_PERSON",
  "clinicLocation": "Gachibowli" 
}
```

**Response (201 Created):**
```json
{
  "message": "Nutritionist booking submitted for approval",
  "booking": { /* booking object */ }
}
```

**Error Responses:**
- `403` — `STEP_NOT_ALLOWED` — Sports scientist not booked yet

---

#### 8. Book Expert Appointment (Legacy)
```
POST /onboarding/appointments
```

**Authorization:** User only  
**Required step:** `SPORTS_SCIENTIST_BOOKING` (for sports scientist) or `NUTRITIONIST_BOOKING` (for nutritionist)

**Request Body:**
```json
{
  "expertType": "sports_scientist",
  "appointmentDate": "2026-06-01T10:00:00Z",
  "meetingLink": "https://cal.id/fitflix/sports-scientist",
  "calComBookingId": "booking_abc123"
}
```

**Validation Notes:**
- `expertType` must be one of: `sports_scientist`, `nutritionist`.
- Sports scientist **must be booked before** nutritionist — attempting nutritionist first returns `403 STEP_NOT_ALLOWED`.
- `appointmentDate`, `meetingLink`, and `calComBookingId` are optional (for Cal.id integration).
- Submitting the same `expertType` again **upserts** the existing appointment (no duplicates).

**Error Responses:**
- `400` — Invalid `expertType`
- `403` — `STEP_NOT_ALLOWED` — Attempted nutritionist before sports scientist, or reports not uploaded yet

---

#### 9. Cancel Nutritionist Appointment (Admin)
```
DELETE /onboarding/appointments/nutritionist/:userId
```

**Authorization:** Admin only

**URL Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `userId` | ObjectId | The user whose nutritionist appointment should be cancelled |

**Behavior:**
- Deletes the user's nutritionist `ExpertAppointment` record.
- Rewinds onboarding state:
  - `onboardingStatus.nutritionistBooked = false`
  - Removes `NUTRITIONIST_BOOKING` and `COMPLETED` from `completedSteps`
  - Sets `currentStep = NUTRITIONIST_BOOKING`
  - Sets `onboardingStatus.onboardingCompleted = false` and `user.onboarded = false`
  - Clears `onboardingStatus.completedAt`
- Used by the FrontDesk Admin → Nutritionist → Booked tab → Delete action.

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Nutritionist appointment cancelled successfully",
  "onboardingStatus": {
    "currentStep": "NUTRITIONIST_BOOKING",
    "completedSteps": [
      "HEALTH_MARKERS",
      "HEALTH_GOALS",
      "CONSENT",
      "REPORT_UPLOAD",
      "SPORTS_SCIENTIST_BOOKING"
    ],
    "onboardingCompleted": false,
    "allowedNextStep": "NUTRITIONIST_BOOKING"
  }
}
```

**Error Responses:**
- `400` — `BAD_REQUEST` — Invalid `userId`
- `403` — `FORBIDDEN` — Caller is not an admin
- `404` — `NOT_FOUND` — User not found, or no nutritionist appointment exists for this user
- `500` — `INTERNAL_ERROR` — Unexpected server failure

---

#### 10. Complete Onboarding
```
POST /onboarding/complete
```

**Authorization:** User only  
**Required:** All 6 steps must be completed

**Request Body:** None required

**Behavior:**
- Validates that all 6 onboarding steps are completed.
- Sets `onboardingStatus.onboardingCompleted = true` and records `completedAt`.
- Sets `user.onboarded = true` for backward compatibility with existing APIs.

**Response (200 OK):**
```json
{
  "message": "Onboarding completed",
  "completedAt": "2026-05-15T09:30:00Z"
}
```

**Error Responses:**
- `400` — `MISSING_STEPS` — One or more steps are not yet complete (message lists which flags are missing)
- `409` — `ALREADY_COMPLETED` — Onboarding was already completed

---

## Enums & Status Codes

### Booking/Appointment Status
```javascript
{
  0: "Booked",
  1: "Confirmed",
  2: "Cancelled",
  3: "Attended",
  4: "Unattended"
}
```

### Schedule/Todo Status
```javascript
{
  0: "Todo",
  1: "Doing",
  2: "Done"
}
```

### Gender
```javascript
{
  "Male": "Male",
  "Female": "Female",
  "Other": "Other"
}
```

**Notes:**
- Legacy numeric inputs (`0`–`2`) are accepted on signup and normalized to the string values above.

### Lead Status
```javascript
{
  "New": "New",
  "Contacted": "Contacted",
  "Qualified": "Qualified",
  "Warm": "Warm",
  "Hot": "Hot",
  "Cold": "Cold",
  "Converted": "Converted",
  "Lost": "Lost"
}
```

### Credit Transaction Type
```javascript
{
  "Consume": "Consume",
  "Refund": "Refund",
  "AdminTopUp": "AdminTopUp",
  "Void": "Void"
}
```

### Credit Transaction Source
```javascript
{
  "Booking": "Booking",
  "Appointment": "Appointment",
  "Admin": "Admin"
}
```

### Muscle Group
```javascript
{
  "Chest": "Chest",
  "Back": "Back",
  "Legs": "Legs",
  "Shoulders": "Shoulders",
  "Arms": "Arms",
  "Core": "Core",
  "FullBody": "FullBody"
}
```

### Exercise Difficulty
```javascript
{
  "Beginner": "Beginner",
  "Intermediate": "Intermediate",
  "Advanced": "Advanced"
}
```

### Workout Session Status
```javascript
{
  "Active": "Active",
  "Completed": "Completed",
  "Abandoned": "Abandoned"
}
```

### Onboarding Step
```javascript
{
  "HEALTH_MARKERS": "HEALTH_MARKERS",
  "HEALTH_GOALS": "HEALTH_GOALS",
  "CONSENT": "CONSENT",
  "REPORT_UPLOAD": "REPORT_UPLOAD",
  "SPORTS_SCIENTIST_BOOKING": "SPORTS_SCIENTIST_BOOKING",
  "NUTRITIONIST_BOOKING": "NUTRITIONIST_BOOKING",
  "COMPLETED": "COMPLETED"
}
```

### Expert Type
```javascript
{
  "sports_scientist": "sports_scientist",
  "nutritionist": "nutritionist"
}
```

### Appointment Booking Status (Expert Appointments)
```javascript
{
  "Pending": "Pending",
  "Confirmed": "Confirmed",
  "Cancelled": "Cancelled",
  "Rescheduled": "Rescheduled",
  "Completed": "Completed",
  "NoShow": "NoShow"
}
```

### Appointment Mode (Nutritionist Booking)
```javascript
{
  "IN_PERSON": "IN_PERSON",
  "ONLINE": "ONLINE"
}
```

### Nutritionist Booking Status
```javascript
{
  "PENDING": "PENDING",
  "ACCEPTED": "ACCEPTED",
  "REJECTED": "REJECTED",
  "COMPLETED": "COMPLETED"
}
```

### Nutritionist Approval Status
```javascript
{
  "PENDING": "PENDING",
  "APPROVED": "APPROVED",
  "REJECTED": "REJECTED"
}
```

### Notification Channel
```javascript
{
  "INAPP": "INAPP",
  "PUSH": "PUSH",
  "SOCKET": "SOCKET"
}
```

### Notification Kind
```javascript
{
  "appointment_booked": "appointment_booked",
  "appointment_rescheduled": "appointment_rescheduled",
  "appointment_cancelled": "appointment_cancelled",
  "appointment_reminder": "appointment_reminder",
  "onboarding_step_updated": "onboarding_step_updated"
}
```

### Reminder Kind
```javascript
{
  "T_MINUS_24H": "T_MINUS_24H",
  "T_MINUS_1H": "T_MINUS_1H",
  "T_MINUS_15M": "T_MINUS_15M"
}
```

### Reminder Status
```javascript
{
  "SCHEDULED": "SCHEDULED",
  "FIRED": "FIRED",
  "CANCELLED": "CANCELLED"
}
```

### Webhook Sync Status
```javascript
{
  "PENDING": "PENDING",
  "SYNCED": "SYNCED",
  "FAILED": "FAILED",
  "STALE": "STALE"
}
```

### Consent Type
```javascript
{
  "WELLNESS_SERVICES": "WELLNESS_SERVICES",
  "GYM_FITNESS": "GYM_FITNESS"
}
```

**Notes:**
- Both consent types must be accepted during the onboarding `CONSENT` step.
- The consent step only advances when both `WELLNESS_SERVICES` and `GYM_FITNESS` entries are submitted with `accepted: true`.
- Legacy single-consent payload (`{ accepted: true }`) is still accepted and maps to both types internally.

### Activity Level (Health Markers)
```javascript
{
  "Sedentary": "Sedentary",
  "Light": "Light",
  "Moderate": "Moderate",
  "Active": "Active",
  "VeryActive": "VeryActive"
}
```

### Workout Experience (Health Goals)
```javascript
{
  "None": "None",
  "Beginner": "Beginner",
  "Intermediate": "Intermediate",
  "Advanced": "Advanced"
}
```

---

## Error Handling

### Common HTTP Status Codes

| Status | Meaning | Common Causes |
|--------|---------|---------------|
| `200` | OK | Successful GET/PATCH |
| `201` | Created | Successful POST |
| `400` | Bad Request | Invalid input, validation failed |
| `401` | Unauthorized | Missing/invalid credentials |
| `402` | Payment Required | Insufficient credits |
| `403` | Forbidden | Insufficient permissions |
| `404` | Not Found | Resource doesn't exist |
| `409` | Conflict | Email/resource already exists |
| `501` | Not Implemented | Feature is intentionally pending (for example report PDF streaming) |
| `500` | Server Error | Unexpected server error |

### Error Response Format
```json
{
  "error": "Error description",
  "code": "VALIDATION_ERROR",
  "details": {
    "fieldName": "Field validation failed"
  }
}
```

**Notes:**
- Error responses are normalized to the envelope above.
- `details` is optional and may contain field-level validation details.
- Common `code` values include: `VALIDATION_ERROR`, `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `NOT_IMPLEMENTED`, `INTERNAL_ERROR`, `API_ERROR`.

### Example Error Responses

**401 Unauthorized:**
```json
{
  "error": "Unauthorized",
  "code": "UNAUTHORIZED"
}
```

**403 Forbidden:**
```json
{
  "error": "Forbidden",
  "code": "FORBIDDEN"
}
```

**400 Bad Request (Validation):**
```json
{
  "error": "Validation failed",
  "code": "VALIDATION_ERROR",
  "details": {
    "userId": "Required"
  }
}
```

**501 Not Implemented:**
```json
{
  "error": "Report PDF endpoint is not available yet",
  "code": "NOT_IMPLEMENTED",
  "details": {
    "id": "507f1f77bcf86cd799439011",
    "hasPdf": true
  }
}
```

---

## Health Check

### Endpoint
```
GET /health
```

**Authentication:** ❌ None

**Response (200 OK):**
```json
{
  "ok": true
}
```

---

## Example Workflows

### Workflow 1: Patient Books a Service

1. **Patient signs up:** `POST /auth/signup`
2. **Patient logs in:** `POST /auth/login` → Get credentials
3. **Admin creates membership with credits:** `POST /memberships` (for the patient)
4. **Patient checks available credits:** `GET /credits/me/balance`
5. **Patient creates booking:** `POST /bookings` (credits are consumed based on service `creditCost`)
6. **Patient checks booking + history:** `GET /bookings/me` and `GET /credits/me/history`

### Workflow 2: Admin Creates Doctor Schedule

1. **Admin logs in:** `POST /auth/login`
2. **Admin creates doctor:** `POST /doctors`
3. **Admin creates slots:** `POST /slots` for doctor availability
4. **Admin creates appointment:** `POST /appointments` linking doctor + patient + slot

### Workflow 3: Patient Track Daily Progress

1. **User logs in:** `POST /auth/login`
2. **Get personal schedule:** `GET /schedules/my-schedule`
3. **Update schedule status:** `PATCH /schedules/:userId` (change status from Todo → Doing → Done)
4. **Reschedule if needed:** `PATCH /schedules/:userId/reschedule` (within 7 days only)

### Workflow 4: User Logs a Workout

1. **User logs in:** `POST /auth/login`
2. **Browse exercise library:** `GET /exercises?muscleGroup=Chest`
3. **Get today's session:** `GET /workouts/today` (auto-creates if none)
4. **Add exercises:** `POST /workouts/:sessionId/exercises` (repeat for each exercise)
5. **Log sets:** `POST /workouts/:sessionId/exercises/:exerciseId/sets` (repeat for each set; response includes `exerciseCompleted` and `setsRemaining`)
6. **Complete session:** `PATCH /workouts/:sessionId` with `{ "status": "Completed" }`
7. **Check stats:** `GET /workouts/me/stats`
8. **View history:** `GET /workouts/me/history`

### Workflow 5: New User Completes Onboarding

1. **User signs up:** `POST /auth/signup` → receive `userId`, `onboarded: false`
2. **User logs in:** `POST /auth/login` → receive JWT token
3. **Check current step:** `GET /onboarding/status` → `{ currentStep: "HEALTH_MARKERS", ... }`
4. **Submit health markers:** `POST /onboarding/health-markers` with weight, height, etc. → BMI auto-calculated; step advances to `HEALTH_GOALS`
5. **Submit health goals:** `POST /onboarding/health-goals` with goals array → step advances to `CONSENT`
6. **Submit consent (dual):** `POST /onboarding/consent` with `{ "consents": [{ "type": "WELLNESS_SERVICES", "accepted": true, ... }, { "type": "GYM_FITNESS", "accepted": true, ... }] }` → both consents stored; IP captured; step advances to `REPORT_UPLOAD`. Legacy `{ "accepted": true }` format still accepted.
7. **Upload report(s):** `POST /onboarding/reports` → step advances to `SPORTS_SCIENTIST_BOOKING` (can call multiple times for more reports)
8. **Book sports scientist:** `POST /onboarding/sports-scientist` → step advances to `NUTRITIONIST_BOOKING`
9. **Book nutritionist:** `POST /onboarding/nutritionist` or `POST /onboarding/nutritionist/book` (slot-based) → all steps done
10. **Complete onboarding:** `POST /onboarding/complete` → `user.onboarded` set to `true`; admin can now see full `onboardingStatus` via `GET /users/:id`

---

### Workflow 6: Admin Manual Credit Top-Up

1. **Admin logs in:** `POST /auth/login`
2. **Admin checks user credit position:** `GET /credits/users/:userId/balance`
3. **Admin adds credits:** `POST /credits/users/:userId/topup`
4. **Admin verifies ledger entry:** `GET /credits/users/:userId/history`

---

---

## Notes for Development

- All timestamps are in **ISO 8601** format (UTC)
- All IDs are MongoDB **ObjectId** strings
- Passwords are stored as **bcrypt hashes** and never returned in API responses
- Date fields accept various formats that coerce to Date objects
- Array fields (like `specialities`, `todoIds`) default to empty arrays if not provided
- At least one field is required for PATCH operations
- Role-based access is enforced per endpoint

---

## Support & Questions

For questions or issues with the API:
1. Check this documentation
2. Review the endpoint authorization requirements
3. Verify Authorization: Bearer headers are properly formatted
4. Check that resource IDs are valid MongoDB ObjectIds

**Last Updated:** May 27, 2026
