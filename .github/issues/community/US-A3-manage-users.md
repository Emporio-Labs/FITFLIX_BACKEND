# 🚀 US-A3 - Manage Users (Admin)

**Type:** Backend Community Feature

## Objective

Expose REST endpoints for admins to list, suspend, reactivate, delete, and reset passwords for community users, plus assign community roles.

---

## Business Goal

* Give admins full control over the user directory to enforce policies.
* Provide password reset flow for user recovery.
* Support role assignment within the community (member, trainer, moderator).

---

## User Story

**As an** admin

**I want** to manage user accounts

**So that** only authorized users access community features.

---

## Scope

### Included

* **Endpoints:**
  - `GET /api/v1/admin/users` — paginated user listing with filters.
  - `POST /api/v1/admin/users/{id}/suspend` — suspend account with reason and duration.
  - `POST /api/v1/admin/users/{id}/reactivate` — reactivate a suspended account.
  - `DELETE /api/v1/admin/users/{id}` — soft-delete inactive account.
  - `POST /api/v1/admin/users/{id}/reset-password` — trigger reset email.
  - `PATCH /api/v1/admin/users/{id}/role` — assign community role.
* **Schema:** Add `accountStatus` (`ACTIVE`/`SUSPENDED`/`DELETED`), `suspensionReason`, `suspendedUntil` on `User`.
* **Audit Log:** Track all changes with admin ID and reason.

### Excluded

* User self-service account deletion.
* Bulk import.

---

## Acceptance Criteria

- [ ] **Admin-Only Guard:** All endpoints require `role = admin`.
- [ ] **Suspension:** Suspended users cannot authenticate until reactivated or `suspendedUntil` passes.
- [ ] **Password Reset:** Triggers email via `email.service.ts` with a signed reset token.
- [ ] **Role Assignment:** Only whitelisted roles accepted (`user`, `trainer`, `moderator`).
- [ ] **Audit Trail:** Reason required on suspension, deletion, and role change.

---

## Dependencies

* Auth middleware + admin role
* `User` model
* Email service (`src/utils/email.service.ts`)
* Audit log collection

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
