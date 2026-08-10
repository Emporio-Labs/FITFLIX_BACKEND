# 🚀 US-A9 - Remove Spam and Offensive Content (Admin)

**Type:** Backend Community Feature

## Objective

Provide endpoints for admins to review reported posts, detect spam patterns, remove offensive media, and warn or suspend offenders.

---

## Business Goal

* Maintain community standards by removing harmful content quickly.
* Detect spam patterns programmatically to reduce review load.
* Link content removal to offender penalties for consistent enforcement.

---

## User Story

**As an** admin

**I want** to delete spam or offensive posts

**So that** the community remains professional.

---

## Scope

### Included

* **Endpoints:**
  - `GET /api/v1/admin/community/post-reports?status=OPEN` — reported posts queue.
  - `DELETE /api/v1/admin/community/posts/{id}` — remove offensive post (soft-delete).
  - `DELETE /api/v1/admin/community/media/{id}` — remove offensive media asset.
  - `POST /api/v1/admin/community/spam-signals` — record spam heuristics (link count, repeat text).
* **Spam Detection Signals:** Aggregated per user for the review UI (repeat text ratio, external link count, report count).
* **Escalation:** Optional `warn` / `suspend` parameters chain into US-A2 / US-A6 actions.

### Excluded

* Fully automated content takedowns.

---

## Acceptance Criteria

- [ ] **Report Queue:** Lists reported posts newest-first with report count and signals.
- [ ] **Removal:** Soft-deletes post, logs `reason`, and returns updated status.
- [ ] **Media Removal:** Media URLs are invalidated and files marked deleted.
- [ ] **Escalation:** Warn/suspend flags chain to US-A2/US-A6 endpoints atomically.
- [ ] **Admin-Only Guard:** `authorize(["admin"])`.

---

## Dependencies

* US-A2 — Moderate Comments
* US-A6 — Suspend or Ban Users
* Community `Post` model
* Audit log collection

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
