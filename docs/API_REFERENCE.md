# Fitflix Backend — API Reference

Single-source HTTP reference for the Fitflix Express + MongoDB backend that powers the Fitflix Flutter app and the FrontDesk admin dashboard. Covers every endpoint mounted in [src/app.ts](../src/app.ts).

- **Base URL (production):** `https://api.example.com`
- **Base URL (local):** `http://localhost:3000` (configurable via `PORT`)
- **Content type:** `application/json` unless otherwise noted (file uploads use `multipart/form-data`)
- **Date format:** ISO-8601 (`2026-05-22T10:30:00.000Z`)
- **Object IDs:** 24-character MongoDB hex strings

> **Keeping this file honest.** This is the only API reference in the repo — the
> former root `API_DOCS.md` is now a pointer to this file. When you add, remove,
> or change an endpoint, update [Endpoint index](#endpoint-index) in the same
> commit. That table is the diff surface: comparing `main` against a feature
> branch should show every API change as a one-line add/remove/modify there.

---

## Table of contents

1. [Authentication](#authentication)
2. [Conventions](#conventions)
3. [Error responses](#error-responses)
4. [Enums](#enums)
5. [Endpoint index](#endpoint-index)
6. [Auth — `/auth`](#auth--auth)
7. [Account deletion — `/delete-account`](#account-deletion--delete-account)
8. [Admins — `/admins`](#admins--admins)
9. [Users — `/users`](#users--users)
10. [Onboarding — `/onboarding`](#onboarding--onboarding)
11. [Trainers — `/trainers`](#trainers--trainers)
12. [Classes — `/api/v1/classes`](#classes--apiv1classes)
13. [Class schedules — `/api/v1/classes/schedule`](#class-schedules--apiv1classesschedule)
14. [Video sessions (ZEGOCLOUD) — `/api/v1/zego`](#video-sessions-zegocloud--apiv1zego)
15. [Conference settings — `/api/v1/admin/settings`](#conference-settings--apiv1adminsettings)
16. [Slots — `/slots`](#slots--slots)
17. [Services — `/services`](#services--services)
18. [Therapies — `/therapies`](#therapies--therapies)
19. [Bookings — `/bookings`](#bookings--bookings)
20. [Credits — `/credits`](#credits--credits)
21. [Memberships — `/memberships`](#memberships--memberships)
22. [Membership plans — `/membership-plans`](#membership-plans--membership-plans)
23. [Invoices — `/invoices`](#invoices--invoices)
24. [Schedules — `/schedules`](#schedules--schedules)
25. [Exercises — `/exercises`](#exercises--exercises)
26. [Workouts — `/workouts`](#workouts--workouts)
27. [Workout plans — `/workout-plans`](#workout-plans--workout-plans)
28. [Leads — `/leads`](#leads--leads)
29. [Dashboard — `/dashboard`](#dashboard--dashboard)
30. [Nutrition — `/nutrition`](#nutrition--nutrition)
31. [Nutritionist bookings — `/nutritionist`](#nutritionist-bookings--nutritionist)
32. [Notifications — `/notifications`](#notifications--notifications)
33. [Webhook — `/webhook`](#webhook--webhook)
34. [Internal — `/internal`](#internal--internal)
35. [Health & diagnostics](#health--diagnostics)
36. [Appendix A: Onboarding step order](#appendix-a-onboarding-step-order)
37. [Appendix B: Path aliases](#appendix-b-path-aliases)

---

## Authentication

Most endpoints use **JWT bearer tokens**. Obtain a token via [`POST /auth/login`](#post-authlogin) and pass it on subsequent requests:

```
Authorization: Bearer <token>
```

- **Token lifetime:** 12 hours (configurable via `JWT_EXPIRES_IN`).
- **Public endpoints** are explicitly labelled `Auth: Public`.
- **Webhook endpoint** uses a shared-secret header (`X-Webhook-Secret`) instead of JWT.
- **Internal endpoints** use `X-Internal-Secret` (or `X-Webhook-Secret` as an alias) instead of JWT.

Failed authentication returns `401` (`{"message":"Unauthorized"}` from the RBAC layer, or `{"error":...,"code":"UNAUTHORIZED"}` from a controller). Insufficient role returns `403 {"message":"Forbidden"}`.

### Roles

Canonical roles, from [src/types/auth.ts](../src/types/auth.ts):

| Role | Description |
|---|---|
| `user` | End member using the Flutter app |
| `admin` | Full administrative access |
| `frontdesk` | FrontDesk dashboard staff — leads, invoices, memberships, bookings |
| `trainer` | Class instructor / workout-plan author |
| `nutritionist` | Nutrition plans, foods, templates, member roster |
| `doctor` | Declared in the role union but no route currently authorizes it |

**Legacy role aliases.** `authorize()` normalizes before comparing, so these
inbound values are accepted and collapsed ([src/middleware/rbac.middleware.ts](../src/middleware/rbac.middleware.ts)):

| Token value | Normalizes to |
|---|---|
| `ROLE_FRONT_DESK_STAFF` | `admin` |
| `staff`, `ROLE_FRONT_END_STAFF` | `frontdesk` |
| `ROLE_MEMBER` | `user` |

Because normalization runs on *both* sides of the comparison, a route declared
`authorize(["admin"])` also admits a token carrying `ROLE_FRONT_DESK_STAFF`.

### Token revocation

`POST /auth/logout` writes the presented token to a `TokenBlacklist` collection.
`authenticateToken` checks that collection on every request, so a revoked token
returns `401 {"message":"Token has been revoked"}` even before its expiry.

If `JWT_SECRET` is unset the whole auth layer fails closed with
`503 {"message":"JWT authentication is not configured"}`.

## Conventions

### Request

- All bodies are JSON unless explicitly noted. Set `Content-Type: application/json`.
- File uploads (for example `/onboarding/reports`) use `multipart/form-data`.
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

| Limiter | Applies to | Default |
|---|---|---|
| `authRateLimit` | Every `/auth/*` route, including `/auth/phone/*` | 10 requests / 15 min / IP (`AUTH_RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_WINDOW_MS`) |
| `apiRateLimit` | `/bookings`, `/credits`, `/schedules`, `/exercises`, `/leads`, `/invoices` and their `/api/v1` aliases | see `src/middleware/rate-limit.middleware.ts` |
| `publicLeadCaptureRateLimit` | `POST /leads/public-capture` (also CAPTCHA-protected) | see `src/middleware/public-rate-limit.middleware.ts` |
| `publicDeleteAccountRateLimit` | `GET /delete-account`, `POST /delete-account/request` | see `src/middleware/public-rate-limit.middleware.ts` |
| `uploadRateLimiter` | `POST /onboarding/reports` | see `src/middleware/upload.middleware.ts` |

Limit headers are exposed to browsers via `Access-Control-Expose-Headers`:
`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

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
| `Gender` | `Male`, `Female`, `Other` (legacy numeric inputs `0`/`1`/`2` are accepted on signup and normalized) |
| `BookingStatus` *(numeric)* | `Booked` (0), `Confirmed` (1), `Cancelled` (2), `Attended` (3), `Unattended` (4) |
| `MembershipStatus` | `Active`, `Paused`, `Cancelled`, `Expired` |
| `TodoStatus` *(numeric)* | `Todo` (0), `Doing` (1), `Done` (2) |
| `LeadStatus` | `New`, `Contacted`, `Qualified`, `Warm`, `Hot`, `Cold`, `Converted`, `Lost` |
| `CreditTransactionType` | `Consume`, `Refund`, `AdminTopUp`, `Void` |
| `CreditTransactionSource` | `Booking`, `Appointment`, `Admin` |
| `MuscleGroup` | `Chest`, `Back`, `Legs`, `Shoulders`, `Arms`, `Core`, `FullBody` |
| `ExerciseDifficulty` | `Beginner`, `Intermediate`, `Advanced` |
| `ExerciseSection` | `warmup`, `workout`, `stretching` |
| `WorkoutSessionStatus` | `Active`, `Completed`, `Abandoned` |
| `OnboardingStep` | `HEALTH_MARKERS`, `HEALTH_GOALS`, `CONSENT`, `REPORT_UPLOAD`, `NUTRITIONIST_BOOKING`, `COMPLETED` |
| `ExpertType` | `nutritionist` |
| `AppointmentBookingStatus` | `Pending`, `Confirmed`, `Cancelled`, `Rescheduled`, `Completed`, `NoShow` |
| `WebhookSyncStatus` | `PENDING`, `SYNCED`, `FAILED`, `STALE` |
| `AppointmentSource` | `USER_APP`, `ADMIN`, `CAL_DASHBOARD` |
| `WebhookEventStatus` | `RECEIVED`, `PROCESSING`, `PROCESSED`, `FAILED`, `DLQ` |
| `NotificationChannel` | `INAPP`, `PUSH`, `SOCKET` |
| `NotificationKind` | `appointment_booked`, `appointment_rescheduled`, `appointment_cancelled`, `appointment_reminder`, `onboarding_step_updated`, `membership_expiry_reminder` |
| `ReminderKind` | `T_MINUS_24H`, `T_MINUS_1H`, `T_MINUS_15M` |
| `ReminderStatus` | `SCHEDULED`, `FIRED`, `CANCELLED` |
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
| `ConsentType` | `WELLNESS_SERVICES`, `GYM_FITNESS` |
| `AppointmentMode` | `IN_PERSON`, `ONLINE` |
| `MeetingStatus` | `SCHEDULED`, `IN_PROGRESS`, `COMPLETED` |
| `NutritionistBookingStatus` | `PENDING`, `ACCEPTED`, `REJECTED`, `COMPLETED`, `EXPIRED`, `RESCHEDULE_REQUIRED` |
| `NutritionistApprovalStatus` | `PENDING`, `APPROVED`, `REJECTED` |
| `InvoicePaymentStatus` | `DRAFT`, `PENDING`, `PAID`, `FAILED`, `CANCELLED`, `REFUNDED` |
| `InvoicePaymentMethod` | `CASH`, `UPI`, `CARD`, `BANK_TRANSFER`, `NONE` |
| `DeletionRequestStatus` | `Pending`, `Processed`, `Cancelled` |
| `AuditAction` | `BOOKED`, `RESCHEDULED`, `CANCELLED`, `WEBHOOK_SYNC`, `STATUS_CHANGED` |
| `IngredientUnit` | `g`, `ml` |
| `ImportRowType` | `CategoryHeader`, `ColumnHeader`, `Empty`, `Total`, `Recipe`, `Ingredient` |
| `ActivityLevel` *(health markers)* | `Sedentary`, `Light`, `Moderate`, `Active`, `VeryActive` |
| `WorkoutExperience` *(health goals)* | `None`, `Beginner`, `Intermediate`, `Advanced` |

### Status values declared outside `Enums.ts`

These are inline Mongoose/Zod string unions, not TypeScript enums — grep the
listed file when changing them.

| Concept | Values | Source |
|---|---|---|
| Class `status` | `ACTIVE`, `INACTIVE` | [Class.ts](../src/models/Class.ts) |
| Class `mode` | `online`, `offline`, `hybrid` | class validator |
| Class `sessionType` | `group_class`, `live_stream`, `""` | class validator |
| Class `access` | `members_only`, `open_to_all` | class validator |
| Class `bookingRequirement` | `free`, `credits_required` | class validator |
| Class `recurrenceRule` | `NONE`, `DAILY`, `WEEKLY`, `MONTHLY` | class validator |
| ScheduledSession `status` | `SCHEDULED`, `FULL`, `CANCELLED`, `COMPLETED` | [ScheduledSession.ts](../src/models/ScheduledSession.ts) |
| ScheduledSession `roomStatus` | `PENDING`, `READY`, `EXPIRED` | [ScheduledSession.ts](../src/models/ScheduledSession.ts) |
| ScheduledSession `deliveryType` | `ONLINE`, `OFFLINE`, `HYBRID` | [ScheduledSession.ts](../src/models/ScheduledSession.ts) |
| Session access role | `host`, `member` | [session-access.service.ts](../src/services/session-access.service.ts) |
| Session deny code | `NO_SCHEDULE`, `NO_BOOKING`, `CANCELLED`, `ENDED`, `NOT_OPEN_YET`, `HOST_NOT_STARTED`, `NO_ROOM` | [session-access.service.ts](../src/services/session-access.service.ts) |
| Conference resolution | `360p`, `540p`, `720p`, `1080p` | [settings.controller.ts](../src/controllers/settings.controller.ts) |
| FCM platform | `ios`, `android` | [notification.controller.ts](../src/controllers/notification.controller.ts) |

> Each endpoint section below uses this template:
> **Auth → Path params → Query params → Request body → Example request (curl + TypeScript/axios) → Success response → Error responses → Notes.**
> Sections are omitted when they don't apply.

---

## Endpoint index

Every route declaration in the codebase, grouped by the route file that owns it
and listed in **registration order** (which is also Express's match order —
important where a static path must precede a `:param` path).

**This is the diff surface.** Regenerate or hand-edit it whenever routes change;
a `git diff main..<branch> -- docs/API_REFERENCE.md` scoped to this section is a
complete inventory of the branch's API changes.

- **Auth** — `JWT` = `authenticateToken` required; `Public` = no auth;
  `Secret` = shared-secret header.
- **Roles** — the `authorize([...])` list. `—` means authenticated but
  unrestricted by role. Remember legacy aliases normalize in
  ([Roles](#roles)).
- **Handler** — the exported controller function, for jumping to the code.

Where one route file is mounted at several prefixes, the table lists the primary
prefix and notes the aliases; every listed path exists at each alias too. See
[Appendix B: Path aliases](#appendix-b-path-aliases).

#### `/auth` → [auth.routes.ts](../src/routes/auth.routes.ts)

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| POST | `/auth/signup` | Public | — | `signup` |
| POST | `/auth/login` | Public | — | `login` |
| POST | `/auth/refresh` | Public | — | `refreshAccessToken` |
| POST | `/auth/logout` | JWT | — | `logout` |
| POST | `/auth/phone/verify` | Public | — | `verifyPhone` |
| POST | `/auth/phone/register` | Public | — | `registerPhone` |

#### `/delete-account` → [delete-account.routes.ts](../src/routes/delete-account.routes.ts)

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| GET | `/delete-account` | Public | — | `renderDeleteAccountPage` |
| POST | `/delete-account/request` | Public | — | `createDeletionRequest` |

#### `/admins` → [admin.routes.ts](../src/routes/admin.routes.ts)

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| POST | `/admins` | JWT | admin | `createAdmin` |
| GET | `/admins` | JWT | admin | `getAllAdmins` |
| GET | `/admins/deletion-requests` | JWT | admin | `getDeletionRequests` |
| PATCH | `/admins/deletion-requests/:id` | JWT | admin | `updateDeletionRequestStatus` |
| GET | `/admins/:id` | JWT | admin | `getAdminById` |
| PATCH | `/admins/:id` | JWT | admin | `updateAdminById` |
| DELETE | `/admins/:id` | JWT | admin | `deleteAdminById` |

#### `/trainers` → [trainer.routes.ts](../src/routes/trainer.routes.ts)

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| GET | `/trainers/public` | Public | — | `getPublicTrainers` |
| GET | `/trainers/public/:id` | Public | — | `getPublicTrainerById` |
| POST | `/trainers` | JWT | admin | `createTrainer` |
| GET | `/trainers` | JWT | admin | `getAllTrainers` |
| GET | `/trainers/:id` | JWT | admin, trainer | `getTrainerById` |
| PATCH | `/trainers/:id` | JWT | admin, trainer | `updateTrainerById` |
| DELETE | `/trainers/:id` | JWT | admin | `deleteTrainerById` |

#### `/users` → [user.routes.ts](../src/routes/user.routes.ts)

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| POST | `/users` | JWT | admin | `createUser` |
| GET | `/users` | JWT | admin, nutritionist | `getAllUsers` |
| GET | `/users/me` | JWT | user | `getMyUser` |
| GET | `/users/me/reports` | JWT | user | `getMyUserReports` |
| GET | `/users/me/medical-reports` | JWT | user | `getMyMedicalReports` |
| GET | `/users/me/hpod-metrics` | JWT | user | `getMyUserHpodMetrics` |
| POST | `/users/me/hpod-metrics` | JWT | user | `uploadHpodMetrics` |
| GET | `/users/me/reports/:id/pdf` | JWT | user | `getMyUserReportPdf` |
| PATCH | `/users/me/password` | JWT | user | `updateMyPassword` |
| GET | `/users/:id` | JWT | admin, nutritionist, user | `getUserById` |
| GET | `/users/:id/onboarding-profile` | JWT | admin, nutritionist, user | `getOnboardingProfile` |
| GET | `/users/:id/reports/:reportId/url` | JWT | admin, nutritionist | `getReportSignedUrl` |
| PATCH | `/users/:id/onboard` | JWT | admin, user | `onboardUser` |
| PATCH | `/users/:id` | JWT | admin, user | `updateUserById` |
| DELETE | `/users/:id` | JWT | admin | `deleteUserById` |

#### `/memberships` → [membership.routes.ts](../src/routes/membership.routes.ts)

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| POST | `/memberships` | JWT | admin | `createMembership` |
| GET | `/memberships` | JWT | admin, frontdesk | `getAllMemberships` |
| GET | `/memberships/me` | JWT | user | `getMyMemberships` |
| GET | `/memberships/:id` | JWT | admin, frontdesk | `getMembershipById` |
| PATCH | `/memberships/:id` | JWT | admin | `updateMembershipById` |
| DELETE | `/memberships/:id` | JWT | admin | `deleteMembershipById` |

#### `/slots` → [slot.routes.ts](../src/routes/slot.routes.ts)

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| GET | `/slots` | JWT | admin, trainer, user | `getAllSlots` |
| GET | `/slots/available` | JWT | admin, trainer, user | `getAvailableSlots` |
| GET | `/slots/:id` | JWT | admin, trainer, user | `getSlotById` |
| POST | `/slots` | JWT | admin | `createSlot` |
| PATCH | `/slots/:id` | JWT | admin | `updateSlotById` |
| DELETE | `/slots/:id` | JWT | admin | `deleteSlotById` |

#### `/services` → [service.routes.ts](../src/routes/service.routes.ts)

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| GET | `/services` | JWT | admin, trainer, user | `getAllServices` |
| GET | `/services/:id` | JWT | admin, trainer, user | `getServiceById` |
| POST | `/services` | JWT | admin | `createService` |
| PATCH | `/services/:id` | JWT | admin | `updateServiceById` |
| DELETE | `/services/:id` | JWT | admin | `deleteServiceById` |

#### `/therapies` → [therapy.routes.ts](../src/routes/therapy.routes.ts)

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| GET | `/therapies/public` | Public | — | `getPublicTherapies` |
| GET | `/therapies/public/:id` | Public | — | `getPublicTherapyById` |
| GET | `/therapies` | JWT | admin, trainer, user | `getAllTherapies` |
| GET | `/therapies/:id` | JWT | admin, trainer, user | `getTherapyById` |
| POST | `/therapies` | JWT | admin | `createTherapy` |
| PATCH | `/therapies/:id` | JWT | admin | `updateTherapyById` |
| DELETE | `/therapies/:id` | JWT | admin | `deleteTherapyById` |

#### `/bookings` → [booking.routes.ts](../src/routes/booking.routes.ts)

Also mounted at `/api/v1/bookings`, `/api/v1/admin/bookings`. Rate limit: `apiRateLimit`.

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| POST | `/bookings` | JWT | admin, user | `createBooking` |
| GET | `/bookings` | JWT | admin | `getAllBookings` |
| GET | `/bookings/me` | JWT | user | `getMyBookings` |
| GET | `/bookings/:id` | JWT | admin, user | `getBookingById` |
| POST | `/bookings/:id/cancel` | JWT | admin, user | `cancelBookingHandler` |
| POST | `/bookings/:id/attendance` | JWT | admin, user | `recordAttendance` |
| PATCH | `/bookings/:id` | JWT | admin, user | `updateBookingById` |
| DELETE | `/bookings/:id` | JWT | admin, user | `deleteBookingById` |
| PATCH | `/bookings/:id/status` | JWT | admin, user | `changeBookingStatus` |

#### `/credits` → [credit.routes.ts](../src/routes/credit.routes.ts)

Also mounted at `/api/v1/credits`. Rate limit: `apiRateLimit`.

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| GET | `/credits/balance` | JWT | user, admin | `getCreditsBalance` |
| GET | `/credits/ledger` | JWT | user, admin | `getCreditsLedger` |
| GET | `/credits/me/balance` | JWT | user | `getMyCreditBalance` |
| GET | `/credits/me/history` | JWT | user | `getMyCreditHistory` |
| GET | `/credits/users/:userId/balance` | JWT | admin, user | `getUserCreditBalanceById` |
| GET | `/credits/users/:userId/history` | JWT | admin, user | `getUserCreditHistoryById` |
| POST | `/credits/users/:userId/topup` | JWT | admin | `topUpUserCreditsById` |

#### `/schedules` → [schedule.routes.ts](../src/routes/schedule.routes.ts)

Rate limit: `apiRateLimit`.

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| GET | `/schedules/my-schedule` | JWT | — | `getMySchedule` |
| POST | `/schedules` | JWT | user, trainer, admin | `createSchedule` |
| GET | `/schedules/:userId` | JWT | user, trainer, admin | `getScheduleByUserId` |
| PATCH | `/schedules/:userId` | JWT | user, trainer, admin | `updateSchedule` |
| PATCH | `/schedules/:userId/reschedule` | JWT | user, trainer, admin | `rescheduleSchedule` |
| DELETE | `/schedules/:userId` | JWT | admin | `deleteSchedule` |

#### `/exercises` → [exercise.routes.ts](../src/routes/exercise.routes.ts)

Rate limit: `apiRateLimit`.

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| GET | `/exercises` | JWT | admin, user | `listExercises` |
| GET | `/exercises/:id` | JWT | admin, user | `getExerciseById` |
| POST | `/exercises` | JWT | admin, user | `createExercise` |
| PUT | `/exercises/:id` | JWT | admin, user | `updateExercise` |
| DELETE | `/exercises/:id` | JWT | admin, user | `deleteExercise` |

#### `/leads` → [lead.routes.ts](../src/routes/lead.routes.ts)

Rate limit: `apiRateLimit`.

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| POST | `/leads/public-capture` | Public | — | `createPublicLead` |
| POST | `/leads` | JWT | admin, frontdesk, trainer | `createLead` |
| GET | `/leads` | JWT | admin, frontdesk | `getAllLeads` |
| GET | `/leads/stats` | JWT | admin, frontdesk | `getLeadStats` |
| GET | `/leads/:id` | JWT | admin, frontdesk, trainer | `getLeadById` |
| PATCH | `/leads/:id` | JWT | admin, frontdesk, trainer | `updateLeadById` |
| DELETE | `/leads/:id` | JWT | admin, frontdesk | `deleteLeadById` |
| POST | `/leads/:id/convert` | JWT | admin, frontdesk | `convertLeadToUser` |

#### `/invoices` → [invoice.routes.ts](../src/routes/invoice.routes.ts)

Also mounted at `/api/invoices`. Rate limit: `apiRateLimit`.

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| POST | `/invoices` | JWT | admin, frontdesk | `createInvoiceHandler` |
| GET | `/invoices` | JWT | admin, frontdesk | `listInvoicesHandler` |
| GET | `/invoices/:id` | JWT | admin, frontdesk | `getInvoiceByIdHandler` |
| PATCH | `/invoices/:id/status` | JWT | admin, frontdesk | `updateInvoiceStatusHandler` |
| GET | `/invoices/:id/pdf` | JWT | admin, frontdesk | `getInvoicePdfHandler` |

#### `/api/v1` → [class-schedule.routes.ts](../src/routes/class-schedule.routes.ts)

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| POST | `/api/v1/admin/classes/schedule` | JWT | admin | `createScheduledSession` |
| GET | `/api/v1/admin/classes/schedule` | JWT | admin | `getAllSchedulesForAdmin` |
| PATCH | `/api/v1/admin/classes/schedule/:id` | JWT | admin | `updateScheduledSession` |
| PATCH | `/api/v1/admin/classes/schedule/:id/capacity` | JWT | admin | `updateSessionCapacity` |
| GET | `/api/v1/classes/schedule` | JWT | admin, trainer, user | `getSchedulesForMembers` |
| GET | `/api/v1/classes/schedule/:id` | JWT | admin, trainer, user | `getScheduledSessionByIdForMembers` |

#### `/api/v1` → [class.routes.ts](../src/routes/class.routes.ts)

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| POST | `/api/v1/admin/classes` | JWT | admin | `createClass` |
| GET | `/api/v1/admin/classes` | JWT | admin | `getAllClassesForAdmin` |
| PUT | `/api/v1/admin/classes/:id` | JWT | admin | `updateClassById` |
| PATCH | `/api/v1/admin/classes/:id/publish` | JWT | admin | `publishClassById` |
| PATCH | `/api/v1/admin/classes/schedule/:id/publish` | JWT | admin | `publishClassById` |
| DELETE | `/api/v1/admin/classes/:id` | JWT | admin | `softDeleteClassById` |
| GET | `/api/v1/classes` | JWT | admin, trainer, user | `getActiveClassesForMembers` |
| GET | `/api/v1/classes/:id` | JWT | admin, trainer, user | `getClassById` |

#### `/api/v1/zego` → [zego.routes.ts](../src/routes/zego.routes.ts)

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| POST | `/api/v1/zego/sessions/:sessionId/token` | JWT | — | `generateSessionToken` |
| POST | `/api/v1/zego/sessions/:sessionId/end` | JWT | — | `endLiveSession` |
| POST | `/api/v1/zego/sessions/:sessionId/attendance` | JWT | — | `recordSessionAttendance` |
| POST | `/api/v1/zego/sessions/:sessionId/host-presence` | JWT | — | `reportHostPresence` |

#### `/api/v1/admin/settings` → [settings.routes.ts](../src/routes/settings.routes.ts)

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| GET | `/api/v1/admin/settings/rooms` | JWT | — | `getConferenceSettings` |
| PUT | `/api/v1/admin/settings/rooms` | JWT | — | `updateConferenceSettings` |

#### `/membership-plans` → [membershipPlan.routes.ts](../src/routes/membershipPlan.routes.ts)

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| GET | `/membership-plans` | Public | — | `getAllMembershipPlans` |
| GET | `/membership-plans/:id` | JWT | admin, user, trainer | `getMembershipPlanById` |
| POST | `/membership-plans` | JWT | admin | `createMembershipPlan` |
| PATCH | `/membership-plans/:id` | JWT | admin | `updateMembershipPlanById` |
| DELETE | `/membership-plans/:id` | JWT | admin | `deleteMembershipPlanById` |

#### `/onboarding` → [onboarding.routes.ts](../src/routes/onboarding.routes.ts)

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| GET | `/onboarding/status` | JWT | user | `getStatus` |
| GET | `/onboarding/status/:userId` | JWT | admin, frontdesk | `getStatusByUserId` |
| POST | `/onboarding/health-markers` | JWT | user | `submitHealthMarkers` |
| POST | `/onboarding/health-goals` | JWT | user | `submitHealthGoals` |
| POST | `/onboarding/consent` | JWT | user | `submitConsent` |
| POST | `/onboarding/reports` | JWT | user | `submitReport` |
| POST | `/onboarding/complete` | JWT | user | `submitComplete` |

#### `(root)` → [nutritionist-booking.routes.ts](../src/routes/nutritionist-booking.routes.ts)

Also mounted at `/api/v1`.

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| POST | `/onboarding/nutritionist/book` | JWT | user | `bookNutritionist` |
| POST | `/nutritionist/book` | JWT | user | `bookNutritionist` |
| GET | `/nutritionist/my-booking` | JWT | user | `getMemberBooking` |
| GET | `/nutritionist/my-bookings` | JWT | user | `getMyBookings` |
| PATCH | `/nutritionist/my-booking/switch-to-online` | JWT | user | `switchToOnline` |
| PATCH | `/nutritionist/my-booking/reschedule` | JWT | user | `rescheduleMyBooking` |
| POST | `/nutritionist/my-booking/reschedule` | JWT | user | `rescheduleMyBooking` |
| POST | `/onboarding/nutritionist/reschedule` | JWT | user | `rescheduleMyBooking` |
| PATCH | `/onboarding/nutritionist/reschedule` | JWT | user | `rescheduleMyBooking` |
| POST | `/nutritionist/my-booking/switch-to-online` | JWT | user | `switchToOnline` |
| GET | `/nutritionist/bookings` | JWT | admin, nutritionist, frontdesk | `getAllBookingsForAdmin` |
| PATCH | `/admin/nutrition/bookings/:id/accept` | JWT | admin, nutritionist, frontdesk | `acceptBooking` |
| POST | `/admin/nutrition/bookings/:id/accept` | JWT | admin, nutritionist, frontdesk | `acceptBooking` |
| PATCH | `/nutritionist/bookings/:id/accept` | JWT | admin, nutritionist, frontdesk | `acceptBooking` |
| PATCH | `/nutritionist/bookings/:id/reject` | JWT | admin, nutritionist, frontdesk | `rejectBooking` |
| PATCH | `/nutritionist/bookings/:id/complete` | JWT | admin, nutritionist, frontdesk | `completeBooking` |

#### `/nutrition` → [nutrition.routes.ts](../src/routes/nutrition.routes.ts)

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| GET | `/nutrition/my/profile` | JWT | user | `getMyProfileHandler` |
| POST | `/nutrition/profiles` | JWT | nutritionist, admin | `createProfileHandler` |
| GET | `/nutrition/profiles/:userId` | JWT | nutritionist, admin | `getProfileByUserHandler` |
| PATCH | `/nutrition/profiles/:userId` | JWT | nutritionist, admin | `updateProfileHandler` |
| DELETE | `/nutrition/profiles/:userId` | JWT | nutritionist, admin | `deleteProfileHandler` |
| POST | `/nutrition/admin/foods` | JWT | admin | `createSystemFood` |
| POST | `/nutrition/admin/adherence/rebuild` | JWT | admin | `rebuildPlanAdherence` |
| GET | `/nutrition/foods` | JWT | nutritionist, admin, user | `listFoods` |
| POST | `/nutrition/foods` | JWT | nutritionist, admin | `createCustomFood` |
| PATCH | `/nutrition/foods/:id` | JWT | nutritionist, admin | `patchFood` |
| DELETE | `/nutrition/foods/:id` | JWT | nutritionist, admin | `removeFood` |
| GET | `/nutrition/categories` | JWT | nutritionist, admin, user | `listCategoriesHandler` |
| GET | `/nutrition/categories/:categoryId/recipes` | JWT | nutritionist, admin, user | `listRecipesByCategoryHandler` |
| GET | `/nutrition/recipes` | JWT | nutritionist, admin, user | `listRecipesHandler` |
| GET | `/nutrition/recipes/:id` | JWT | nutritionist, admin, user | `getRecipeHandler` |
| POST | `/nutrition/templates/from-category/:categoryId` | JWT | nutritionist, admin | `buildTemplateFromCategoryHandler` |
| POST | `/nutrition/templates/from-recipe/:recipeId` | JWT | nutritionist, admin | `buildTemplateFromRecipeHandler` |
| POST | `/nutrition/templates/copy` | JWT | nutritionist, admin | `copyPlanDayStructure` |
| POST | `/nutrition/templates` | JWT | nutritionist, admin | `createNutritionTemplate` |
| GET | `/nutrition/templates` | JWT | nutritionist, admin | `listNutritionTemplates` |
| GET | `/nutrition/templates/:id` | JWT | nutritionist, admin | `getNutritionTemplate` |
| PATCH | `/nutrition/templates/:id` | JWT | nutritionist, admin | `updateNutritionTemplate` |
| DELETE | `/nutrition/templates/:id` | JWT | nutritionist, admin | `deleteNutritionTemplate` |
| POST | `/nutrition/templates/:id/assign` | JWT | nutritionist, admin | `assignTemplate` |
| GET | `/nutrition/dashboard/stats` | JWT | nutritionist, admin | `dashboardStats` |
| GET | `/nutrition/dashboard/members` | JWT | nutritionist, admin | `dashboardMembers` |
| GET | `/nutrition/users/:userId/dashboard` | JWT | nutritionist, admin | `userDashboard` |
| GET | `/nutrition/members` | JWT | nutritionist, admin | `dashboardMembers` |
| GET | `/nutrition/my/plans` | JWT | user | `listMyPlans` |
| GET | `/nutrition/my/plans/:id` | JWT | user | `getMyPlanById` |
| GET | `/nutrition/my/plans/:id/pdf` | JWT | user | `getPlanPdfHandler` |
| POST | `/nutrition/my/plans/:id/meals/complete` | JWT | user | `completePlanMeal` |
| POST | `/nutrition/my/meal-logs` | JWT | user | `createMealLog` |
| GET | `/nutrition/my/meal-logs` | JWT | user, nutritionist, admin | `listMyMealLogs` |
| PATCH | `/nutrition/my/meal-logs/:id` | JWT | user | `patchMealLog` |
| DELETE | `/nutrition/my/meal-logs/:id` | JWT | user | `removeMealLog` |
| POST | `/nutrition/my/hydration` | JWT | user | `addHydrationIntake` |
| PATCH | `/nutrition/my/hydration/goal` | JWT | user | `updateHydrationGoal` |
| GET | `/nutrition/my/hydration` | JWT | user, nutritionist, admin | `getMyHydration` |
| POST | `/nutrition/my/progress` | JWT | user | `addMyProgress` |
| GET | `/nutrition/my/progress` | JWT | user, nutritionist, admin | `listMyProgress` |
| GET | `/nutrition/my/adherence/weekly` | JWT | user, nutritionist, admin | `getMyWeeklyAdherence` |
| GET | `/nutrition/my/adherence` | JWT | user, nutritionist, admin | `getMyAdherence` |
| POST | `/nutrition/plans` | JWT | nutritionist, admin | `createPlan` |
| GET | `/nutrition/plans` | JWT | nutritionist, admin | `listManagedPlans` |
| GET | `/nutrition/plans/:id` | JWT | nutritionist, admin | `getPlanById` |
| PATCH | `/nutrition/plans/:id` | JWT | nutritionist, admin | `patchPlan` |
| DELETE | `/nutrition/plans/:id` | JWT | nutritionist, admin | `deletePlanHandler` |
| PATCH | `/nutrition/plans/:id/status` | JWT | nutritionist, admin | `changePlanStatus` |
| POST | `/nutrition/plans/:id/pdf` | JWT | nutritionist, admin | `generatePlanPdfHandler` |
| POST | `/nutrition/plans/:id/duplicate` | JWT | nutritionist, admin | `duplicatePlanHandler` |
| GET | `/nutrition/plans/:id/adherence/weekly` | JWT | nutritionist, admin | `getPlanWeeklyAdherence` |
| GET | `/nutrition/plans/:id/adherence` | JWT | nutritionist, admin | `getPlanAdherence` |
| GET | `/nutrition/plans/:id/progress` | JWT | nutritionist, admin | `listPlanProgress` |
| POST | `/nutrition/plans/:id/progress` | JWT | nutritionist, admin | `addPlanProgressEntry` |

#### `/dashboard` → [dashboard.routes.ts](../src/routes/dashboard.routes.ts)

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| GET | `/dashboard/metrics` | JWT | admin, frontdesk | `getDashboardMetrics` |

#### `/webhook` → [webhook.route.ts](../src/routes/webhook.route.ts)

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| POST | `/webhook/email` | Secret | — | `(inline)` |
| GET | `/webhook/reports/me` | JWT | user | `(inline)` |
| GET | `/webhook/reports` | JWT | admin | `(inline)` |
| GET | `/webhook/reports/user/:userId` | JWT | admin | `(inline)` |
| GET | `/webhook/reports/:id` | JWT | admin | `(inline)` |

#### `/workout-plans` → [workout-plan.routes.ts](../src/routes/workout-plan.routes.ts)

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| GET | `/workout-plans/assignments/mine` | JWT | user | `getMyAssignment` |
| GET | `/workout-plans/assignments/mine/schedule` | JWT | user | `getAssignmentSchedule` |
| GET | `/workout-plans/assignments/mine/today` | JWT | user | `getTodayAssignedWorkout` |
| GET | `/workout-plans/assignments/mine/days/:dayNumber` | JWT | user | `getAssignedWorkoutForDay` |
| POST | `/workout-plans/assignments/mine/complete-day` | JWT | user | `completePlanDay` |
| PATCH | `/workout-plans/assignments/mine/days/:dayNumber` | JWT | user | `updateMyDayExercises` |
| GET | `/workout-plans` | JWT | admin, trainer | `listPlans` |
| POST | `/workout-plans` | JWT | admin, trainer | `createPlan` |
| GET | `/workout-plans/:id` | JWT | admin, trainer | `getPlan` |
| PATCH | `/workout-plans/:id` | JWT | admin, trainer | `updatePlan` |
| DELETE | `/workout-plans/:id` | JWT | admin, trainer | `deletePlan` |
| POST | `/workout-plans/:id/assign` | JWT | admin, trainer | `assignUsers` |
| POST | `/workout-plans/:planId/assign-to-me` | JWT | user, trainer, admin | `assignPlan` |

#### `/workouts` → [workout.routes.ts](../src/routes/workout.routes.ts)

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| GET | `/workouts/active` | JWT | user | `getActiveSession` |
| GET | `/workouts/today` | JWT | user | `getTodaySession` |
| GET | `/workouts/me` | JWT | user | `listMySessions` |
| GET | `/workouts/me/stats` | JWT | user | `getMyStats` |
| GET | `/workouts/me/history` | JWT | user | `getMyHistory` |
| POST | `/workouts` | JWT | user | `createSession` |
| GET | `/workouts/:id` | JWT | user | `getSessionById` |
| PATCH | `/workouts/:id` | JWT | user | `updateSession` |
| DELETE | `/workouts/:id` | JWT | user | `deleteSession` |
| POST | `/workouts/:sessionId/exercises` | JWT | user | `addExerciseToSession` |
| PATCH | `/workouts/:sessionId/exercises/reorder` | JWT | user | `reorderExercises` |
| PATCH | `/workouts/:sessionId/exercises/:id` | JWT | user | `updateWorkoutExercise` |
| DELETE | `/workouts/:sessionId/exercises/:id` | JWT | user | `deleteWorkoutExercise` |
| POST | `/workouts/:sessionId/exercises/:exerciseId/sets` | JWT | user | `logSet` |
| PATCH | `/workouts/:sessionId/exercises/:exerciseId/sets/:setId` | JWT | user | `updateSet` |
| DELETE | `/workouts/:sessionId/exercises/:exerciseId/sets/:setId` | JWT | user | `deleteSet` |

#### `/notifications` → [notification.routes.ts](../src/routes/notification.routes.ts)

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| GET | `/notifications` | JWT | — | `listNotifications` |
| PATCH | `/notifications/read-all` | JWT | — | `markAllRead` |
| PATCH | `/notifications/:id/read` | JWT | — | `markNotificationRead` |
| POST | `/notifications/fcm-token` | JWT | — | `registerToken` |

#### `/internal` → [internal.routes.ts](../src/routes/internal.routes.ts)

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| POST | `/internal/reminders/tick` | Public | — | `(inline)` |
| POST | `/internal/sessions/lifecycle/tick` | Public | — | `(inline)` |
| POST | `/internal/leads/followup` | Public | — | `(inline)` |

#### Declared inline in [src/app.ts](../src/app.ts)

| Method | Path | Auth | Roles | Handler |
|---|---|---|---|---|
| GET | `/health` | Public | — | inline |
| POST | `/test/firebase` | Public | — | inline |

<!-- generated: 248 route declarations across 29 route files -->

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
| `gender` | Gender | yes | `Male` \| `Female` \| `Other` (legacy numeric `0`–`2` accepted) |
| `password` | string | yes | min 8, must contain letter + number |

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
    "password": "Sup3rSecret!"
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

Exchange credentials for a JWT. The login route resolves identity across the `User`, `Admin`, and `Trainer` collections by email; the returned `role` reflects which collection matched.

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
const accessToken: string = data.accessToken;
```

**Success response (200)**

```json
{
  "message": "Login successful",
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "tokenType": "Bearer",
  "expiresIn": "12h",
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
- `refreshToken` is only returned when `JWT_REFRESH_SECRET` is configured.

### POST /auth/refresh

Exchange a refresh token for a new access token.

**Auth:** Public (rate-limited)

**Request body**

| Field | Type | Required |
|---|---|---|
| `refreshToken` | string | yes |

```bash
curl -X POST "https://api.example.com/auth/refresh" \
  -H "Content-Type: application/json" \
  -d '{ "refreshToken": "<refresh-token>" }'
```

**Success (200)**

```json
{
  "message": "Token refreshed",
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "tokenType": "Bearer",
  "expiresIn": "12h"
}
```

**Errors:** 400 invalid payload, 401 invalid/expired refresh token, 503 refresh not configured.

### POST /auth/logout

Invalidate the current access token by adding it to the blacklist until it expires.

**Auth:** Bearer (any role)

```bash
curl -X POST "https://api.example.com/auth/logout" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "message": "Logged out successfully" }`

### POST /auth/phone/verify

Phone + OTP sign-in for the Flutter app. The client runs the Firebase phone-auth
flow, then posts the resulting **Firebase ID token**; the backend verifies it and
exchanges it for its own JWT. The backend never sends or validates an OTP itself.

**Auth:** Public (rate-limited)

**Request body**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `firebaseIdToken` | string | yes | min 1 — Firebase ID token from the client SDK |

Account lookup order: `firebaseUid`, then last-10-digits phone match. A legacy
account matched by phone is backfilled with `firebaseUid`, `phoneVerified: true`,
and a normalized 10-digit `phone`.

```bash
curl -X POST "https://api.example.com/auth/phone/verify" \
  -H "Content-Type: application/json" \
  -d '{"firebaseIdToken":"eyJhbGciOiJSUzI1NiIs..."}'
```

**Success (200) — returning user**

```json
{
  "message": "Login successful",
  "isNewUser": false,
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "tokenType": "Bearer",
  "expiresIn": "12h",
  "user": {
    "id": "5f1a2b3c4d5e6f7a8b9c0d1e",
    "email": "",
    "role": "user",
    "onboarded": false,
    "onboardingStatus": { "currentStep": "HEALTH_MARKERS", "completedSteps": [] }
  }
}
```

`email` is `""` for phone-only accounts. `refreshToken` is `null` when refresh
tokens are not configured.

**Success (200) — unknown phone number**

No user is created. The client must follow up with `/auth/phone/register`.

```json
{ "isNewUser": true, "phoneNumber": "5555550123" }
```

**Errors**

| Status | Body | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing/empty `firebaseIdToken` |
| 401 | `UNAUTHORIZED` | Firebase rejected the token |
| 503 | `NOT_IMPLEMENTED` | `FIREBASE_NOT_CONFIGURED`, or JWT not configured |

### POST /auth/phone/register

First-time account creation after OTP verification. Creates the `User`, upserts
a `Lead` keyed by phone, and returns the same auth envelope as
`/auth/phone/verify`.

**Auth:** Public (rate-limited)

**Request body**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `firebaseIdToken` | string | yes | min 1 |
| `name` | string | yes | min 1 → `username` |
| `goal` | string | yes | min 1 → `goal`, and the Lead's `interestedIn` |
| `age` | number | yes | 0–130 (numeric strings coerced) |
| `gender` | Gender | yes | `Male` \| `Female` \| `Other`; legacy `0`/`1`/`2` and `"Others"` normalized |

```bash
curl -X POST "https://api.example.com/auth/phone/register" \
  -H "Content-Type: application/json" \
  -d '{
    "firebaseIdToken": "eyJhbGciOiJSUzI1NiIs...",
    "name": "Jane Doe",
    "goal": "Weight loss",
    "age": 29,
    "gender": "Female"
  }'
```

**Success (201)** — `{ "message": "User signup successful", "isNewUser": true, ...authEnvelope }`

The new user starts at `currentStep: "HEALTH_MARKERS"` with all step flags false.

**Success (200) — already registered.** Idempotent: an existing `firebaseUid` or
phone match returns `{ "message": "Login successful", "isNewUser": false, ... }`
rather than creating a duplicate. A duplicate-key race (`E11000`) is caught and
resolved the same way.

**Errors:** same table as `/auth/phone/verify`.

> Lead upsert failure is swallowed and logged — a CRM write must never fail
> account creation. The response is unaffected.

---

## Account deletion — `/delete-account`

Public, user-facing account deletion request flow, required by the App Store and
Play Store. Nothing here deletes data directly: it records a
`DeletionRequest` for an admin to action via
[`/admins/deletion-requests`](#get-adminsdeletion-requests).

Both routes are rate-limited by `publicDeleteAccountRateLimit`.

### GET /delete-account

Renders the public HTML request page. Returns `text/html`, not JSON.

**Auth:** Public

### POST /delete-account/request

Log a deletion request. Identity is proven with a Firebase ID token, so the
caller does not need a backend JWT.

**Auth:** Public

**Request body**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `firebaseIdToken` | string | yes | min 1 |
| `reason` | string | no | max 500, defaults to `""` |
| `confirm` | boolean | yes | must be exactly `true` |

`confirm` is a hard gate — any value other than `true` fails validation with
"You must confirm that you understand this action is permanent."

```bash
curl -X POST "https://api.example.com/delete-account/request" \
  -H "Content-Type: application/json" \
  -d '{"firebaseIdToken":"eyJ...","reason":"No longer using the app","confirm":true}'
```

**Errors:** 400 validation, 401 invalid Firebase token, 429 rate limited.

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

### GET /admins/deletion-requests

Review account-deletion requests submitted through
[`POST /delete-account/request`](#post-delete-accountrequest).

> Declared **before** `/admins/:id` in the router so the literal segment wins the
> match. Keep that ordering when editing
> [admin.routes.ts](../src/routes/admin.routes.ts).

**Query params**

| Param | Type | Default | Constraints |
|---|---|---|---|
| `page` | number | `1` | ≥ 1 |
| `limit` | number | `20` | 1–100 |
| `status` | `DeletionRequestStatus` | — | `Pending` \| `Processed` \| `Cancelled` |

```bash
curl "https://api.example.com/admins/deletion-requests?status=Pending&limit=50" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200)** — newest first:

```json
{
  "requests": [
    {
      "id": "6650f1a2b3c4d5e6f7a8b9c0",
      "userId": "5f1a2b3c4d5e6f7a8b9c0d1e",
      "fullName": "Jane Doe",
      "email": "user@example.com",
      "phone": "5555550123",
      "reason": "No longer using the app",
      "status": "Pending",
      "ipAddress": "203.0.113.9",
      "userAgent": "Mozilla/5.0 ...",
      "createdAt": "2026-08-01T10:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 3, "totalPages": 1 }
}
```

**Errors:** 400 `VALIDATION_ERROR`, 401 `UNAUTHORIZED`, 403 `FORBIDDEN`.

### PATCH /admins/deletion-requests/:id

Action a deletion request.

**Path params:** `id` — deletion request ObjectId.

**Request body**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `status` | string | yes | `Processed` or `Cancelled` only — `Pending` is not accepted |

> **`Processed` is destructive and irreversible.** It runs
> `deleteAndAnonymizeUserData(userId)` against the matched account. The user is
> resolved from `request.userId`, falling back to an email lookup and then a
> last-10-digits phone lookup, so an account created *after* the request was
> filed can still be matched. If nothing matches, the request is still marked
> `Processed` and a `[ADMIN_DELETION]` warning is logged — no data is touched.
>
> `Cancelled` only changes the status.

```bash
curl -X PATCH "https://api.example.com/admins/deletion-requests/6650f1a2b3c4d5e6f7a8b9c0" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"Cancelled"}'
```

**Success (200)**

```json
{
  "message": "Deletion request successfully updated to: Cancelled",
  "request": { "id": "6650f1a2b3c4d5e6f7a8b9c0", "status": "Cancelled" }
}
```

**Errors**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid id, or `status` not `Processed`/`Cancelled` |
| 404 | `NOT_FOUND` | No such deletion request |
| 409 | `CONFLICT` | Request is not `Pending` — already processed |

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

**Auth:** Bearer (`admin`, `nutritionist`)

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

List the authenticated user's uploaded medical/DNA reports (unified feed, summary form).

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
      "title": "Blood Panel April 2026",
      "type": "Blood Test",
      "summary": "Uploaded Blood Test report",
      "suggestions": [],
      "recommendations": [],
      "insights": [],
      "generated_date": "2026-05-22T08:00:00.000Z",
      "pdf_url": "https://fitflix-storage.s3.ap-south-1.amazonaws.com/..."
    }
  ]
}

### GET /users/me/medical-reports

List the authenticated user's uploaded medical/DNA reports with short-lived signed URLs.

**Auth:** Bearer (`user`)

```bash
curl "https://api.example.com/users/me/medical-reports" -H "Authorization: Bearer $TOKEN"
```

**Success (200)**

```json
{
  "reports": [
    {
      "_id": "5f1a2b3c4d5e6f7a8b9c0d1e",
      "reportName": "Blood Panel April 2026",
      "reportType": "Blood Test",
      "reportUrl": "https://fitflix-storage.s3.ap-south-1.amazonaws.com/...",
      "createdAt": "2026-05-25T08:49:09.886Z"
    }
  ]
}
```
```

### GET /users/me/bca-metrics

Return the authenticated user's cached BCA (Body Composition Analysis) metric history, most recent first.

**Auth:** Bearer (`user`)

```bash
curl "https://api.example.com/users/me/bca-metrics" -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "history": [ /* BcaMetric documents */ ] }`

### POST /users/me/bca-metrics/sync

Pull the latest BCA records from the ActiveX external API for the caller's phone number, upsert them, and return the refreshed history.

**Auth:** Bearer (`user`)

**Request body:** none.

```bash
curl -X POST "https://api.example.com/users/me/bca-metrics/sync" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "success": true, "synced": 1, "history": [ /* BcaMetric documents */ ] }`

**Errors:** `400 NO_PHONE`, `500 NOT_CONFIGURED`, `502 UNAUTHORIZED | BAD_REQUEST | UPSTREAM_ERROR`.

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

Get any user.

**Auth:** Bearer (`admin`, `nutritionist`, `user`)

**Path params:** `id` — user ObjectId.

```bash
curl "https://api.example.com/users/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "user": { /* ... */ } }`

### GET /users/:id/onboarding-profile

Return the aggregated onboarding profile for a user (markers, goals, consent, reports, nutritionist booking).

**Auth:** Bearer (`admin`, `nutritionist`, `user`)

```bash
curl "https://api.example.com/users/5f1a2b3c4d5e6f7a8b9c0d1e/onboarding-profile" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "user": { /* ... */ }, "healthMarkers": { /* ... */ }, "healthGoals": { /* ... */ } }`

### GET /users/:id/reports/:reportId/url

Generate a short-lived signed URL for a specific uploaded report.

**Auth:** Bearer (`admin`, `nutritionist`)

```bash
curl "https://api.example.com/users/5f1a2b3c4d5e6f7a8b9c0d1e/reports/5f1a2b3c4d5e6f7a8b9c0d2f/url" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200)**

```json
{ "url": "https://fitflix-storage.s3.ap-south-1.amazonaws.com/...", "expiresIn": 900 }
```

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

All routes require `Authorization: Bearer <token>`. Every route is `user`-only
except `GET /onboarding/status/:userId`, which is `admin` + `frontdesk`.

Common step-order errors, raised by `OnboardingServiceError` in
[onboarding.service.ts](../src/utils/onboarding.service.ts):

| Status | Code | When |
|---|---|---|
| 403 | `STEP_NOT_ALLOWED` | Submitting a step other than `currentStep` |
| 409 | `ALREADY_COMPLETED` | Onboarding has already been finalized |
| 400 | `MISSING_STEPS` | `POST /onboarding/complete` called before all steps done |
| 404 | `NOT_FOUND` | User id invalid or user does not exist |

### GET /onboarding/status

Current step for the calling user, plus the latest non-rejected nutritionist
booking.

**Auth:** Bearer (`user` only — any other role gets `403 FORBIDDEN`)

```bash
curl "https://api.example.com/onboarding/status" -H "Authorization: Bearer $TOKEN"
```

**Success (200)**

The response is exactly `OnboardingStatusResponse` from
[onboarding.service.ts](../src/utils/onboarding.service.ts) — the per-step
booleans live on the User document but are **not** part of this payload.

```json
{
  "currentStep": "HEALTH_GOALS",
  "completedSteps": ["HEALTH_MARKERS"],
  "onboardingCompleted": false,
  "allowedNextStep": "HEALTH_GOALS",
  "bookingDetails": null
}
```

| Field | Type | Notes |
|---|---|---|
| `currentStep` | `OnboardingStep` | Defaults to `HEALTH_MARKERS` when unset |
| `completedSteps` | `OnboardingStep[]` | Append-only history |
| `onboardingCompleted` | boolean | Mirrors `onboardingStatus.onboardingCompleted` |
| `allowedNextStep` | `OnboardingStep \| null` | Equals `currentStep`, or `null` once complete |
| `bookingDetails` | object \| null | Latest nutritionist booking whose status is not `REJECTED` |

When present, `bookingDetails` is:

```json
{
  "_id": "6650f1a2b3c4d5e6f7a8b9c0",
  "bookingStatus": "ACCEPTED",
  "appointmentMode": "ONLINE",
  "clinicLocation": null,
  "zegoRoomId": "nutri_session_6650f1a2b3c4d5e6f7a8b9c0",
  "assignedNutritionistId": "6650aaa2b3c4d5e6f7a8b9c0",
  "assignedNutritionistName": "Dr. Rao",
  "meetingStatus": "SCHEDULED",
  "bookingDate": "2026-08-14T00:00:00.000Z",
  "startTime": "10:00",
  "endTime": "10:30",
  "acceptedAt": "2026-08-10T09:12:00.000Z"
}
```

**Errors:** 400 `BAD_REQUEST` (invalid user id), 403 `FORBIDDEN`, 404 `NOT_FOUND`.

### GET /onboarding/status/:userId

Same payload as above, for any user. Used by the FrontDesk dashboard.

**Auth:** Bearer (`admin`, `frontdesk`)

| Path param | Type | Notes |
|---|---|---|
| `userId` | ObjectId | 400 `BAD_REQUEST` if not a valid ObjectId |

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

**Request body** (either format)

**Preferred (dual-consent)**

```json
{
  "consents": [
    { "type": "WELLNESS_SERVICES", "accepted": true, "signatureName": "Rahul" },
    { "type": "GYM_FITNESS", "accepted": true, "signatureName": "Rahul" }
  ]
}
```

**Legacy (still accepted)**

```json
{ "accepted": true, "signatureUrl": "https://cdn.example.com/signatures/user.png" }
```

**Success (201):** `{ "message": "Consent submitted", "consentForm": { /* ... */ } }`

### POST /onboarding/reports

Step 4. Multiple reports allowed; call repeatedly.

**Request body**

Prefer `multipart/form-data` with a file upload (field name `file`). JSON-only payloads are accepted as a legacy fallback.

**Multipart form-data**

- `file` (required) - PDF or image
- `reportName` (required)
- `reportType` (required)

```bash
curl -X POST "https://api.example.com/onboarding/reports" \
  -H "Authorization: Bearer $TOKEN" \
  -F "reportName=Blood Panel" \
  -F "reportType=lab" \
  -F "file=@/path/to/report.pdf"
```

**Legacy JSON**

```json
{ "reportName": "Blood Panel", "reportType": "lab", "reportUrl": "https://files.example.com/report.pdf" }
```

**Success (201):** `{ "message": "Report uploaded", "report": { /* ... */ } }`

### Nutritionist booking step

There is **no** `/onboarding/nutritionist` or `/onboarding/appointments` route on
the onboarding router. The booking step is served by the nutritionist-booking
router, which is mounted at the app root and therefore answers on the
`/onboarding/...` prefix:

| Method | Path | Handler |
|---|---|---|
| POST | `/onboarding/nutritionist/book` | `bookNutritionist` |
| POST, PATCH | `/onboarding/nutritionist/reschedule` | `rescheduleMyBooking` |

Both are documented under
[Nutritionist bookings](#nutritionist-bookings--nutritionist); the
`/onboarding/...` spellings are exact aliases of the `/nutritionist/...` ones.

`bookNutritionist` sets `onboardingStatus.nutritionistBooked = true` and, when
the caller's current step is `REPORT_UPLOAD` or `NUTRITIONIST_BOOKING`, calls
`advanceStep(NUTRITIONIST_BOOKING)`. It never fails onboarding-wise: a
post-onboarding user booking a follow-up gets a normal `201`.

### POST /onboarding/complete

Finalize onboarding. Validates all prior steps. Sets both `user.onboarded = true` and `onboardingStatus.onboardingCompleted = true`.

```bash
curl -X POST "https://api.example.com/onboarding/complete" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
```

**Success (200):** `{ "message": "Onboarding completed", "completedAt": "2026-05-22T12:00:00.000Z" }`

**Errors:** 400 `MISSING_STEPS`, 409 `ALREADY_COMPLETED`.

---

## Trainers — `/trainers`

Trainer accounts. `/trainers/public*` are declared before
`router.use(authenticateToken)` and are therefore unauthenticated; everything
else needs a JWT.

| Method | Path | Auth |
|---|---|---|
| GET | `/trainers/public` | Public |
| GET | `/trainers/public/:id` | Public |
| POST | `/trainers` | `admin` |
| GET | `/trainers` | `admin` |
| GET | `/trainers/:id` | `admin`, `trainer` |
| PATCH | `/trainers/:id` | `admin`, `trainer` |
| DELETE | `/trainers/:id` | `admin` |

**Request body (create)**

| Field | Type | Required |
|---|---|---|
| `trainerName` | string | yes |
| `email` | string | yes (unique) |
| `phone` | string | yes |
| `password` | string | yes |
| `specialities` | string[] | no |

The public endpoints return a reduced projection with no contact details or
credentials.

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

Responses wrap the resource as `{ "trainer": { ... } }` for single reads and
`{ "trainers": [ ... ] }` for the list. Errors follow the standard envelope:
400 `VALIDATION_ERROR`, 401 `UNAUTHORIZED`, 403 `FORBIDDEN`, 404 `NOT_FOUND`,
409 `CONFLICT` (email already registered).

---

## Classes — `/api/v1/classes`

Class **templates** — the reusable definition of a class (name, capacity, credit
cost, booking window). Concrete dated occurrences live in
[Class schedules](#class-schedules--apiv1classesschedule).

Mounted from [class.routes.ts](../src/routes/class.routes.ts) at `/api/v1`, so
admin paths read `/api/v1/admin/classes` and member paths `/api/v1/classes`. All
routes require a JWT.

> **`Class._id` is a UUID string, not an ObjectId.** It defaults to
> `randomUUID()`. Handlers validate with `isValidUuid`, so passing a 24-character
> ObjectId returns `400 "Invalid class id format"`. This is the one resource in
> the API whose ids are not Mongo ObjectIds.

### POST /api/v1/admin/classes

Create a class template.

**Auth:** Bearer (`admin`)

**Request body** — only `name` and `creditCost` are required; everything else
has a server default.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `name` | string | yes | — | min 1 after trim |
| `creditCost` | number | yes | — | integer ≥ 0 |
| `description` | string | no | `""` | |
| `mode` | enum | no | `offline` | `online` \| `offline` \| `hybrid` |
| `sessionType` | enum | no | `""` | `group_class` \| `live_stream` \| `""` |
| `instructor` | string | no | `"Staff"` | Display name only |
| `instructorUserId` | ObjectId \| null | no | `null` | **Determines the ZEGOCLOUD host.** Must match the instructor's `User._id` or they cannot host |
| `durationMinutes` | number | no | `60` | |
| `maxParticipants` | number | no | `20` | |
| `tags` | string[] | no | `[]` | |
| `scheduleInfo` | string | no | `""` | Free-text display string |
| `recurrenceRule` | enum | no | `NONE` | `NONE` \| `DAILY` \| `WEEKLY` \| `MONTHLY` |
| `schedulePattern` | string \| null | no | `null` | |
| `scheduleType` | string | no | `"Fixed Session"` | |
| `daysOfWeek` | number[] | no | `[]` | 0–6, Sunday = 0 |
| `locationAddress` | string | no | `""` | |
| `streamRoomId` | string | no | `""` | Zego **layout template** name, not a room id |
| `enableWaitlist` | boolean | no | `false` | |
| `status` | enum | no | `ACTIVE` | `ACTIVE` \| `INACTIVE` |
| `access` | enum | no | `members_only` | `members_only` \| `open_to_all` |
| `bookingRequirement` | enum | no | `credits_required` | `free` \| `credits_required` |
| `bookingWindowValue` | number | no | `72` | Positive integer — how far ahead booking opens |
| `bookingWindowUnit` | enum | no | `hours` | `hours` \| `days` |
| `bookingCloseValue` | number \| null | no | `null` | Cutoff before start; `""` coerces to `null` |
| `bookingCloseUnit` | enum \| null | no | `null` | `minutes` \| `hours` \| `days` |
| `occurrenceLeadMinutes` | number | no | `30` | Minutes before start that the video room is prepared |
| `isPublished` | boolean | no | `true` | |

```bash
curl -X POST "https://api.example.com/api/v1/admin/classes" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "name": "Sunrise Vinyasa",
    "creditCost": 2,
    "mode": "hybrid",
    "sessionType": "group_class",
    "instructorUserId": "5f1a2b3c4d5e6f7a8b9c0d1e",
    "maxParticipants": 25
  }'
```

**Success (201):** `{ "message": "Class created", "class": { /* class doc */ } }`

**Errors:** `400 { "message": "Invalid class payload", "errors": [ /* Zod issues */ ] }`.

> Class endpoints return Zod issues under `errors`, not the `code` +
> `details` envelope used elsewhere. See [Error responses](#error-responses).

### GET /api/v1/admin/classes

All classes regardless of status, newest first. No query filters.

**Auth:** Bearer (`admin`)

**Success (200):** `{ "classes": [ /* ... */ ] }`

### PUT /api/v1/admin/classes/:id

Update a class. Note **PUT**, not PATCH — but the body is a partial update and at
least one field must be present.

**Auth:** Bearer (`admin`)

**Path params:** `id` — class UUID.

**Request body:** any subset of the create fields. An empty object fails with
"At least one field must be provided for update".

**Success (200):** `{ "message": "Class updated", "class": { /* ... */ } }`

**Errors:** 400 invalid UUID, 400 invalid payload, 404 `{ "message": "Class not found" }`.

> Saving a class calls `syncSessionsForClass`, which propagates the changed
> fields down onto that class's future `ScheduledSession` documents.

### PATCH /api/v1/admin/classes/:id/publish

Publish or unpublish a class. Also available at
`PATCH /api/v1/admin/classes/schedule/:id/publish` — the same handler bound
twice, both taking a **class** id.

**Auth:** Bearer (`admin`)

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `isPublished` | boolean | no | Defaults to `true` when omitted. `is_published` accepted as a snake_case alias |

Sets `status` to `ACTIVE` when publishing and `INACTIVE` when unpublishing, then
runs `syncSessionsForClass`.

**Success (200):** `{ "message": "Class published" | "Class unpublished", "class": { /* ... */ } }`

### DELETE /api/v1/admin/classes/:id

Delete or retire a class. The behaviour depends on whether anyone has booked it:

| Condition | Effect | Response message |
|---|---|---|
| Any `Booking` for the class, or any session with `currentBookings > 0` | Soft delete: `status` → `INACTIVE`, then unbooked sessions are removed | `"Class retired"` |
| No bookings at all | Hard delete of the class **and** all its sessions | `"Class deleted successfully"` |

**Auth:** Bearer (`admin`)

**Success (200):** `{ "message": "...", "class": { /* ... */ } }`

**Errors:** 400 invalid UUID, 404 `{ "message": "Class not found" }`.

### GET /api/v1/classes

Member-facing catalogue: only classes with `status: "ACTIVE"` **and**
`isPublished` not `false`, newest first.

**Auth:** Bearer (`admin`, `trainer`, `user`)

**Success (200):** `{ "classes": [ /* ... */ ] }`

### GET /api/v1/classes/:id

One class by UUID.

**Auth:** Bearer (`admin`, `trainer`, `user`)

**Success (200):** `{ "class": { /* ... */ } }`

**Errors:** 400 invalid UUID; 404 with a hint when the id is a session rather
than a class:

```json
{ "message": "Class not found. If this is a session id, use GET /api/v1/classes/schedule/:id." }
```

---

## Class schedules — `/api/v1/classes/schedule`

Dated **occurrences** of a class. A `ScheduledSession` is what members book and
what the video-room lifecycle operates on.

Mounted from [class-schedule.routes.ts](../src/routes/class-schedule.routes.ts)
at `/api/v1`. All routes require a JWT.

### Session lifecycle

Two independent state fields, deliberately separate because a room outlives its
class by the expiry grace:

| Field | Values | Meaning |
|---|---|---|
| `status` | `SCHEDULED`, `FULL`, `CANCELLED`, `COMPLETED` | Booking state. `FULL` sessions stay in the member feed so a sold-out class renders as full instead of disappearing |
| `roomStatus` | `PENDING`, `READY`, `EXPIRED` | Video-room state, driven by [`POST /internal/sessions/lifecycle/tick`](#post-internalsessionslifecycletick) |

Room timeline for one session:

1. `PENDING` — created; no `videoRoomId` yet.
2. `READY` at `start − occurrenceLeadMinutes` — the sweep stamps `videoRoomId` and
   `roomReadyAt`. Readers that run before the sweep fall back to
   `deriveRoomId(_id)`, which produces the identical value.
3. `hostLiveAt` set — first confirmed instant the host was actually in the room,
   from `POST /api/v1/zego/sessions/:id/host-presence` or the sweep's Zego
   membership check. **Write-once**: members are gated on it being non-null, so a
   flaky host connection never ejects members already admitted.
4. `EXPIRED` at `end + grace` — everyone is kicked, `roomStatus` → `EXPIRED`,
   `status` → `COMPLETED`.

### POST /api/v1/admin/classes/schedule

Schedule one or more occurrences of a class.

**Auth:** Bearer (`admin`)

**Request body**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `classId` | string | yes | — | Class UUID |
| `sessionDate` | string | yes | — | Date of the first occurrence |
| `startTime` | string | yes | — | `HH:mm`, 24-hour (`00:00`–`23:59`) |
| `endTime` | string | yes | — | `HH:mm`; must be after `startTime` |
| `trainerId` | string | no | — | Conflict-checked against the trainer's other sessions |
| `deliveryType` | enum | no | *inherited* | `ONLINE` \| `OFFLINE` \| `HYBRID`. **Omitting it inherits the parent class's `mode`** — deliberately no default, so an online class can't get `OFFLINE` sessions |
| `locationAddress` | string | no | — | |
| `capacity` | number | no | `20` | Positive integer |
| `recurrenceRule` | enum | no | `NONE` | `NONE` \| `DAILY` \| `WEEKLY` |
| `repeatCount` | number | no | `1` | 1–30 occurrences |
| `streamRoomId` | string | no | — | Zego layout template |
| `isPublished` | boolean | no | `true` | |

```bash
curl -X POST "https://api.example.com/api/v1/admin/classes/schedule" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "classId": "3f1b8c2e-9d4a-4c77-91b2-0a5e6d7c8f90",
    "sessionDate": "2026-08-15",
    "startTime": "07:00",
    "endTime": "08:00",
    "recurrenceRule": "WEEKLY",
    "repeatCount": 8
  }'
```

**Success (201)**

```json
{
  "message": "Class session scheduled successfully",
  "count": 8,
  "sessions": [ /* created ScheduledSession docs */ ]
}
```

**Errors**

| Status | Message | When |
|---|---|---|
| 400 | `Validation failed for schedule creation` | Zod issues under `errors` |
| 400 | `Session end time must be after start time` | |
| 400 | `Cannot schedule class sessions in the past` | |
| 404 | `Class not found` | `classId` doesn't resolve |
| 409 | `Trainer is already scheduled for a conflicting session at this time` | Overlaps another session for that trainer |

### GET /api/v1/admin/classes/schedule

All non-cancelled sessions, for the admin calendar.

**Auth:** Bearer (`admin`)

**Query params:** `classId`, `trainerId`, `date`, `startDate`, `endDate` — all
optional; `startDate`/`endDate` bound a range.

**Success (200)**

```json
{
  "message": "Scheduled sessions retrieved successfully",
  "count": 12,
  "sessions": [ /* ... */ ]
}
```

Each session carries both `videoRoomId` and `videoConferenceId`. They always hold
the same value — the duplicate exists so the admin host and the user app resolve
the identical room. Never derive one from the other.

### PATCH /api/v1/admin/classes/schedule/:id

Update a session.

**Auth:** Bearer (`admin`)

**Request body:** any of `trainerId`, `sessionDate`, `startTime`, `endTime`,
`deliveryType`, `locationAddress`, `capacity`, `status`, `streamRoomId`,
`isPublished`. `status` accepts `SCHEDULED`, `CANCELLED`, `COMPLETED`.

**Success (200):** the updated session.

**Errors:** 400 validation, 404 `Scheduled session not found`, plus:

```json
{ "message": "Use POST /api/v1/zego/sessions/:sessionId/end to end a live session." }
```

returned `400` when the update tries to end a live session — ending must go
through the Zego flow so attendance is backfilled and participants are kicked.

### PATCH /api/v1/admin/classes/schedule/:id/capacity

Resize a session, delegating to the capacity engine so existing bookings are
reconciled.

**Auth:** Bearer (`admin`)

**Request body**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `capacity` | number | yes | Positive integer ≥ 1 |

**Success:** the engine's own result object, returned with its own status code.

**Errors:** `400 { "message": "Capacity must be a positive integer" }`.

### GET /api/v1/classes/schedule

Member-facing feed. Returns sessions whose `status` is `SCHEDULED` **or**
`FULL`.

**Auth:** Bearer (`admin`, `trainer`, `user`)

**Query params:** `date` — optional, restricts to a single day.

**Success (200):** `{ "message": "...", "count": 5, "sessions": [ /* ... */ ] }`

### GET /api/v1/classes/schedule/:id

One session, with `videoRoomId`/`videoConferenceId` resolved.

**Auth:** Bearer (`admin`, `trainer`, `user`)

**Path params:** `id` — accepts a session ObjectId or UUID.

**Success (200):** `{ "session": { /* ... */ } }`

**Errors:** 400 invalid id format, 404 `Session not found`.

---

## Video sessions (ZEGOCLOUD) — `/api/v1/zego`

Video-room access for group classes, live streams, and online nutritionist
consultations. From [zego.routes.ts](../src/routes/zego.routes.ts).

All four routes require a JWT and take `:sessionId` in the path. **None of them
declares `authorize([...])`** — authorization is per-session, resolved inside
`resolveSessionAccess`, so an instructor can host their own class without holding
the `admin` role.

### The access model

Every endpoint here routes through
[`resolveSessionAccess`](../src/services/session-access.service.ts), the single
place where join-window, role, and lifecycle rules live. It returns either a
grant (with `role`, `roomId`, `ttlSeconds`, and the window boundaries) or a
denial.

**Role** is derived server-side: `host` when the caller matches the class's
`instructorUserId` or is an admin operator, otherwise `member`.

**The room is always derived from the caller's booking.** There is deliberately
no endpoint that mints a token for a client-supplied room id — that would hand
any authenticated user the keys to every room in the project.

**Denial codes**

| Code | HTTP | Meaning |
|---|---|---|
| `NO_SCHEDULE` | 409 | Session has no valid schedule |
| `NO_BOOKING` | 403 | Caller has no active booking for this session |
| `CANCELLED` | 409 | Session was cancelled |
| `ENDED` | 409 | Class has ended |
| `NOT_OPEN_YET` | 403 | Join window hasn't opened |
| `HOST_NOT_STARTED` | 403 | Host hasn't started the class yet |
| `NO_ROOM` | 409 | No video room available for this session |

Denial responses carry `startsAt`/`endsAt` when known, so a client can render an
accurate countdown:

```json
{
  "message": "The join window for this class has not opened yet.",
  "code": "NOT_OPEN_YET",
  "startsAt": "2026-08-15T07:00:00.000Z",
  "endsAt": "2026-08-15T08:00:00.000Z"
}
```

### POST /api/v1/zego/sessions/:sessionId/token

Mint a ZEGOCLOUD token scoped to exactly one room, expiring when the caller's
join window closes.

**Auth:** Bearer (any role; access resolved per session)

**Request body:** none.

**Privileges granted** — the token binds `room_id`, so it is not a skeleton key:

| Caller | Privilege | Effect |
|---|---|---|
| Host, or member of a `group_class` | `{1:1, 2:1}` | Login + publish |
| Member of a `live_stream` | `{1:1, 2:0}` | Login only — a patched client still cannot publish into someone else's broadcast |

```bash
curl -X POST "https://api.example.com/api/v1/zego/sessions/6650f1a2b3c4d5e6f7a8b9c0/token" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200)**

```json
{
  "token": "04AAAAAGa1...",
  "appID": 1234567890,
  "roomId": "session_6650f1a2b3c4d5e6f7a8b9c0",
  "userId": "5f1a2b3c4d5e6f7a8b9c0d1e",
  "userName": "jane.doe",
  "role": "member",
  "expiresAt": "2026-08-15T08:15:00.000Z",
  "roomOpensAt": "2026-08-15T06:30:00.000Z",
  "sessionEndsAt": "2026-08-15T08:00:00.000Z",
  "windowClosesAt": "2026-08-15T08:10:00.000Z",
  "hostLiveAt": "2026-08-15T06:58:12.000Z"
}
```

`userName` resolves from the `User` document, falling back to the email local
part, then to `"Host"`/`"Member"`.

> **Side effect:** issuing a token stamps `booking.joinedAt` if unset. This is
> the robust half of attendance — a client killed mid-class never runs its own
> dispose-time report, so attendance survives a crash.

**Errors:** 400 invalid session id, 401 unauthorized, any denial code above,
503 `ZEGOCLOUD is not configured on the server.`, 500 if `ZEGO_APP_ID` is
non-numeric.

### POST /api/v1/zego/sessions/:sessionId/end

End a class. **Host only.** Flips the session to `COMPLETED` (closing the window
for everyone including the host), backfills attendance from bookings that show a
join, then best-effort kicks anyone still connected via ZEGOCLOUD's REST API.
The DB flip is what matters; the kick just makes it immediate.

**Auth:** Bearer — caller must resolve to `host`

**Success (200)**

```json
{
  "message": "Session ended.",
  "attendanceMarked": 14,
  "kicked": ["5f1a...", "5f1b..."],
  "kickErrors": []
}
```

**Idempotent:** ending an already-ended session returns `200` with
`"Session already ended."` and zeroed counters, so a retried click never shows an
error.

**Errors:** 403 `Only the host can end this class.`, 409
`This session has no schedule to end.`, plus denial codes.

### POST /api/v1/zego/sessions/:sessionId/attendance

Record the caller's own attendance. The booking is resolved server-side, so
there is no booking id for a client to get wrong or forge — this replaces
`POST /bookings/:id/attendance` for the Zego join flow.

**Auth:** Bearer (any role)

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `stayDurationMinutes` | number | no | Defaults to `0`. Stored as `max(existing, submitted)`, so a late report never shortens a recorded stay |

Sets `status: "Attended"`, `joinedAt` (if unset), and `leftAt: now`.

> The access check runs against `now − 5 minutes`, tolerating a client that
> reports just after its window closed. `ENDED` is accepted here rather than
> refused.

**Success (200):** `{ "message": "Attendance recorded successfully.", "booking": { /* ... */ } }`

Hosts have no booking, so they get `200 { "message": "No booking to record attendance for." }`.

### POST /api/v1/zego/sessions/:sessionId/host-presence

Host heartbeat. **Host only.** Call from the host client's real "I am in the
room" callback (Zego's `onJoinRoom` / `onLiveStart`) — *not* from token
issuance, because a host who requests a token but never joins must not flip
members into the room.

**Auth:** Bearer — caller must resolve to `host`

Safe to call repeatedly: `hostLiveAt` is write-once, so a reconnect after a brief
drop never resets when the class started and never re-blocks members already in.
`hostLastSeenAt` updates every call (diagnostics only — nothing gates on it).

Works for both scheduled sessions and online nutritionist bookings.

**Success (200):** `{ "hostLiveAt": "2026-08-15T06:58:12.000Z" }`

**Errors:** 403 `Only the host can report presence for this class.`, 409
`This session has no schedule.`, plus denial codes.

> This is the fast path. `verifyHostPresence` in
> [session-room-lifecycle.service.ts](../src/services/session-room-lifecycle.service.ts)
> is the self-heal for a host whose client dies before ever calling this.

---

## Conference settings — `/api/v1/admin/settings`

Global ZEGOCLOUD defaults, stored as a **single** `ConferenceSettings` document.
From [settings.routes.ts](../src/routes/settings.routes.ts).

> **Authorization note:** the router applies `authenticateToken` but **no
> `authorize([...])` guard**, so any authenticated caller — including a `user`
> token — can read *and* write these settings. The `/admin` prefix is naming
> only; it grants nothing.

### GET /api/v1/admin/settings/rooms

Read the settings. If no document exists yet, one is created on first read with
the defaults below and returned.

**Auth:** Bearer (any authenticated role — see note above)

**Success (200)**

```json
{
  "message": "Conference settings retrieved successfully",
  "settings": {
    "defaultVideoResolution": "720p",
    "defaultFrameRate": 30,
    "defaultAudioMode": "stereo",
    "maxParticipantsPerSession": 50,
    "layoutTemplates": ["interactive_class", "large_event", "standard_meeting"]
  }
}
```

### PUT /api/v1/admin/settings/rooms

Update the settings. Partial: every field is optional and only the supplied keys
are assigned.

**Auth:** Bearer (any authenticated role — see note above)

**Request body**

| Field | Type | Constraints |
|---|---|---|
| `defaultVideoResolution` | string | `360p` \| `540p` \| `720p` \| `1080p` |
| `defaultFrameRate` | number | `15` \| `30` \| `60` |
| `defaultAudioMode` | string | `mono` \| `stereo` |
| `maxParticipantsPerSession` | number | integer 1–500 |
| `layoutTemplates` | string[] | each non-empty after trim |

**Success (200):** `{ "message": "Conference settings updated successfully", "settings": { /* ... */ } }`

**Errors:** `400 { "message": "Validation failed for conference settings update", "errors": [ /* Zod issues */ ] }`.

---

## Slots — `/slots`

All routes require authentication.

### GET /slots

**Auth:** Bearer (`admin`, `trainer`, `user`)

```bash
curl "https://api.example.com/slots" -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "slots": [ /* ... */ ] }`

### GET /slots/available

Return available slots for a given date (UTC day). Combines concrete dated slots and daily templates that have not yet been materialized for the day.

**Auth:** Bearer (`admin`, `trainer`, `user`)

**Query params**

| Name | Type | Required | Example |
|---|---|---|---|
| `date` | string | yes | `2026-06-01` |

```bash
curl "https://api.example.com/slots/available?date=2026-06-01" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200)**

```json
{
  "date": "2026-06-01T00:00:00.000Z",
  "slots": [
    {
      "slotId": "5f1a2b3c4d5e6f7a8b9c0d2f",
      "date": "2026-06-01T00:00:00.000Z",
      "startTime": "09:00",
      "endTime": "09:30",
      "capacity": 4,
      "remainingCapacity": 4
    }
  ]
}
```

### GET /slots/:id

**Auth:** Bearer (`admin`, `trainer`, `user`)

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

**Auth:** Bearer (`admin`, `trainer`, `user`)

```bash
curl "https://api.example.com/services" -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "services": [ /* ... */ ] }`

### GET /services/:id

**Auth:** Bearer (`admin`, `trainer`, `user`)

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
| GET | `/therapies` | `admin`, `trainer`, `user` |
| GET | `/therapies/:id` | `admin`, `trainer`, `user` |
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

### POST /bookings/:id/cancel

Cancel a booking through the cancellation engine: releases the seat atomically
and applies the refund policy.

**Auth:** Bearer (`admin`, `user`)

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `adminOverride` | boolean | no | When exactly `true`, forces a refund regardless of the cutoff. Intended for staff |

The engine decides refund vs. forfeit from the cancellation window; the response
message states which applied.

```bash
curl -X POST "https://api.example.com/bookings/6650f1a2b3c4d5e6f7a8b9c0/cancel" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
```

**Success (200) — refunded**

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Booking cancelled successfully. Credits refunded.",
  "refunded": true,
  "latePenaltyApplied": false,
  "creditRefunded": 2,
  "booking": {
    "id": "6650f1a2b3c4d5e6f7a8b9c0",
    "status": 2,
    "refunded": true,
    "cancelledAt": "2026-08-14T09:00:00.000Z"
  }
}
```

**Success (200) — late cancellation:** same shape with
`"message": "Late cancellation policy applied: seat released, credits forfeited."`,
`refunded: false`, `latePenaltyApplied: true`. The seat is still released.

> The engine's `statusCode` is used as the HTTP status *and* echoed in the body.
> A refund failure is logged as `[CANCELLATION_REFUND_NOTICE]` and does **not**
> fail the cancellation — the seat release is the operation that matters.

**Errors** — all share the `{ success: false, statusCode, message }` shape:

| Status | Message |
|---|---|
| 400 | `Booking is already cancelled` |
| 403 | `Forbidden: You cannot cancel another member's booking` |
| 404 | `Booking not found` |

### POST /bookings/:id/attendance

Record attendance against a booking by id.

**Auth:** Bearer (`admin`, `user`)

> For the Zego join flow prefer
> [`POST /api/v1/zego/sessions/:sessionId/attendance`](#post-apiv1zegosessionssessionidattendance),
> which resolves the booking server-side so there is no id for a client to get
> wrong or forge.

**Request body**

| Field | Type | Required | Default |
|---|---|---|---|
| `stayDurationMinutes` | number | no | `0` |
| `joinedAt` | ISO date | no | now |

**Success (200):** `{ "message": "Attendance recorded successfully", "booking": { /* ... */ } }`

**Errors:** 401 `Unauthorized`, 403 `Forbidden` (not your booking), 404
`Booking not found`, 409 `This booking has been cancelled.`

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

## Credits — `/credits`

Credit ledger. Backed by Membership credit pools + a `CreditTransaction` audit log.

### GET /credits/balance

Credit balance for the calling user, aggregated across their active
memberships.

**Auth:** Bearer (`user`, `admin`)

```bash
curl "https://api.example.com/credits/balance" -H "Authorization: Bearer $TOKEN"
```

**Success (200)**

```json
{
  "userId": "5f1a2b3c4d5e6f7a8b9c0d1e",
  "totalIncluded": 60,
  "totalRemaining": 43,
  "availableCredits": 43,
  "memberships": [
    {
      "id": "6650f1a2b3c4d5e6f7a8b9c0",
      "planName": "Gold",
      "creditsIncluded": 60,
      "creditsRemaining": 43,
      "endDate": "2026-11-01T00:00:00.000Z"
    }
  ]
}
```

`availableCredits` is a convenience duplicate of `totalRemaining`.

**Errors:** 401 `Unauthorized`.

### GET /credits/ledger

Credit transaction history for the calling user, newest first.

**Auth:** Bearer (`user`, `admin`)

**Query params**

| Param | Type | Default | Constraints |
|---|---|---|---|
| `limit` | number | `50` | integer 1–200 |
| `sourceType` | `CreditTransactionSource` | — | `Booking` \| `Appointment` \| `Admin` |

**Success (200):** the ledger object — entries carry `amount`, `type`
(`CreditTransactionType`), `sourceType`, `sourceId`, and `createdAt`.

**Errors:** 400 validation, 401 `Unauthorized`.

> `/credits/balance` and `/credits/ledger` are the shared-role equivalents of
> the `user`-only `/credits/me/balance` and `/credits/me/history` below. All four
> scope to the caller.

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

## Membership plans — `/membership-plans`

Admin-defined plan catalogue that `Membership` records are sold from. From
[membershipPlan.routes.ts](../src/routes/membershipPlan.routes.ts).

> `GET /membership-plans` is declared **before** `router.use(authenticateToken)`,
> making it the only public route in this file. Every other route requires a JWT.

### GET /membership-plans

Full plan catalogue. Returns every plan, including `active: false` ones — there
is no filtering or pagination.

**Auth:** Public

```bash
curl "https://api.example.com/membership-plans"
```

**Success (200)**

```json
{
  "plans": [
    {
      "_id": "6650f1a2b3c4d5e6f7a8b9c0",
      "name": "Gold",
      "description": "Unlimited classes",
      "price": 4999,
      "currency": "INR",
      "creditsIncluded": 60,
      "features": ["All group classes", "1 nutritionist consult"],
      "active": true,
      "gymId": "hsr-layout",
      "durationMonths": 3,
      "benefits": {}
    }
  ]
}
```

### GET /membership-plans/:id

**Auth:** Bearer (`admin`, `user`, `trainer`)

**Success (200):** `{ "plan": { /* ... */ } }`

**Errors:** `400 { "message": "Invalid id" }`, `404 { "message": "Membership plan not found" }`.

### POST /membership-plans

**Auth:** Bearer (`admin`)

**Request body**

| Field | Type | Required | Default | Constraints |
|---|---|---|---|---|
| `name` | string | yes | — | min 1 |
| `price` | number | yes | — | ≥ 0 |
| `gymId` | string | yes | — | min 1 |
| `description` | string | no | — | |
| `currency` | string | no | `"USD"` | min 1 |
| `creditsIncluded` | number | no | `0` | integer ≥ 0 |
| `features` | string[] | no | `[]` | each non-empty |
| `active` | boolean | no | model default `true` | |
| `durationMonths` | number | no | `1` | integer ≥ 1 |
| `benefits` | object | no | `{}` | Arbitrary key/value map |

**Success (201):** `{ "message": "Membership plan created", "plan": { /* ... */ }, "requestId": "..." }`

**Errors**

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_PAYLOAD` | Zod validation failed |
| 409 | `DUPLICATE_RESOURCE` | Plan already exists (duplicate key) |
| 500 | `INTERNAL_ERROR` | `Failed to create membership plan` |

### PATCH /membership-plans/:id

Partial update — at least one field required.

**Auth:** Bearer (`admin`)

**Success (200):** `{ "message": "Membership plan updated", "plan": { /* ... */ }, "requestId": "..." }`

**Errors:** 400 `Invalid id`, 400 `INVALID_PAYLOAD`, 404, 409 `DUPLICATE_RESOURCE`.

### DELETE /membership-plans/:id

**Auth:** Bearer (`admin`)

**Errors:** 400 `Invalid id`, 404 `Membership plan not found`.

---

## Invoices — `/invoices`

Billing for the FrontDesk dashboard. Also mounted at `/api/invoices` (see
[Appendix B](#appendix-b-path-aliases)). Rate-limited by `apiRateLimit`.

Every route is `admin` + `frontdesk`. From
[invoice.routes.ts](../src/routes/invoice.routes.ts).

### Payment status machine

Transitions are enforced by `isValidStatusTransition` in
[invoice.validator.ts](../src/validators/invoice.validator.ts). Anything not
listed is rejected with `409 CONFLICT`.

| From | Allowed next |
|---|---|
| `DRAFT` | `PENDING`, `PAID`, `CANCELLED` |
| `PENDING` | `PAID`, `FAILED`, `CANCELLED` |
| `PAID` | `REFUNDED` |
| `FAILED` | `CANCELLED` |
| `CANCELLED` | *(terminal)* |
| `REFUNDED` | *(terminal)* |

### POST /invoices

Create an invoice. `subtotal` and `total` are computed server-side from `items`,
`tax`, and `discount`; `invoiceNumber` is generated.

**Auth:** Bearer (`admin`, `frontdesk`)

**Request body**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `items` | array | yes | — | min 1; each `{ name, price ≥ 0, quantity ≥ 1 }` |
| `planSnapshot` | object | yes | — | `{ name, durationInDays ≥ 1, price ≥ 0, includedCredits ≥ 0 }` — frozen copy of the plan as sold |
| `userId` | ObjectId | conditional | — | **`userId` or `leadId` is required** |
| `leadId` | ObjectId | conditional | — | Must resolve to an existing Lead |
| `tax` | number | no | `0` | ≥ 0 |
| `discount` | number | no | `0` | ≥ 0 |
| `paymentMethod` | `InvoicePaymentMethod` | no | `NONE` | |
| `paymentStatus` | string | no | `DRAFT` | **On create, only `DRAFT` or `PENDING` are accepted** |
| `issuedAt` | string | no | — | Parseable date |

```bash
curl -X POST "https://api.example.com/invoices" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "leadId": "6650f1a2b3c4d5e6f7a8b9c0",
    "items": [{ "name": "Gold plan — 3 months", "price": 4999, "quantity": 1 }],
    "tax": 899,
    "planSnapshot": { "name": "Gold", "durationInDays": 90, "price": 4999, "includedCredits": 60 },
    "paymentMethod": "UPI",
    "paymentStatus": "PENDING"
  }'
```

**Success (201):** `{ "message": "Invoice created", "invoice": { /* ... */ } }`

**Errors**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Zod validation failed |
| 400 | `BAD_REQUEST` | Invalid `userId`/`leadId`/`issuedAt`, or neither id supplied |
| 404 | `NOT_FOUND` | `Lead not found` |

### GET /invoices

**Auth:** Bearer (`admin`, `frontdesk`)

**Query params:** `paymentStatus` (`InvoicePaymentStatus`), `userId`, `from`, `to`
— all optional.

**Success (200):** `{ "invoices": [ /* ... */ ] }`

**Errors:** `400 BAD_REQUEST` — `Invalid query parameters`.

### GET /invoices/:id

**Auth:** Bearer (`admin`, `frontdesk`)

**Success (200):** `{ "invoice": { /* ... */ } }`

**Errors:** 400 `Invalid invoice id`, 404 `Invoice not found`.

### PATCH /invoices/:id/status

Move an invoice through the status machine.

**Auth:** Bearer (`admin`, `frontdesk`)

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `paymentStatus` | `InvoicePaymentStatus` | yes | Must be a legal transition from the current status |
| `paymentMethod` | `InvoicePaymentMethod` | no | |

> **Transitioning to `PAID` has side effects.** It converts the linked Lead and
> activates the membership, returning `lead` and `membership` alongside the
> invoice.

**Success (200) — non-`PAID`:** `{ "message": "Invoice status updated to CANCELLED", "invoice": { /* ... */ } }`

**Success (200) — `PAID`:**

```json
{
  "message": "Invoice marked as PAID. Lead converted and membership activated.",
  "invoice": { /* ... */ },
  "lead": { /* ... */ },
  "membership": { /* ... */ }
}
```

**Success (200) — no-op:** submitting the current status returns
`{ "message": "No status change", "invoice": { /* ... */ } }` without side effects.

**Errors**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` / `VALIDATION_ERROR` | Invalid id or body |
| 404 | `NOT_FOUND` | No such invoice |
| 409 | `CONFLICT` | `Cannot transition invoice from X to Y`, or `Invoice was already marked as PAID` |

### GET /invoices/:id/pdf

Stream the invoice as a PDF.

**Auth:** Bearer (`admin`, `frontdesk`)

**Response:** `Content-Type: application/pdf` with
`Content-Disposition: attachment; filename="<invoiceNumber>.pdf"`. The body is
the PDF stream, **not** JSON.

`Content-Disposition` is exposed to browsers via `Access-Control-Expose-Headers`.

**Errors:** 400 `Invalid invoice id`, 404 `Invoice not found` — these *are* JSON.

---

## Schedules — `/schedules`

Per-user daily todo list. Users may manage their own schedule; staff (`trainer`, `admin`) may manage any.

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

### GET /workouts/active

The caller's currently-running session for **today** — status `Active`, dated to
today's normalized UTC date — with a live elapsed-time counter.

**Auth:** Bearer (`user`)

```bash
curl "https://api.example.com/workouts/active" -H "Authorization: Bearer $TOKEN"
```

**Success (200) — session in progress:** the fully-expanded session (exercises
and set logs), plus seconds since `startedAt`.

```json
{ "session": { /* session with exercises + sets */ }, "elapsedSeconds": 1847 }
```

**Success (200) — nothing running.** Note this is a `200`, not a `404`:

```json
{ "session": null, "elapsedSeconds": 0 }
```

> Differs from [`GET /workouts/today`](#get-workoutstoday), which returns
> today's session whatever its status. `/active` returns only a session still in
> progress, which is what a resume-workout prompt should key on.

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

Workout plans include user assignment endpoints plus trainer/admin plan management. All routes require auth.

### Assignment endpoints (user)

These endpoints require role `user`.

| Method | Path | Description |
|---|---|---|
| GET | `/workout-plans/assignments/mine` | Get my current assignment |
| GET | `/workout-plans/assignments/mine/schedule` | Get assignment schedule |
| GET | `/workout-plans/assignments/mine/today` | Get today's assigned workout |
| GET | `/workout-plans/assignments/mine/days/:dayNumber` | Get assigned workout for a day |
| POST | `/workout-plans/assignments/mine/complete-day` | Mark a day completed |
| PATCH | `/workout-plans/assignments/mine/days/:dayNumber` | Update my day exercises |

### Plan endpoints (admin/trainer)

| Method | Path | Description |
|---|---|---|
| GET | `/workout-plans` | List plans |
| POST | `/workout-plans` | Create plan |
| GET | `/workout-plans/:id` | Get plan |
| PATCH | `/workout-plans/:id` | Update plan |
| DELETE | `/workout-plans/:id` | Delete plan |
| POST | `/workout-plans/:id/assign` | Assign plan to users |

### Self-assign

`POST /workout-plans/:planId/assign-to-me` allows `user`, `trainer`, or `admin` to assign a plan to themselves.

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

**Auth:** Bearer (`admin`, `frontdesk`, `trainer`)

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

### GET /leads/stats

Aggregate lead counts by status and source, plus app-signup funnel metrics.

**Auth:** Bearer (`admin`)

```bash
curl "https://api.example.com/leads/stats" -H "Authorization: Bearer $TOKEN"
```

**Success (200)**

```json
{
  "byStatus": { "New": 42, "Warm": 11, "Converted": 9 },
  "bySource": { "fitflix.in": 30, "app-signup": 18 },
  "signupFunnel": [
    { "_id": { "onboarded": true, "currentStep": "COMPLETED" }, "count": 5 }
  ]
}
```

### GET /leads/:id

**Auth:** Bearer (`admin`, `frontdesk`, `trainer`)

```bash
curl "https://api.example.com/leads/5f1a2b3c4d5e6f7a8b9c0d1e" \
  -H "Authorization: Bearer $TOKEN"
```

**Success (200):** `{ "lead": { /* ... */ } }`

### PATCH /leads/:id

**Auth:** Bearer (`admin`, `frontdesk`, `trainer`)

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
| `gender` | `Gender` | yes | `Male` \| `Female` \| `Other` |
| `password` | string | yes | |

```bash
curl -X POST "https://api.example.com/leads/5f1a2b3c4d5e6f7a8b9c0d1e/convert" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "phone": "+15555550123", "age": "29", "gender": "Female", "password": "Sup3rSecret!" }'
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

## Dashboard — `/dashboard`

Aggregate counters for the FrontDesk dashboard landing page. From
[dashboard.routes.ts](../src/routes/dashboard.routes.ts).

### GET /dashboard/metrics

A single roll-up across leads, invoices, memberships, and users. Takes no
parameters and is not paginated.

**Auth:** Bearer (`admin`, `frontdesk`)

```bash
curl "https://api.example.com/dashboard/metrics" -H "Authorization: Bearer $TOKEN"
```

**Success (200)**

```json
{
  "leads": {
    "byStatus": { "New": 42, "Contacted": 17, "Converted": 9 },
    "recentCount": 23
  },
  "invoices": {
    "byStatus": { "PAID": 31, "PENDING": 4, "DRAFT": 2 },
    "totalsByStatus": { "PAID": 154_900, "PENDING": 19_996, "DRAFT": 9_998 }
  },
  "memberships": { "activeCount": 128 },
  "users": { "totalCount": 640 }
}
```

| Field | Meaning |
|---|---|
| `leads.byStatus` | Lead count keyed by `LeadStatus`, descending by count |
| `leads.recentCount` | Leads created in the **last 30 days** |
| `invoices.byStatus` | Invoice count keyed by `InvoicePaymentStatus` |
| `invoices.totalsByStatus` | Sum of `invoice.total` keyed by the same status |
| `memberships.activeCount` | Memberships with `status: "Active"` |
| `users.totalCount` | All user documents, with no filtering |

Statuses with no matching documents are **absent** from the maps rather than
present with `0`. A null status is bucketed under the key `"unknown"`.

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

### Recipe catalog (browse)

Read-only catalogue of pre-built recipes and their categories, used both by
members browsing food ideas and by staff building templates.

Role alias **BROWSE** = `nutritionist`, `admin`, `user`.

> These static paths are declared **before** any parameterized template route so
> that `from-category` / `from-recipe` are never captured by `/:id`. Preserve
> that ordering when editing
> [nutrition.routes.ts](../src/routes/nutrition.routes.ts).

#### GET /nutrition/categories — BROWSE

All recipe categories.

**Success (200):** `{ "categories": [ /* ... */ ] }`

#### GET /nutrition/categories/:categoryId/recipes — BROWSE

Recipes within one category, paginated.

**Query params**

| Param | Type | Default | Constraints |
|---|---|---|---|
| `page` | number | `1` | integer ≥ 1 |
| `limit` | number | `50` | integer 1–200 |
| `isVeg` | string | — | `"true"` / `"false"`; anything else is ignored |

**Success (200):** the paginated result object.

**Errors:** 400 `VALIDATION_ERROR`, 404 `Category not found`.

#### GET /nutrition/recipes — BROWSE

All recipes, same query params as above.

#### GET /nutrition/recipes/:id — BROWSE

One recipe with its ingredients and computed macro totals.

**Errors:** 404 `Recipe not found`.

### Template builders

Create a reusable template from catalogue content instead of authoring days by
hand. Both are **STAFF**.

#### POST /nutrition/templates/from-category/:categoryId — STAFF

Build a template from every recipe in a category.

**Request body**

| Field | Type | Required | Default |
|---|---|---|---|
| `name` | string | yes | — |
| `goal` | `NutritionGoal` | yes | — |
| `tags` | string[] | no | `[]` |

**Success (201)**

```json
{
  "message": "Template created from category",
  "template": { /* ... */ },
  "recipeCount": 14,
  "skippedIngredients": ["Amaranth leaves"]
}
```

`skippedIngredients` lists ingredients that could not be matched to a food in
the catalogue — they are omitted from the template rather than failing the
build, so always surface this to the author.

**Errors:** 400 `VALIDATION_ERROR`, 401 `UNAUTHORIZED`, 404 `Category not found`.

#### POST /nutrition/templates/from-recipe/:recipeId — STAFF

Build a template from a single recipe. Same request body.

**Success (201)**

```json
{
  "message": "Template created from recipe",
  "template": { /* ... */ },
  "totals": { "caloriesKcal": 512, "proteinG": 28, "carbsG": 61, "fatG": 17, "fiberG": 9, "sugarG": 6 },
  "skippedIngredients": []
}
```

**Errors:** 400 `VALIDATION_ERROR`, 401 `UNAUTHORIZED`, 404 `Recipe not found`.

#### POST /nutrition/templates/copy — STAFF

Copy one day's meal structure onto other days of the week. Works on **either** a
user plan or a template — the `planId` is looked up in `UserNutritionPlan`
first, then `NutritionTemplate`.

**Request body**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `planId` | string | yes | 24-char hex |
| `sourceDayOfWeek` | string | yes | `Sunday` … `Saturday` |
| `targetDaysOfWeek` | string[] | yes | Same day names |
| `strategy` | string | yes | `replicate` \| `alternate` \| `split_week` |

```bash
curl -X POST "https://api.example.com/nutrition/templates/copy" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "planId": "6650f1a2b3c4d5e6f7a8b9c0",
    "sourceDayOfWeek": "Monday",
    "targetDaysOfWeek": ["Wednesday", "Friday"],
    "strategy": "replicate"
  }'
```

**Errors:** 400 `VALIDATION_ERROR`, 401 `UNAUTHORIZED`, 404
`Plan or template not found`.

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

### Not routed

Two nutrition template handlers exist in
[nutrition-template.controller.ts](../src/controllers/nutrition-template.controller.ts)
but are **not mounted on any route**, so there is no HTTP endpoint for them:

| Handler | Would-be path | Status |
|---|---|---|
| `recommendTemplatesHandler` | `GET /nutrition/templates/recommend` | Unrouted — returns 404 |
| Template preview/filter | `POST /nutrition/templates/:id/filter` | Unrouted — returns 404 |

Earlier revisions of this document described both as live endpoints. They are
not. If either is wired up, add it to
[nutrition.routes.ts](../src/routes/nutrition.routes.ts) **before** the
`/templates/:id` routes so the static segment wins the match, then document it
here and in the [Endpoint index](#endpoint-index).

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

## Nutritionist bookings — `/nutritionist`

Slot-based nutritionist consultation workflow, covering the onboarding booking,
admin acceptance, rescheduling, and the online consultation room.

From [nutritionist-booking.routes.ts](../src/routes/nutritionist-booking.routes.ts).
This router is mounted **at the app root and again at `/api/v1`**, so every path
below also exists with an `/api/v1` prefix. Several handlers are additionally
bound to more than one method or spelling — see the table at the end of this
section and [Appendix B](#appendix-b-path-aliases).

All routes require a JWT.

### Booking status machine

`NutritionistBookingStatus`:

| Status | Set by | Meaning |
|---|---|---|
| `PENDING` | `bookNutritionist`, `rescheduleMyBooking` | Awaiting staff acceptance |
| `ACCEPTED` | `acceptBooking` | Confirmed; `acceptedAt` stamped |
| `REJECTED` | `rejectBooking` | Declined; slot capacity released |
| `COMPLETED` | `completeBooking` | Consultation finished |
| `RESCHEDULE_REQUIRED` | `acceptBooking` | Accept failed because the slot vanished or expired — the user must pick a new time |
| `EXPIRED` | — | Declared in the enum; not written by any handler |

`meetingStatus` (`MeetingStatus`) tracks the call itself: `SCHEDULED` on create,
`COMPLETED` when the booking is completed.

> **`zegoRoomId` is auto-generated** as `nutri_session_<bookingId>` whenever
> `appointmentMode` is `ONLINE` — at create, at accept, and on switch-to-online.
> Clients never supply it.

### POST /nutritionist/book

Submit a consultation request. Also answers at
`POST /onboarding/nutritionist/book`.

**Auth:** Bearer (`user`)

**Request body**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `date` | string | yes | — | Must parse as a date |
| `slotId` | ObjectId | no | — | When valid and the slot exists, `startTime`/`endTime` are taken from the slot and its capacity is decremented |
| `startTime` | string | no | `"10:00"` | Ignored when `slotId` resolves |
| `endTime` | string | no | `"10:30"` | Ignored when `slotId` resolves |
| `appointmentMode` | `AppointmentMode` | no | `ONLINE` | `IN_PERSON` \| `ONLINE` |
| `clinicLocation` | string | no | `null` | For `IN_PERSON` |
| `notes` | string | no | `null` | |

> An **unknown or malformed `slotId` is silently ignored** — the booking is
> created with the default or supplied times and `slotId: null`. Only a slot that
> exists *and* is full produces an error.

```bash
curl -X POST "https://api.example.com/nutritionist/book" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "slotId": "6650f1a2b3c4d5e6f7a8b9c0",
    "date": "2026-08-14",
    "appointmentMode": "ONLINE",
    "notes": "Vegetarian, training for a 10k"
  }'
```

**Success (201)**

```json
{
  "message": "Nutritionist booking submitted successfully",
  "booking": {
    "_id": "6650aaa2b3c4d5e6f7a8b9c0",
    "userId": "5f1a2b3c4d5e6f7a8b9c0d1e",
    "slotId": "6650f1a2b3c4d5e6f7a8b9c0",
    "bookingDate": "2026-08-14T00:00:00.000Z",
    "startTime": "10:00",
    "endTime": "10:30",
    "appointmentMode": "ONLINE",
    "clinicLocation": null,
    "zegoRoomId": "nutri_session_6650aaa2b3c4d5e6f7a8b9c0",
    "assignedNutritionistId": null,
    "assignedNutritionistName": null,
    "meetingStatus": "SCHEDULED",
    "status": "PENDING",
    "notes": "Vegetarian, training for a 10k",
    "acceptedAt": null,
    "completedAt": null
  }
}
```

**Onboarding side effect:** sets `onboardingStatus.nutritionistBooked = true`,
and calls `advanceStep(NUTRITIONIST_BOOKING)` when the caller's current step is
`REPORT_UPLOAD` or `NUTRITIONIST_BOOKING`. Wrapped in a `try`/`catch` that
swallows failures, so a post-onboarding user booking a follow-up still gets
`201`.

**Errors:** 400 `BAD_REQUEST` (validation; Zod tree under `details`), 400
`SLOT_FULL` (`Selected slot is fully booked`), 401 `UNAUTHORIZED`.

### GET /nutritionist/my-booking

The caller's most recent booking whose status is **not** `REJECTED`.

**Auth:** Bearer (`user`)

**Success (200):** `{ "booking": { /* ... */ } }`

**404** — note the body carries an explicit `booking: null`:

```json
{ "error": "No active nutritionist booking found", "code": "NOT_FOUND", "booking": null }
```

### GET /nutritionist/my-bookings

Full history for the caller, newest first, **including** rejected bookings.

**Auth:** Bearer (`user`)

**Success (200):** `{ "bookings": [ /* ... */ ] }` — empty array when there are none.

### PATCH, POST /nutritionist/my-booking/reschedule

Move a booking to a new slot. Also answers at
`/onboarding/nutritionist/reschedule`, on both methods.

**Auth:** Bearer (`user`)

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `slotId` | ObjectId | yes | The new slot |
| `date` | string | no | New booking date; ignored if unparseable |

> **Only a booking in `RESCHEDULE_REQUIRED` can be rescheduled** — the exact
> state `acceptBooking` sets when the original slot is gone. A `PENDING` or
> `ACCEPTED` booking returns `404 NOT_FOUND`.

Slot handling is ordered so a failure leaves everything unchanged: the new slot
is reserved atomically (`findOneAndUpdate` with `remainingCapacity > 0`) *before*
the booking is touched, and the old slot is released last inside its own
`try`/`catch`. The booking returns to `PENDING` with `acceptedAt` cleared, so it
needs staff acceptance again.

**Success (200):** `{ "message": "Booking rescheduled — awaiting admin acceptance", "booking": { /* ... */ } }`

**Errors**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Missing/invalid `slotId` |
| 404 | `NOT_FOUND` | `No booking awaiting reschedule was found` |
| 409 | `SLOT_FULL` | `Selected slot is fully booked or does not exist` |

### PATCH, POST /nutritionist/my-booking/switch-to-online

Convert the caller's latest non-rejected booking to `ONLINE`, generating
`zegoRoomId` if absent.

**Auth:** Bearer (`user`)

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `notes` | string | no | Replaces `notes` when non-empty |

**Success (200):** `{ "message": "Switched to online mode successfully", "booking": { /* ... */ } }`

**Errors:** 400 validation, 404 `No active nutritionist booking found to switch to online mode`.

### GET /nutritionist/bookings

Staff queue. All bookings, newest first, with `userId` populated to
`username`, `email`, `phone`.

**Auth:** Bearer (`admin`, `nutritionist`, `frontdesk`)

**Query params**

| Name | Type | Notes |
|---|---|---|
| `status` | `NutritionistBookingStatus` | Optional. Upper-cased before matching, so `?status=pending` works |

There is **no** `date` filter and **no** pagination; the response has no `total`.

**Success (200):** `{ "bookings": [ /* ... */ ] }`

**Errors:** `400 BAD_REQUEST` — `Invalid status filter`.

### PATCH /nutritionist/bookings/:id/accept

Confirm a booking. Also answers at `/admin/nutrition/bookings/:id/accept` on both
`PATCH` and `POST`.

**Auth:** Bearer (`admin`, `nutritionist`, `frontdesk`)

**Request body** — all optional; an empty body is valid.

| Field | Type | Notes |
|---|---|---|
| `clinicLocation` | string | Overwrites the booking's location |
| `assignedNutritionistId` | ObjectId | When set and `assignedNutritionistName` is absent, the name is looked up from the User |
| `assignedNutritionistName` | string | |
| `meetingLink` | string | **Accepted by the validator but never read by the handler** — it is not persisted |

**Re-validation before accepting.** Between booking and acceptance the slot may
have been deleted or its time may have passed, so accept re-checks it. Each
failure flips the booking to `RESCHEDULE_REQUIRED`, saves it, and returns `409`
**with the updated booking in the body** so the dashboard can reflect the new
state immediately:

| Code | Condition |
|---|---|
| `SLOT_REQUIRED` | Booking has neither `slotId` nor `bookingDate` |
| `SLOT_NO_LONGER_AVAILABLE` | Slot is missing, or its `capacity` is ≤ 0 |
| `SLOT_EXPIRED_RESCHEDULE_REQUIRED` | The appointment's end instant is already in the past |

On success: `status` → `ACCEPTED`, `acceptedAt` stamped, and `zegoRoomId`
generated if the mode is `ONLINE` and it is missing.

**Success (200):** `{ "message": "Nutritionist booking accepted", "booking": { /* ... */ } }`

**Errors:** 400 `BAD_REQUEST` (invalid id or body), 404 `NOT_FOUND`, plus the
three `409`s above.

### PATCH /nutritionist/bookings/:id/reject

Decline a booking and release the slot it reserved (`remainingCapacity += 1`,
`isBooked: false`), mirroring the decrement at creation.

**Auth:** Bearer (`admin`, `nutritionist`, `frontdesk`)

**Request body:** none — no body is parsed. There is no `reason` field.

**Success (200):** `{ "message": "Nutritionist booking rejected", "booking": { /* ... */ } }`

**Errors**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Invalid booking id |
| 400 | `INVALID_STATUS_TRANSITION` | Already `REJECTED` or `COMPLETED` |
| 404 | `NOT_FOUND` | No such booking |

### PATCH /nutritionist/bookings/:id/complete

Mark a consultation finished. Sets `status: COMPLETED`,
`meetingStatus: COMPLETED`, and `completedAt`.

**Auth:** Bearer (`admin`, `nutritionist`, `frontdesk`)

**Request body:** none.

**Success (200):** `{ "message": "Nutritionist consultation marked complete", "booking": { /* ... */ } }`

**Errors:** 400 `BAD_REQUEST` (invalid id), 400 `INVALID_STATUS_TRANSITION`
(`Only an accepted booking can be marked completed`), 404 `NOT_FOUND`.

### Joining an online consultation

An `ONLINE` booking is a Zego session like any other. Use
[`POST /api/v1/zego/sessions/:sessionId/token`](#post-apiv1zegosessionssessionidtoken)
with the booking id; `resolveSessionAccess` recognizes nutritionist bookings and
resolves the assigned nutritionist as `host`. Host presence is reported through
the same [host-presence](#post-apiv1zegosessionssessionidhost-presence)
endpoint, which writes `hostLiveAt`/`hostLastSeenAt` onto the booking document.

### Route bindings

Every declaration in this router, since the duplication is easy to miss:

| Handler | Methods | Paths (each also under `/api/v1`) |
|---|---|---|
| `bookNutritionist` | POST | `/nutritionist/book`, `/onboarding/nutritionist/book` |
| `getMemberBooking` | GET | `/nutritionist/my-booking` |
| `getMyBookings` | GET | `/nutritionist/my-bookings` |
| `rescheduleMyBooking` | POST, PATCH | `/nutritionist/my-booking/reschedule`, `/onboarding/nutritionist/reschedule` |
| `switchToOnline` | POST, PATCH | `/nutritionist/my-booking/switch-to-online` |
| `getAllBookingsForAdmin` | GET | `/nutritionist/bookings` |
| `acceptBooking` | POST, PATCH | `/admin/nutrition/bookings/:id/accept`; PATCH also `/nutritionist/bookings/:id/accept` |
| `rejectBooking` | PATCH | `/nutritionist/bookings/:id/reject` |
| `completeBooking` | PATCH | `/nutritionist/bookings/:id/complete` |

---

## Notifications — `/notifications`

In-app notifications and push token registration. All routes require authentication.

### GET /notifications

List notifications for the authenticated user.

**Auth:** Bearer (any role)

**Query params**

| Name | Type | Required | Default |
|---|---|---|---|
| `page` | number | no | 1 |
| `limit` | number | no | 20 (max 50) |

**Success (200)**

```json
{
  "notifications": [ /* ... */ ],
  "unread": 3,
  "pagination": { "total": 42, "page": 1, "limit": 20, "pages": 3 }
}
```

### PATCH /notifications/read-all

Mark all notifications as read.

**Auth:** Bearer (any role)

**Success (200):** `{ "message": "All notifications marked as read" }`

### PATCH /notifications/:id/read

Mark a single notification as read.

**Auth:** Bearer (any role)

**Success (200):** `{ "notification": { /* ... */ } }`

### POST /notifications/fcm-token

Register a device push token.

**Auth:** Bearer (any role)

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `token` | string | yes | FCM device token |
| `platform` | string | yes | `ios` or `android` |

**Success (200):** `{ "message": "FCM token registered" }`

---

## Internal — `/internal`

Internal routes protected by `REMINDER_TICK_SECRET`.

### POST /internal/reminders/tick

Process due appointment reminders. Intended for cron/scheduler use.

**Auth:** `X-Internal-Secret` header (or `X-Webhook-Secret` alias)

```bash
curl -X POST "https://api.example.com/internal/reminders/tick" \
  -H "X-Internal-Secret: $REMINDER_TICK_SECRET"
```

**Success (200):** `{ "ok": true, "fired": 10, "failed": 0 }`

**Errors:** 401 unauthorized, 503 not configured.

### POST /internal/sessions/lifecycle/tick

Drives the video-room lifecycle. Called **every minute** by an external
scheduler — the Vercel Cron entry only runs daily, far too coarse for a
lead-time / expiry-grace room lifecycle.

**Auth:** `X-Internal-Secret` (or `X-Webhook-Secret`)

Runs three independent sweeps in parallel, over both `group_class` and
`live_stream` sessions:

| Sweep | Effect |
|---|---|
| `prepareDueRooms` | At `start − lead`, stamps `videoRoomId` and flips `roomStatus` to `READY` |
| `verifyHostPresence` | Self-heals `hostLiveAt` against Zego's room membership, for a host whose client never called the host-presence endpoint |
| `expireDueRooms` | At `end + grace`, kicks everyone, sets `roomStatus: EXPIRED` and `status: COMPLETED` |

```bash
curl -X POST "https://api.example.com/internal/sessions/lifecycle/tick" \
  -H "X-Internal-Secret: $REMINDER_TICK_SECRET"
```

**Success (200):** `{ "ok": true, "prepared": { /* ... */ }, "hostPresence": { /* ... */ }, "expired": { /* ... */ } }`

**Errors:** 401 `UNAUTHORIZED`, 500 `INTERNAL_ERROR` (`Session lifecycle tick failed`),
503 `NOT_CONFIGURED`.

> **A missed tick is not a correctness problem.** All three sweeps are pure
> side-effect passes. Join/deny gating in `resolveSessionAccess` is arithmetic
> plus the `hostLiveAt` read that the host's own client writes on the fast path,
> so it never depends on this route having run. A missed tick degrades to
> stale-looking room state, not a wrongly admitted or wrongly refused join.

### POST /internal/leads/followup

Triggers queued lead follow-ups.

**Auth:** `X-Internal-Secret` (or `X-Webhook-Secret`)

**Success (200):** `{ "ok": true, ...result }`

**Errors:** 401 `UNAUTHORIZED`, 500 `INTERNAL_ERROR` (`Lead follow-up processing failed`),
503 `NOT_CONFIGURED`.

---

## Health & diagnostics

Declared inline in [src/app.ts](../src/app.ts) rather than in a route file.

### GET /health

Liveness probe. Always returns `{ ok: true }` when the process is running. It
does **not** check the database connection.

**Auth:** Public

```bash
curl "https://api.example.com/health"
```

**Success (200)**

```json
{ "ok": true }
```

### POST /test/firebase

Diagnostic probe that initializes the Firebase Admin SDK and reports whether it
came up. Used to debug phone auth and FCM push in a deployed environment.

**Auth:** Public — takes no body and returns no user data, but it is
unauthenticated and unmetered. Consider restricting it at the edge in
production.

```bash
curl -X POST "https://api.example.com/test/firebase"
```

**Success (200)**

```json
{
  "success": true,
  "message": "Firebase Admin initialized successfully",
  "projectName": "fitflix-prod"
}
```

`projectName` falls back to `"unknown"` when the credential carries no project id.

**Failure (500)** — initialization returned no app (usually missing or
malformed service-account credentials), or threw:

```json
{
  "success": false,
  "message": "Firebase Admin initialization failed or was disabled (check server logs)"
}
```

```json
{
  "success": false,
  "message": "Firebase Admin test threw an exception",
  "error": "Failed to parse service account json"
}
```

---

## Appendix A: Onboarding step order

Enforced server-side by [src/utils/onboarding.service.ts](../src/utils/onboarding.service.ts).
Submitting anything other than the current step returns `403 STEP_NOT_ALLOWED`.

`STEP_ORDER` — the sequence `advanceStep` actually walks — is **four steps plus
a terminal marker**:

| Order | Step | Endpoint | Sets flag |
|---|---|---|---|
| 1 | `HEALTH_MARKERS` | `POST /onboarding/health-markers` | `healthMarkersCompleted` |
| 2 | `HEALTH_GOALS` | `POST /onboarding/health-goals` | `healthGoalsCompleted` |
| 3 | `CONSENT` | `POST /onboarding/consent` | `consentCompleted` |
| 4 | `REPORT_UPLOAD` | `POST /onboarding/reports` | `reportsUploaded` |
| — | `COMPLETED` | `POST /onboarding/complete` | `onboardingCompleted`, `user.onboarded = true` |

### Where `NUTRITIONIST_BOOKING` fits

`NUTRITIONIST_BOOKING` is a member of the `OnboardingStep` enum but is **not**
in `STEP_ORDER`, so `getNextStep` never advances *into* it and the linear step
machine never blocks on it. Instead:

- `POST /nutritionist/book` (and its `/onboarding/nutritionist/book` alias) sets
  `onboardingStatus.nutritionistBooked = true` directly, and calls
  `advanceStep(NUTRITIONIST_BOOKING)` only when the current step is
  `REPORT_UPLOAD` or `NUTRITIONIST_BOOKING`. Because `NUTRITIONIST_BOOKING` has
  no `STEP_FLAG_MAP` entry and no successor, that call only appends to
  `completedSteps`.
- `POST /onboarding/complete` independently requires a booking: it fails with
  `MISSING_STEPS` unless a non-`REJECTED` `NutritionistBooking` exists **or**
  `onboardingStatus.nutritionistBooked` is true.

Net effect: the booking can be made at any point, but onboarding cannot be
finalized without one.

`SPORTS_SCIENTIST_BOOKING` was removed from the enum — there is no sports
scientist step, endpoint, or model in the codebase.

### `POST /onboarding/complete` preconditions

`MISSING_STEPS` lists whichever of these are unmet, by flag name:
`healthMarkersCompleted`, `healthGoalsCompleted`, `consentCompleted`,
`reportsUploaded`, `nutritionistBooked`.

Legacy single-step alternative: `PATCH /users/:id/onboard` — still supported but bypasses the granular step tracking. New clients should use the steps above.

---

## Appendix B: Path aliases

Several routers are mounted at more than one prefix in
[src/app.ts](../src/app.ts). Aliases are **exact duplicates** — same handlers,
same auth, same roles — kept so the Flutter app and the FrontDesk dashboard can
migrate to `/api/v1` independently.

| Router | Primary | Aliases |
|---|---|---|
| `booking.routes.ts` | `/bookings` | `/api/v1/bookings`, `/api/v1/admin/bookings` |
| `credit.routes.ts` | `/credits` | `/api/v1/credits` |
| `invoice.routes.ts` | `/invoices` | `/api/invoices` |
| `nutritionist-booking.routes.ts` | *(app root)* | `/api/v1` |

Notes:

- `/api/v1/admin/bookings` is **not** an admin-scoped variant. It maps onto the
  same router, so `/api/v1/admin/bookings/me` exists and is `user`-only, while
  `/api/v1/admin/bookings` (GET) is `admin`-only. The prefix carries no
  authorization meaning of its own.
- The nutritionist-booking router is mounted at the app root, which is why its
  routes appear under unrelated-looking prefixes: `/nutritionist/...`,
  `/onboarding/nutritionist/...`, and `/admin/nutrition/bookings/...` are all
  declared inside that one file, and each also exists under `/api/v1`.

Within the nutritionist-booking router several handlers are additionally bound
to more than one method or spelling — for example `rescheduleMyBooking` answers
on both `POST` and `PATCH`, at both `/nutritionist/my-booking/reschedule` and
`/onboarding/nutritionist/reschedule`. See the
[Endpoint index](#endpoint-index) for the exhaustive list.

### Full alias expansion

Every aliased path, spelled out. The [Endpoint index](#endpoint-index) lists only
the primary spelling to keep diffs readable; this table is the searchable
expansion.

**`booking.routes.ts`** — mounted at `/bookings`, `/api/v1/bookings`, `/api/v1/admin/bookings`

| Primary path | Also available at |
|---|---|
| `/bookings` | `/api/v1/bookings`<br>`/api/v1/admin/bookings` |
| `/bookings/me` | `/api/v1/bookings/me`<br>`/api/v1/admin/bookings/me` |
| `/bookings/:id` | `/api/v1/bookings/:id`<br>`/api/v1/admin/bookings/:id` |
| `/bookings/:id/cancel` | `/api/v1/bookings/:id/cancel`<br>`/api/v1/admin/bookings/:id/cancel` |
| `/bookings/:id/attendance` | `/api/v1/bookings/:id/attendance`<br>`/api/v1/admin/bookings/:id/attendance` |
| `/bookings/:id/status` | `/api/v1/bookings/:id/status`<br>`/api/v1/admin/bookings/:id/status` |

**`credit.routes.ts`** — mounted at `/credits`, `/api/v1/credits`

| Primary path | Also available at |
|---|---|
| `/credits/balance` | `/api/v1/credits/balance` |
| `/credits/ledger` | `/api/v1/credits/ledger` |
| `/credits/me/balance` | `/api/v1/credits/me/balance` |
| `/credits/me/history` | `/api/v1/credits/me/history` |
| `/credits/users/:userId/balance` | `/api/v1/credits/users/:userId/balance` |
| `/credits/users/:userId/history` | `/api/v1/credits/users/:userId/history` |
| `/credits/users/:userId/topup` | `/api/v1/credits/users/:userId/topup` |

**`invoice.routes.ts`** — mounted at `/invoices`, `/api/invoices`

| Primary path | Also available at |
|---|---|
| `/invoices` | `/api/invoices` |
| `/invoices/:id` | `/api/invoices/:id` |
| `/invoices/:id/status` | `/api/invoices/:id/status` |
| `/invoices/:id/pdf` | `/api/invoices/:id/pdf` |

**`nutritionist-booking.routes.ts`** — mounted at `(root)`, `/api/v1`

| Primary path | Also available at |
|---|---|
| `/onboarding/nutritionist/book` | `/api/v1/onboarding/nutritionist/book` |
| `/nutritionist/book` | `/api/v1/nutritionist/book` |
| `/nutritionist/my-booking` | `/api/v1/nutritionist/my-booking` |
| `/nutritionist/my-bookings` | `/api/v1/nutritionist/my-bookings` |
| `/nutritionist/my-booking/switch-to-online` | `/api/v1/nutritionist/my-booking/switch-to-online` |
| `/nutritionist/my-booking/reschedule` | `/api/v1/nutritionist/my-booking/reschedule` |
| `/onboarding/nutritionist/reschedule` | `/api/v1/onboarding/nutritionist/reschedule` |
| `/nutritionist/bookings` | `/api/v1/nutritionist/bookings` |
| `/admin/nutrition/bookings/:id/accept` | `/api/v1/admin/nutrition/bookings/:id/accept` |
| `/nutritionist/bookings/:id/accept` | `/api/v1/nutritionist/bookings/:id/accept` |
| `/nutritionist/bookings/:id/reject` | `/api/v1/nutritionist/bookings/:id/reject` |
| `/nutritionist/bookings/:id/complete` | `/api/v1/nutritionist/bookings/:id/complete` |

---

## Changelog

- **2026-08-09** — Synchronized with the codebase. Removed the `/doctors`,
  `/appointments`, and `/expert-appointments` sections (no such routes,
  controllers, or models exist). Added `/delete-account`, `/membership-plans`,
  `/invoices`, `/dashboard`, `/api/v1/classes`, `/api/v1/classes/schedule`,
  `/api/v1/zego`, `/api/v1/admin/settings`, phone auth, admin deletion
  requests, and the missing nutrition/booking/credit/workout endpoints.
  Corrected the role list (`frontdesk`, `nutritionist`; `doctor` unused),
  the `OnboardingStep` enum (no `SPORTS_SCIENTIST_BOOKING`), the
  `GET /onboarding/status` response shape, and `NutritionistBookingStatus`.
  Added the [Endpoint index](#endpoint-index) and
  [Appendix B: Path aliases](#appendix-b-path-aliases).
- **2026-05-27** — Added missing endpoints (logout, slots availability, nutritionist bookings, notifications, internal, Cal ID webhook) and refreshed enums.
- **2026-05-22** — Initial consolidated reference covering all 17 routers and `/health`.
