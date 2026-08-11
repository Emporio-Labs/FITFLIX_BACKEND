# 🚀 US-I6 - Edit and Delete Own Posts (Insider)

**Type:** Backend Community Feature

## Objective

Enable insiders to edit, replace media, delete, and restore their own community posts, with an edit history trail.

---

## Business Goal

* Let members correct or update posts without needing admin intervention.
* Preserve content integrity through an audit-friendly edit history.
* Provide a short-lived restore window so accidental deletes are recoverable.

---

## User Story

**As an** insider

**I want** to edit or delete my own posts

**So that** I can maintain accurate content.

---

## Scope

### Included

* **Endpoints:**
  - `PUT /api/v1/community/posts/{id}` — edit body/media/visibility on own post.
  - `DELETE /api/v1/community/posts/{id}` — soft-delete own post.
  - `POST /api/v1/community/posts/{id}/restore` — restore within 30 days.
  - `GET /api/v1/community/posts/{id}/history` — edit history.
* **Schema:** Add `editHistory[]` (array of `{ editedAt, changes }`) and `deletedAt` fields on `Post`.
* **Ownership Guard:** All operations require `req.user._id === post.authorId`.
* **Restore Window:** Post remains soft-deleted for 30 days before permanent deletion.

### Excluded

* Editing others' posts (admin only, see US-A1).
* Media transcoding.

---

## Acceptance Criteria

- [ ] **Own-Post Only:** Editing/deleting another user's post returns `403 Forbidden`.
- [ ] **Edit History:** Each edit appends a diff record to `editHistory`.
- [ ] **Soft Delete:** Deleted posts hidden from feed but remain in DB with `deletedAt` set.
- [ ] **Restore Window:** `POST /restore` fails after 30 days from `deletedAt`.
- [ ] **Cascade:** Deleting a post soft-hides its comments and reactions from public views.

---

## Dependencies

* US-I1 — Create Posts
* Auth middleware + ownership check
* Community `Post` model

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
