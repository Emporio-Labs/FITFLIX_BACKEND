# 🚀 US-A6 - Suspend or Ban Users (Admin)

**Type:** Backend Community Feature

## Objective

Extend user management endpoints so admins can temporarily suspend or permanently ban users, record reasons, allow appeals, and restore accounts after review.

---

## Business Goal

* Protect community members from repeat offenders.
* Enforce community guidelines with graded penalties.
* Preserve fairness by supporting appeals and restoration.

---

## User Story

**As an** admin

**I want** to suspend users who violate community guidelines

**So that** the platform remains safe.

---

## Scope

### Included

* **Endpoints:**
  - `POST /api/v1/admin/users/{id}/suspend` — temporary suspension (duration in days) — reused from US-A3.
  - `POST /api/v1/admin/users/{id}/ban` — permanent ban.
  - `POST /api/v1/admin/users/{id}/appeals` — record an appeal submitted by the banned user.
  - `POST /api/v1/admin/users/{id}/restore` — restore an account after review.
* **Schema:** `User.accountStatus` supports `BANNED`; add `banReason`, `bannedAt`, `bannedBy`, `appeals[]`.
* **Login Guard:** Auth middleware blocks users with `SUSPENDED` or `BANNED` status.

### Excluded

* Automated abuse detection.

---

## Acceptance Criteria

- [ ] **Temporary Suspension:** Requires `durationDays`; sets `suspendedUntil` and blocks login.
- [ ] **Permanent Ban:** Requires `reason`; sets `accountStatus = BANNED`.
- [ ] **Appeals:** Endpoint accepts appeal text and stores it in `appeals[]` with timestamp.
- [ ] **Restore:** Resets `accountStatus = ACTIVE` and logs restoration reason.
- [ ] **Auth Block:** Login attempts by suspended/banned users return `403 Forbidden` with code `ACCOUNT_LOCKED`.

---

## Dependencies

* US-A3 — Manage Users
* Auth middleware
* `User` model
* Audit log collection

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
