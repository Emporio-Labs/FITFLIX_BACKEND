# 🚀 US-I3 - Comment on Posts (Insider)

**Type:** Backend Community Feature

## Objective

Implement REST endpoints and persistence for threaded comments, edits, deletes, mentions, emojis, and comment reporting on community posts.

---

## Business Goal

* Foster active discussion around fitness content.
* Support nested replies for organized threading.
* Enable member reporting to feed the admin moderation workflow.

---

## User Story

**As an** insider

**I want** to comment on posts

**So that** I can participate in community discussions.

---

## Scope

### Included

* **Endpoints:**
  - `POST /api/v1/community/posts/{id}/comments` — create a comment (with optional `parentCommentId` for replies).
  - `PUT /api/v1/community/comments/{id}` — edit own comment.
  - `DELETE /api/v1/community/comments/{id}` — delete own comment (soft-delete).
  - `POST /api/v1/community/comments/{id}/report` — flag a comment for admin review.
  - `GET /api/v1/community/posts/{id}/comments` — paginated comment tree.
* **Schema:** `comments` collection with `postId`, `authorId`, `parentCommentId`, `body`, `mentions[]`, `status` (`ACTIVE`/`DELETED`/`HIDDEN`), timestamps.
* **Mentions:** Extract `@` mentions and validate they reference existing users/trainers.
* **Emoji Support:** Accept unicode emoji in body; enforce max length.

### Excluded

* Real-time push notifications (separate feature).
* Rich media in comments (text-only for v1).

---

## Acceptance Criteria

- [ ] **Create Comment:** Returns 201 with the created comment payload.
- [ ] **Edit Own Only:** Editing another user's comment returns `403 Forbidden`.
- [ ] **Soft Delete:** Deleted comments have `status = DELETED` and body is redacted in list responses.
- [ ] **Report Flow:** Reported comments create a moderation record surfaced under US-A2.
- [ ] **Threading:** Responses include reply counts and a paginated `replies` array.

---

## Dependencies

* Auth middleware + active membership check
* Community `Post` model
* Notification hook for mentions (out of scope for this ticket, but interface must exist)

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
