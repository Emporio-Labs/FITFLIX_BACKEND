# HybridHuman Backend API Documentation

**Base URL:** `http://localhost:3000`  
**API Version:** 1.0.0  
**Last Updated:** May 5, 2026

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
15. [Credit Routes](#credit-routes)
16. [Schedule Routes](#schedule-routes)
17. [Enums & Status Codes](#enums--status-codes)
18. [Error Handling](#error-handling)

---

## Authentication

### Basic Authentication

All protected endpoints use **HTTP Basic Authentication** with the following format:

```
Authorization: Basic <base64(email:password)>
```

**Example:**
```bash
# Credentials: user@example.com:mypassword
# Base64 encoded: dXNlckBleGFtcGxlLmNvbTpteXBhc3N3b3Jk

curl -H "Authorization: Basic dXNlckBleGFtcGxlLmNvbTpteXBhc3N3b3Jk" \
  http://localhost:3000/doctors
```

### User Roles

The system supports 4 role types:
- **`user`** — Patient/end-user (non-medical)
- **`doctor`** — Healthcare provider
- **`trainer`** — Fitness/wellness trainer
- **`admin`** — Front desk/system administrator

---

## Endpoints Overview

| Route | Purpose | Auth | Endpoints |
|-------|---------|------|-----------|
| `/auth` | User authentication | ❌ No | 2 endpoints |
| `/admins` | Admin management | ✅ Admin only | 5 endpoints |
| `/users` | Member management | ✅ Admin + Doctor (read), Admin/User self (updates), User self-service profile/report/password | 10 endpoints |
| `/doctors` | Doctor management | ✅ Admin + Role-based | 5 endpoints |
| `/trainers` | Trainer management | ✅ Admin + Role-based | 5 endpoints |
| `/slots` | Time slot management | ✅ Public read, Admin write | 5 endpoints |
| `/memberships` | Membership plans per user | ✅ Mixed roles | 6 endpoints |
| `/services` | Catalog of services | ✅ Mixed roles | 5 endpoints |
| `/therapies` | Catalog of therapies | ✅ Mixed roles | 5 endpoints |
| `/leads` | Lead intake and conversion | ✅ Mixed roles + 1 public capture endpoint | 7 endpoints |
| `/bookings` | Service bookings | ✅ Mixed roles | 7 endpoints |
| `/appointments` | Doctor appointments | ✅ Mixed roles | 7 endpoints |
| `/credits` | Credit balance, history, top-up | ✅ Admin + User (self-service for user) | 5 endpoints |
| `/schedules` | User schedules/todos | ✅ All authenticated | 6 endpoints |
| `/health` | Health check | ❌ No | 1 endpoint |

**Total Endpoints:** 81

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
  "gender": 0,
  "healthGoals": ["Build muscle", "Lose weight"]
}
```

**Validation Notes:**
- `password` must be at least 8 characters and include at least one letter and one number.
- `age` must be an integer in range `0` to `130`.

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
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "john@example.com",
    "role": "user"
  }
}
```

**Admin Login Response Example (200 OK):**
```json
{
  "message": "Login successful",
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
  "user": {
    "id": "507f1f77bcf86cd799439077",
    "email": "coach.mike@hybridhuman.com",
    "role": "trainer"
  }
}
```

**Error Responses:**
- `400` — Invalid login payload
- `401` — Invalid email or password

---

## Admin Routes

### Base Path: `/admins`

**Global Requirements:**
- ✅ Basic Authentication required
- ✅ Admin role required for create/update/delete
- ✅ Admin or Doctor role allowed for read (list and get by id)

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
- ✅ Basic Authentication required
- ✅ Admin can create and delete users
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

**Authorization:** Admin or Doctor

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

**Authorization:** Admin or Doctor

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
    "createdAt": "2026-03-21T10:00:00Z",
    "updatedAt": "2026-03-21T10:00:00Z"
  }
}
```

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

#### 5. Get My Reports
```
GET /users/me/reports
```

**Authorization:** User only

**Response (200 OK):**
```json
{
  "reports": [
    {
      "id": "report-001",
      "title": "April Personalized Optimization Report",
      "summary": "Your recovery markers improved, but sleep consistency needs attention.",
      "suggestions": [
        "Maintain 7.5-8 hours sleep window for 14 days.",
        "Shift caffeine cutoff to 2 PM."
      ],
      "recommendations": [
        "Maintain 7.5-8 hours sleep window for 14 days.",
        "Shift caffeine cutoff to 2 PM."
      ],
      "insights": [
        "Maintain 7.5-8 hours sleep window for 14 days.",
        "Shift caffeine cutoff to 2 PM."
      ],
      "generated_date": "2026-04-10T08:00:00.000Z",
      "pdf_url": "http://localhost:3000/users/me/reports/report-001/pdf"
    }
  ]
}
```

---

#### 6. Get My Report PDF
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

#### 7. Update My Password
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

#### 8. Onboard User (self or admin)
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
- ✅ Basic Authentication required for all endpoints

| Endpoint | POST | GET | PATCH | DELETE |
|----------|------|-----|-------|--------|
| `/doctors` | Admin | Admin | - | - |
| `/doctors/:id` | - | Doctor, Trainer | Doctor, Trainer | Admin |

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
- ✅ Basic Authentication required for all endpoints
- Similar structure to Doctor routes

| Endpoint | POST | GET | PATCH | DELETE |
|----------|------|-----|-------|--------|
| `/trainers` | Admin | Admin | - | - |
| `/trainers/:id` | - | Trainer, Doctor | Trainer, Doctor | Admin |

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

## Slot Routes

### Base Path: `/slots`

**Global Requirements:**
- ✅ Public read access for `GET /slots` and `GET /slots/:id`
- ✅ Basic Authentication + Admin role required for `POST`, `PATCH`, and `DELETE`

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

**Authorization:** Public

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

**Authorization:** Public

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
- ✅ Basic Authentication required
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
- ✅ Basic Authentication required
- ✅ Admin creates/updates/deletes; all roles can read

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
- ✅ Basic Authentication required
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
- ✅ All other lead endpoints require Basic Authentication
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
  "gender": 1,
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
- ✅ Basic Authentication required for all endpoints

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
- ✅ Basic Authentication required for all endpoints

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
- ✅ Basic Authentication required
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
- ✅ Basic Authentication required for all endpoints

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
  0: "Male",
  1: "Female",
  2: "Others"
}
```

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

### Workflow 4: Admin Manual Credit Top-Up

1. **Admin logs in:** `POST /auth/login`
2. **Admin checks user credit position:** `GET /credits/users/:userId/balance`
3. **Admin adds credits:** `POST /credits/users/:userId/topup`
4. **Admin verifies ledger entry:** `GET /credits/users/:userId/history`

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
3. Verify Basic Auth headers are properly formatted
4. Check that resource IDs are valid MongoDB ObjectIds

**Last Updated:** April 11, 2026
