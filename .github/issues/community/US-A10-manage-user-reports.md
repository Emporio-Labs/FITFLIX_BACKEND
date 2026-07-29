# 🚀 US-A10 - Manage User Reports (Admin)

**Type:** Backend Community Feature

## Objective

Expose a unified reports management endpoint set: list all user-generated reports (posts, comments, users), categorize them, take action, and notify reporters of resolution.

---

## Business Goal

* Consolidate all moderation reports into one triage workflow.
* Guarantee reporters receive closure feedback.
* Preserve a full moderation history for compliance.

---

## User Story

**As an** admin

**I want** to manage reports submitted by users

**So that** inappropriate content is addressed promptly.

---

## Scope

### Included

* **Endpoints:**
  - `GET /api/v1/admin/reports?type=&status=&category=` — unified reports queue.
  - `GET /api/v1/admin/reports/{id}` — report detail with target content snapshot.
  - `PATCH /api/v1/admin/reports/{id}/categorize` — assign a reason category.
  - `POST /api/v1/admin/reports/{id}/resolve` — resolve with `action` (`removed`, `warned`, `no_action`, `suspended`).
  - `GET /api/v1/admin/moderation-history?adminId=` — full moderation audit trail.
* **Schema:** `reports` collection with `type` (`POST`/`COMMENT`/`USER`), `targetId`, `reporterId`, `category`, `status`, `action`, `resolvedAt`, `resolvedBy`.
* **Notification:** Reporter receives an email/notification when their report is resolved.
* **Audit Trail:** Every action recorded permanently.

### Excluded

* Public-facing moderation transparency reports.

---

## Acceptance Criteria

- [ ] **Unified Queue:** Lists post, comment, and user reports with filters.
- [ ] **Categorization:** Category enum enforced; invalid values return `400 Bad Request`.
- [ ] **Resolution:** Requires `action` and `notes`; status transitions to `RESOLVED`.
- [ ] **Reporter Notification:** Sent on resolution with the action taken.
- [ ] **History:** Full moderation history queryable by admin, target, or date range.
- [ ] **Admin-Only Guard:** `authorize(["admin"])` on every endpoint.

---

## Dependencies

* US-A2 — Moderate Comments
* US-A9 — Remove Spam and Offensive Content
* Auth middleware + admin role
* Email/notification service
* Audit log collection

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
