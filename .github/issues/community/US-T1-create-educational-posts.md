# 🚀 US-T1 - Create Educational Posts (Trainer)

**Type:** Backend Community Feature

## Objective

Provide REST endpoints and persistence so trainers can publish categorized educational content, schedule posts, and attach downloadable resources.

---

## Business Goal

* Deliver professional fitness guidance to members through a structured content pipeline.
* Support scheduling for consistent posting cadence.
* Allow categorized content (workout, nutrition, tips) with PDF attachments.

---

## User Story

**As a** trainer

**I want** to publish educational content

**So that** members receive professional fitness guidance.

---

## Scope

### Included

* **Endpoints:**
  - `POST /api/v1/community/trainer/posts` — create a post as trainer.
  - `POST /api/v1/community/trainer/posts/{id}/schedule` — schedule a future publish time.
  - `POST /api/v1/community/media/upload` — pre-signed upload for images/videos/PDFs.
* **Schema Fields:** `authorType = TRAINER`, `category` enum, `attachments[]` (PDF URLs), `scheduledAt`, `status`.
* **Scheduler:** A cron-driven job promotes `SCHEDULED` posts to `PUBLISHED` when `scheduledAt` passes.

### Excluded

* Automatic content moderation.
* Analytics dashboards (out of scope).

---

## Acceptance Criteria

- [ ] **Trainer-Only Guard:** Endpoints require `role = trainer` — insiders/admins are rejected.
- [ ] **Category Enum:** Invalid category returns `400 Bad Request`.
- [ ] **PDF Attachments:** Accept application/pdf uploads and store secure URLs.
- [ ] **Scheduled Posts:** Posts with `scheduledAt` in the future stay in `SCHEDULED` status and become `PUBLISHED` at scheduled time.
- [ ] **Response:** Includes the persisted post with all metadata.

---

## Dependencies

* Auth middleware + `authorize(["trainer"])`
* Community `Post` model
* Media upload service
* Scheduler / cron worker

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
