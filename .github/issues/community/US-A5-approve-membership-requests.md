# 🚀 US-A5 - Approve Membership Requests (Admin)

**Type:** Backend Community Feature

## Objective

Provide REST endpoints for admins to review, approve, and reject membership applications submitted via US-O5, and to notify applicants of decisions.

---

## Business Goal

* Ensure only eligible users become community members.
* Verify identity documents before granting access.
* Provide clear applicant communication on outcomes.

---

## User Story

**As an** admin

**I want** to approve or reject membership applications

**So that** only eligible users become insiders.

---

## Scope

### Included

* **Endpoints:**
  - `GET /api/v1/admin/membership-applications?status=PENDING` — paginated queue.
  - `GET /api/v1/admin/membership-applications/{id}` — full application detail with documents.
  - `POST /api/v1/admin/membership-applications/{id}/approve` — approve, provisions `User` + `Membership`.
  - `POST /api/v1/admin/membership-applications/{id}/reject` — reject with reason.
* **User Provisioning:** On approval, creates a `User` record (if not already) and an active `Membership` record.
* **Notification:** Applicant receives email of approval (with login link) or rejection (with reason).
* **Document Review:** Endpoints return signed URLs for uploaded ID documents.

### Excluded

* Payment collection (out of scope).
* Automated document verification.

---

## Acceptance Criteria

- [ ] **Queue Filtering:** Supports filtering by `status` and applicant search.
- [ ] **Approval:** Creates `User` + `Membership`, marks application `APPROVED`, sends approval email.
- [ ] **Rejection:** Requires `reason`; sends rejection email with the provided reason.
- [ ] **Document Access:** Uploaded documents return via signed URLs with short expiry.
- [ ] **Admin-Only Guard:** `authorize(["admin"])` on every endpoint.

---

## Dependencies

* US-O5 — Apply for Membership
* `User`, `Membership`, `MembershipPlan` models
* Email service
* Audit log collection

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
