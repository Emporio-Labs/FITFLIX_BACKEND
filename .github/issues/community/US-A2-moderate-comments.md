# 🚀 US-A2 - Moderate Comments (Admin)

**Type:** Backend Community Feature

## Objective

Provide REST endpoints for admins to review reported comments, hide or delete inappropriate ones, and issue warnings to users.

---

## Business Goal

* Keep community discussions respectful and constructive.
* Give admins a triage queue for reports.
* Track offender history to inform escalation decisions.

---

## User Story

**As an** admin

**I want** to remove inappropriate comments

**So that** discussions remain respectful.

---

## Scope

### Included

* **Endpoints:**
  - `GET /api/v1/admin/community/comment-reports` — paginated list of reported comments.
  - `DELETE /api/v1/admin/community/comments/{id}` — remove offensive comment (soft-delete).
  - `POST /api/v1/admin/community/comments/{id}/hide` — hide spam without deleting.
  - `POST /api/v1/admin/community/users/{userId}/warn` — issue a warning to a user.
* **Schema:** Add `warnings[]` on `User` (with reason, admin, timestamp); `Comment` gains `moderationStatus`.
* **Audit Log:** Track admin action + reason.

### Excluded

* Automatic ML moderation (future work).

---

## Acceptance Criteria

- [ ] **Report Queue:** Reported comments listed newest-first with report count.
- [ ] **Delete/Hide:** Distinguishable actions — deleted comments are soft-deleted; hidden comments remain in DB but invisible in feed.
- [ ] **Warnings:** Warning history stored on user document and accessible via admin lookup.
- [ ] **Audit Trail:** Reason required on all moderation actions.
- [ ] **Admin-Only Guard:** `authorize(["admin"])`.

---

## Dependencies

* US-I3 — Comment on Posts (report endpoint)
* Auth middleware + admin role
* Audit log collection

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
