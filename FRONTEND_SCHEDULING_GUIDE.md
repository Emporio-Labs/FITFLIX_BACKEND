# Frontend Scheduling and Spot Booking Guide

This document explains how scheduling currently works in the backend and how the frontend should implement booking, spot booking, appointment handling, and credit-aware UI.

## 1) Scope

Use this guide for:
- User booking UI
- Admin spot booking UI (walk-in/on-the-spot)
- Appointment UI (admin/doctor)
- Capacity, conflict, and credit handling

Source of truth remains API behavior in `API_DOCS.md` and controllers.

## 2) Core Backend Behavior

### 2.1 Bookable items: Services and Therapies

- `GET /services` returns standard services only.
- `GET /therapies` returns therapies only.
- Both are stored under the same underlying service model.
- Therapy IDs are valid as `serviceId` for booking/appointment creation.
- Credit deduction is based on `creditCost`.

Frontend rule:
- If your scheduling experience is therapy-first, use `GET /therapies` and submit selected therapy `_id` as `serviceId`.
- If it is service-first, use `GET /services` and submit service `_id`.

### 2.2 Slot model and scheduling inventory

Slots can represent either:
- Daily template slot: `isDaily = true`, usually `date = null`
- Concrete dated slot: `isDaily = false`, `date` set to a specific day

Important behavior:
- Booking/appointment can be created using either a template slot ID or a concrete slot ID.
- If a template slot ID is used, backend resolves (or creates) a dated inventory slot for the selected day.
- Concrete dated slots created from templates carry `parentTemplate`.
- Capacity is tracked in `remainingCapacity`.
- `isBooked` is derived from `remainingCapacity <= 0`.

### 2.3 Shared capacity pool

Bookings and appointments consume from the same slot capacity pool.

Meaning for UI:
- A slot can become full because of either a booking or an appointment.
- Availability UI must handle race conditions and refresh after conflicts.

### 2.4 Credit snapshots on records

On create, backend stores on booking/appointment:
- `startTime` — slot start time snapshot (e.g. `"10:00"`)
- `endTime` — slot end time snapshot (e.g. `"11:00"`)
- `creditCostSnapshot`
- `creditsBypassed`

Frontend should display these snapshot values in details/history UI so later slot or service changes do not alter past record display.

## 3) Role-based UX Matrix

| Role | Can create booking | Can create appointment | Can bypass credits | Typical screens |
| --- | --- | --- | --- | --- |
| user | Yes (self) | No | No | My bookings, schedule, credit balance |
| admin | Yes (any user) | Yes | Yes | Spot booking panel, appointment desk, admin credit ops |
| doctor | No | No (create) / yes (status updates on own appointments) | No | My appointments, status updates |
| trainer | No | No | No | Read-only scheduling contexts (if exposed) |

## 4) Recommended Frontend Screens

### 4.1 Scheduling board (main)

Recommended layout:
- Left: date selector + quick filters (service/therapy, mode, doctor)
- Center: time-slot grid/cards with remaining seats
- Right: booking summary drawer (selected user, selected therapy/service, credits impact)

Card states:
- Available: `remainingCapacity > 0`
- Full: `remainingCapacity = 0` (disabled action)
- Just filled (conflict): returned by create API with `409`

### 4.2 Spot booking panel (admin)

Spot booking means immediate on-the-spot booking, usually for today.

Recommended UI behavior:
- Default date to today.
- Require explicit user selection first.
- Show only slots that are still available.
- Show credit impact before submit.
- Provide admin-only toggle for `bypassCredits`.

### 4.3 User self-booking flow

Recommended steps:
1. User chooses therapy/service.
2. User picks date and slot.
3. UI shows credit cost and current balance.
4. Submit booking.
5. On success, refresh bookings and slot availability.

### 4.4 Appointment desk flow (admin/doctor)

Admin can create appointments.
Doctor can update status for own appointments.

Appointment behavior mirrors booking behavior for:
- Slot capacity consume/release
- Cancellation refund logic
- Idempotent cancel semantics

## 5) API Call Sequence for Scheduling UI

### 5.1 Data bootstrapping

For therapy-led flow:
1. `GET /therapies`
2. `GET /slots`
3. (For users) `GET /credits/me/balance`
4. (Optional) `GET /bookings/me` for existing bookings

For admin desk flow:
1. `GET /therapies` or `GET /services`
2. `GET /slots`
3. User lookup/list endpoint used in your admin UI
4. (Optional) `GET /credits/users/:userId/balance` when user selected

### 5.2 Client-side slot filtering

Given selected service/therapy object with `slots: string[]`:
- Include slot when `slot._id` is in `slots`
- Also include slot when `slot.parentTemplate` is in `slots`

Then apply day filter:
- Show daily templates (`isDaily = true`) as recurring options
- Show dated slots where `slot.date` matches selected date

Then availability filter:
- Prefer showing only `remainingCapacity > 0` for actionable booking

### 5.3 Create booking

Endpoint:
- `POST /bookings`

Payload patterns:

User self-booking:
```json
{
  "bookingDate": "2026-04-11T00:00:00.000Z",
  "slotId": "SLOT_OR_TEMPLATE_ID",
  "serviceId": "SERVICE_OR_THERAPY_ID"
}
```

