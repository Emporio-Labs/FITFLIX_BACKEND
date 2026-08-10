# 🚀 US-I2 - Like Community Posts (Insider)

**Type:** Backend Community Feature

## Objective

Implement authenticated like/unlike endpoints and persistence for insiders to react to community posts (trainer and member).

---

## Business Goal

* Provide first-class engagement primitives for the community feed.
* Prevent duplicate likes from the same member.
* Surface accurate reaction counts to encourage participation.

---

## User Story

**As an** insider

**I want** to like community posts

**So that** I can encourage and support other members.

---

## Scope

### Included

* **Endpoints:**
  - `POST /api/v1/community/posts/{id}/like`
  - `DELETE /api/v1/community/posts/{id}/like`
  - `GET /api/v1/community/posts/{id}/likes` — paginated liker list.
* **Persistence:** A `postLikes` collection keyed by `(postId, userId)` unique compound index.
* **Aggregate Counter:** Denormalized `likeCount` on the post document.
* **Response Payload:** `{ liked: boolean, likeCount: number }`.

### Excluded

* Emoji reactions beyond a single "like".
* Notifications to the author (handled by a separate notifications feature).

---

## Acceptance Criteria

- [ ] **Toggle Semantics:** Repeated `POST /like` by the same user does not increment beyond 1.
- [ ] **Unlike:** `DELETE /like` decrements the counter and removes the record.
- [ ] **Auth Required:** Requests without a valid JWT return `401 Unauthorized`.
- [ ] **Visibility Guard:** Liking a `MEMBERS_ONLY` post is allowed only for insiders with an active membership.
- [ ] **Liker List:** Paginated response includes user IDs and display names.

---

## Dependencies

* Auth middleware
* Community `Post` model
* Active `Membership` check for member-only posts

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
