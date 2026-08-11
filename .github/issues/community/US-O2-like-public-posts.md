# 🚀 US-O2 - Like Public Posts (Outsider)

**Type:** Backend Community Feature

## Objective

Implement REST endpoints and persistence to let outsiders (unauthenticated visitors) toggle a like on public community posts using a device/session identifier.

---

## Business Goal

* Allow non-members to signal appreciation for public content, increasing engagement metrics.
* Provide accurate like counts on public posts to boost social proof for potential members.
* Prevent duplicate likes from the same visitor.

---

## User Story

**As an** outsider

**I want** to like public posts

**So that** I can appreciate useful content.

---

## Scope

### Included

* **Like Endpoint:**
  - `POST /api/v1/community/public/posts/{id}/like` — record a like using a `visitorId` (client-generated UUID).
  - `DELETE /api/v1/community/public/posts/{id}/like` — remove a previously added like.
* **Database Schema:** A `postLikes` collection or embedded array supporting anonymous likes keyed by `visitorId`.
* **Deduplication:** A unique compound index on `(postId, visitorId)` to prevent duplicate likes.
* **Real-time Count:** Response returns the updated `likeCount` immediately.
* **Visibility Guard:** Only allow likes on posts where `visibility = PUBLIC`.

### Excluded

* Notifying the post author of outsider likes.
* Displaying who liked a post to other viewers.

---

## Acceptance Criteria

- [ ] **Like Toggle:** `POST /like` increments `likeCount`; `DELETE /like` decrements it.
- [ ] **Deduplication:** Repeated `POST /like` with the same `visitorId` does not increment count beyond 1.
- [ ] **Public-Only Guard:** Attempting to like a `MEMBERS_ONLY` post returns `403 Forbidden`.
- [ ] **Response Payload:** Response includes updated `likeCount` and `liked: true|false`.
- [ ] **Validation:** Requests missing `visitorId` return `400 Bad Request`.

---

## Dependencies

* US-O1 — Browse Community Posts
* Community `Post` model
* Rate-limiting middleware for anonymous writes

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
