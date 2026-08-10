# 🚀 US-T4 - Provide Professional Feedback (Trainer)

**Type:** Backend Community Feature

## Objective

Enable trainers to comment on member posts with a distinct "professional feedback" flag so responses are visually distinguished and prioritized.

---

## Business Goal

* Give members expert guidance directly under their posts.
* Distinguish trainer feedback from regular comments for higher trust.
* Track trainer engagement metrics for coaching effectiveness.

---

## User Story

**As a** trainer

**I want** to comment on member posts

**So that** I can guide them professionally.

---

## Scope

### Included

* **Endpoint:**
  - `POST /api/v1/community/posts/{id}/comments` — same endpoint as US-I3, but when author role is `trainer` the response marks the comment as `isProfessionalFeedback = true`.
* **Schema:** `Comment` gains `isProfessionalFeedback` boolean, auto-set from author role.
* **Ordering:** Feed serialization pins professional feedback comments to the top of the thread.
* **Categorization:** Optional `feedbackType` field (`workout_correction`, `nutrition_advice`, `encouragement`, `safety`).

### Excluded

* Video/voice feedback (text-only for v1).
* Paid consultation booking.

---

## Acceptance Criteria

- [ ] **Auto Flag:** Comments created by users with role `trainer` are auto-flagged `isProfessionalFeedback = true`.
- [ ] **Pinned Order:** Comments API returns professional feedback comments before regular comments.
- [ ] **Feedback Type:** Accepts optional enum; invalid values return `400 Bad Request`.
- [ ] **Metrics:** Aggregate counters track total professional feedback per trainer.

---

## Dependencies

* US-I3 — Comment on Posts
* Auth middleware + trainer role detection

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
