# 🚀 US-T3 - Repost Member Transformation Posts (Trainer)

**Type:** Backend Community Feature

## Objective

Provide endpoints for trainers to repost member transformation posts (with the member's consent) and feature them with motivational captions.

---

## Business Goal

* Motivate the community by amplifying successful transformations.
* Preserve original member credit and require explicit consent.
* Give trainers a curation mechanism to highlight standout achievements.

---

## User Story

**As a** trainer

**I want** to repost successful member transformations

**So that** I can motivate the community.

---

## Scope

### Included

* **Endpoints:**
  - `POST /api/v1/community/posts/{id}/request-repost` — trainer requests member consent.
  - `POST /api/v1/community/repost-requests/{id}/approve` — member approves.
  - `POST /api/v1/community/trainer/reposts` — trainer posts the reshared content after consent.
* **Schema:** `repostRequests` collection (`postId`, `trainerId`, `status`, `respondedAt`); `Post` gains `repostOfId`, `repostCaption`, `featured` flag.
* **Consent Guard:** Cannot publish repost until an approved consent record exists.

### Excluded

* Anonymized reposts.
* Non-transformation content (use general repost flow).

---

## Acceptance Criteria

- [ ] **Consent Required:** Attempting to publish a repost without an approved consent returns `403 Forbidden`.
- [ ] **Trainer-Only Guard:** Only users with role `trainer` can create reposts through this endpoint.
- [ ] **Attribution:** Repost payload includes the original member's name and post link.
- [ ] **Featured Flag:** Trainer can optionally mark repost as `featured` for the transformation gallery.
- [ ] **Notification:** Member receives a notification when a trainer requests to repost their content.

---

## Dependencies

* US-I1 — Create Posts
* Auth middleware + trainer role
* Notification service (interface)
* Community `Post` model

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