Admin spot booking:
```json
{
  "bookingDate": "2026-04-11T00:00:00.000Z",
  "userId": "USER_ID",
  "slotId": "SLOT_OR_TEMPLATE_ID",
  "serviceId": "SERVICE_OR_THERAPY_ID",
  "bypassCredits": false
}
```

Success response includes:
- `booking`
- `credits.consumed`
- `credits.bypassed`

### 5.4 Create appointment (admin)

Endpoint:
- `POST /appointments`

Notes:
- `serviceId` is optional.
- If `serviceId` omitted, default deduction is 1 credit (unless bypassed).
- Uses same slot capacity pool and same 409 conflict behavior.

## 6) Cancellation and Delete Semantics (Critical for UI)

### 6.1 Cancel

Booking cancel:
- `PATCH /bookings/:id/status` with `{ "status": 2 }`

Appointment cancel:
- `PATCH /appointments/:id/status` with `{ "status": 2 }`

First successful cancel does:
- Refund consumed credits once
- Release one slot capacity once

Repeated cancel requests are idempotent:
- Still 200
- `credits.refunded` returns `0`

Frontend rule:
- Treat repeated cancel success with `refunded = 0` as already-cancelled success, not an error.

### 6.2 Delete

Booking delete:
- `DELETE /bookings/:id`

Appointment delete:
- `DELETE /appointments/:id`

Behavior:
- If record is not already cancelled, backend applies cancel compensation (refund + release) before deletion.
- If already cancelled, no additional compensation is applied.

Frontend rule:
- After delete success, remove row locally and refresh balance + availability.

## 7) Error-to-UI Mapping

| HTTP | Meaning in scheduling context | UI action |
| --- | --- | --- |
| 400 | Invalid payload/ids/date/field shape | Show inline validation errors and block submit |
| 401 | Not authenticated | Redirect to login/session restore |
| 402 | Insufficient credits | Show low-credit modal and top-up CTA |
| 403 | Forbidden/role mismatch/no active eligible membership | Show permission or membership state message |
| 404 | Missing service/slot/booking/appointment | Show stale-data message, refresh list |
| 409 | Slot full or no longer available | Show "slot just got filled" and auto-refresh slots |

## 8) Credit UX Recommendations

### 8.1 Before checkout

- Fetch and show balance (`GET /credits/me/balance` or admin user balance endpoint).
- Show estimated deduction from selected item `creditCost`.
- Disable submit only when clearly impossible (for user flow).

### 8.2 After create

- Use API response `credits.consumed` as truth for immediate toast/message.
- Use stored `creditCostSnapshot` and `creditsBypassed` from returned record for detail views.

### 8.3 Credit history timeline

Use:
- `GET /credits/me/history?limit=50&sourceType=Booking`
- `GET /credits/me/history?limit=50&sourceType=Appointment`
- `GET /credits/me/history?limit=50&sourceType=Admin`

Render each event with:
- amount (+/-)
- type (`Consume`, `Refund`, `AdminTopUp`, `Void`)
- source type
- source id
- reason
- timestamp

## 9) Timezone and Date Handling

Backend resolves daily-slot inventory by normalized UTC day.

Frontend recommendation:
- Treat `bookingDate` and `appointmentDate` as date keys for scheduling day.
- Send ISO UTC date strings consistently for selected day (for example `YYYY-MM-DDT00:00:00.000Z`).
- Keep one date conversion utility in frontend to avoid day-shift bugs.

## 10) Suggested State Machine for Booking CTA

Suggested button states:
- `idle` -> selectable
- `submitting` -> loading spinner, button disabled
- `success` -> toast + refresh data
- `conflict` (409) -> alert + force slot refresh
- `insufficient_credits` (402) -> show top-up prompt

Do not rely on optimistic decrement of slot capacity alone. Always reconcile with server response.

## 11) Minimal Frontend Data Contracts

Example TypeScript shapes:

```ts
type Slot = {
  _id: string;
  date: string | null;
  isDaily: boolean;
  startTime: string;
  endTime: string;
  capacity: number;
  remainingCapacity: number;
  isBooked: boolean;
  parentTemplate?: string | null;
};

type BookableItem = {
  _id: string;
  name: string;
  durationMinutes: number;
  creditCost: number;
  slots: string[];
};

type BookingOrAppointmentRecord = {
  startTime: string;
  endTime: string;
  creditCostSnapshot: number;
  creditsBypassed: boolean;
};
```

## 12) QA Checklist for Frontend Team

- Booking creation updates UI and balance correctly.
- Appointment creation reflects in same slot capacity pool.
- 409 conflict path is user-friendly and refreshes data.
- Repeated cancel calls do not double-count refunds in UI.
- Delete path does not cause duplicate local refunds.
- Spot booking works for same-day flows and handles last-seat race safely.
- Credit history renders consume/refund/top-up records with correct signs.

## 13) Implementation Note

There is currently no dedicated backend endpoint for "availability by date and service". The frontend should derive this from `GET /slots` and selected service/therapy slot references, then revalidate by handling create-time conflicts (`409`).
