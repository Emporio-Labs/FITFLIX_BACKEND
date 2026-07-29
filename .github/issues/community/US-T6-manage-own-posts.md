# 🚀 US-T6 - Manage Own Posts (Trainer)

**Type:** Backend Community Feature

## Objective

Provide edit, delete, and analytics endpoints for trainers to manage their own educational posts, with per-post engagement statistics.

---

## Business Goal

* Ensure educational content stays accurate and current.
* Give trainers visibility into per-post engagement for coaching decisions.
* Enable safe replacement of outdated media.

---

## User Story

**As a** trainer

**I want** to edit and delete my posts

**So that** my educational content remains accurate.

---

## Scope

### Included

* **Endpoints:**
  - `PUT /api/v1/community/trainer/posts/{id}` — edit own trainer post.
  - `DELETE /api/v1/community/trainer/posts/{id}` — soft-delete own post.
  - `GET /api/v1/community/trainer/posts/{id}/stats` — engagement stats (views, likes, comments, shares, average watch time for videos).
* **Ownership Guard:** Only the authoring trainer or admin can operate on the post.
* **Media Replacement:** Replacing media invalidates prior URLs and pushes a new signed URL.
* **Edit History:** Reuses `editHistory[]` from US-I6.

### Excluded

* Editing another trainer's posts.
* Deep video analytics (watch heatmaps).

---

## Acceptance Criteria

- [ ] **Ownership Guard:** Editing another trainer's post returns `403 Forbidden`.
- [ ] **Media Swap:** New media URLs replace old; old URLs become inaccessible.
- [ ] **Soft Delete:** Same lifecycle as US-I6 (30-day restore window).
- [ ] **Stats Payload:** Includes views, likes, comments, shares, and (if video) avg watch time.
- [ ] **Edit History:** Every edit recorded in `editHistory[]`.

---

## Dependencies

* US-T1 — Create Educational Posts
* US-I6 — Edit/Delete Own Posts (shared logic)
* Auth middleware + trainer role

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
