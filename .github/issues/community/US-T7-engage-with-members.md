# 🚀 US-T7 - Engage with Members (Trainer)

**Type:** Backend Community Feature

## Objective

Provide REST endpoints that let trainers reply to comments, host Q&A sessions, and post exercise recommendations in a structured, tracked way.

---

## Business Goal

* Deepen trainer–member relationships through active conversation.
* Support dedicated Q&A sessions to gather and answer member questions in batches.
* Track trainer engagement KPIs (response time, thread participation).

---

## User Story

**As a** trainer

**I want** to interact with members through comments

**So that** I can answer fitness-related questions.

---

## Scope

### Included

* **Comment Reply Endpoint:** Reuses `POST /api/v1/community/posts/{id}/comments` with `parentCommentId`.
* **Q&A Endpoints:**
  - `POST /api/v1/community/trainer/qa-sessions` — schedule a Q&A window.
  - `POST /api/v1/community/trainer/qa-sessions/{id}/answer` — post an answer bound to the session.
  - `GET /api/v1/community/qa-sessions?trainerId=&status=` — public listing.
* **Recommendation Endpoint:** `POST /api/v1/community/trainer/recommendations` — publish targeted exercise recommendations linked to a user or public post.
* **Engagement Metrics:** Response times and thread participation counted per trainer.

### Excluded

* Real-time chat (out of scope).
* Voice/video Q&A hosting.

---

## Acceptance Criteria

- [ ] **Reply Threading:** Trainer replies appear as children of the parent comment.
- [ ] **Q&A Session:** Only reachable while `status = OPEN`; answers outside the window are rejected.
- [ ] **Recommendation:** Requires `exerciseId` or an inline exercise description; validates target user is a member.
- [ ] **Metrics:** Trainer profile includes response-time aggregates and total answers.
- [ ] **Trainer-Only Guard:** All write endpoints restricted to `role = trainer`.

---

## Dependencies

* US-I3 — Comment on Posts
* `Exercise` model
* Auth middleware + trainer role
* Community `Post` model

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
