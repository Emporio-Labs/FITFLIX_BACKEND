# 🚀 US-A4 - Manage Trainer Roles (Admin)

**Type:** Backend Community Feature

## Objective

Provide endpoints for admins to promote members to trainers, revoke trainer privileges, verify credentials, update trainer information, and view trainer activity metrics.

---

## Business Goal

* Ensure trainer roles are earned and continuously validated.
* Maintain accurate trainer information for member trust.
* Track trainer activity to identify inactive or low-performing trainers.

---

## User Story

**As an** admin

**I want** to assign or revoke trainer roles

**So that** trainers are properly managed.

---

## Scope

### Included

* **Endpoints:**
  - `POST /api/v1/admin/trainers/promote/{userId}` — promote a member to trainer.
  - `POST /api/v1/admin/trainers/{trainerId}/revoke` — revoke trainer privileges.
  - `POST /api/v1/admin/trainers/{trainerId}/verify` — mark credentials as verified.
  - `PUT /api/v1/admin/trainers/{trainerId}` — update trainer info (specialities, qualifications).
  - `GET /api/v1/admin/trainers/{trainerId}/activity` — activity dashboard (posts, comments, response times).
* **Schema:** `Trainer` gains `credentialsVerified`, `verifiedAt`, `verifiedBy`.
* **User Sync:** Promotion updates `User.role = trainer`; revocation reverts to `user`.

### Excluded

* External credential API verification (manual for v1).

---

## Acceptance Criteria

- [ ] **Promote Flow:** Creates a `Trainer` record and updates `User.role`.
- [ ] **Revoke Flow:** Sets `Trainer.status = INACTIVE` and reverts user role.
- [ ] **Verification:** Endpoint marks credentials verified with admin ID and timestamp.
- [ ] **Activity Payload:** Includes post count, comment count, avg response time, last active date.
- [ ] **Admin-Only Guard:** All endpoints require `authorize(["admin"])`.

---

## Dependencies

* `User` and `Trainer` models
* Auth middleware + admin role
* Audit log collection

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
