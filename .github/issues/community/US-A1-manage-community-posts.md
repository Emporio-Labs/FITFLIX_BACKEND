# 🚀 US-A1 - Manage Community Posts (Admin)

**Type:** Backend Community Feature

## Objective

Provide admin REST endpoints to create official announcements and edit, delete, restore, or archive any community post.

---

## Business Goal

* Give admins full authority over community content to enforce standards.
* Support official announcements distinct from user/trainer posts.
* Preserve a restoration path for accidental or reversible deletions.

---

## User Story

**As an** admin

**I want** to create, edit, and delete any post

**So that** the community remains professional and relevant.

---

## Scope

### Included

* **Endpoints:**
  - `POST /api/v1/admin/community/announcements` — create an official announcement post (`authorType = ADMIN`).
  - `PUT /api/v1/admin/community/posts/{id}` — edit any post.
  - `DELETE /api/v1/admin/community/posts/{id}` — soft-delete any post.
  - `POST /api/v1/admin/community/posts/{id}/restore` — restore soft-deleted post.
  - `POST /api/v1/admin/community/posts/{id}/archive` — archive an outdated post.
* **Audit Log:** Every admin action recorded with `adminId`, `action`, `reason`, `timestamp`.
* **Admin Guard:** `authorize(["admin"])` on every endpoint.

### Excluded

* Automated content moderation (see US-A9).
* Batch operations.

---

## Acceptance Criteria

- [ ] **Admin-Only Guard:** Non-admin roles receive `403 Forbidden`.
- [ ] **Any-Post Edit:** Admin can edit posts regardless of original author.
- [ ] **Audit Trail:** Every action inserts an audit-log record with `reason` (required).
- [ ] **Restore:** Restored posts return to their previous status.
- [ ] **Archive:** Archived posts remain visible via a dedicated archive endpoint but not in the main feed.

---

## Dependencies

* Auth middleware + admin role
* Community `Post` model
* Audit log collection

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
