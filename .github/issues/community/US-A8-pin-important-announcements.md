# 🚀 US-A8 - Pin Important Announcements (Admin)

**Type:** Backend Community Feature

## Objective

Provide endpoints for admins to pin announcements to the top of the feed, schedule visibility windows, remove outdated announcements, and highlight emergency notices.

---

## Business Goal

* Ensure critical information reaches every member.
* Support scheduled and time-boxed announcements.
* Distinguish emergency notices with elevated styling flags.

---

## User Story

**As an** admin

**I want** to pin important announcements

**So that** members always see critical information first.

---

## Scope

### Included

* **Endpoints:**
  - `POST /api/v1/admin/community/posts/{id}/pin` — pin a post (accepts `until`, `emergency` flags).
  - `POST /api/v1/admin/community/posts/{id}/unpin` — remove pin.
  - `POST /api/v1/admin/community/announcements/{id}/schedule` — set `visibleFrom`, `visibleUntil`.
* **Schema:** `Post` gains `pinned` (boolean), `pinnedUntil`, `emergency` (boolean), `visibleFrom`, `visibleUntil`.
* **Feed Ordering:** Feed endpoints sort pinned + non-expired posts first.
* **Notification Hook:** Emergency notices dispatch a push notification event.

### Excluded

* Targeted notifications by segment (future).

---

## Acceptance Criteria

- [ ] **Pin Endpoint:** Sets `pinned = true` and optional `pinnedUntil`.
- [ ] **Scheduled Visibility:** Posts outside `[visibleFrom, visibleUntil]` are hidden from public/member feeds.
- [ ] **Emergency Flag:** Emergency-flagged pins are sorted above regular pins.
- [ ] **Notification Event:** Emergency pin fires a `NOTIFY_EMERGENCY` event to the notification service.
- [ ] **Admin-Only Guard:** All endpoints require `authorize(["admin"])`.

---

## Dependencies

* Auth middleware + admin role
* Community `Post` model
* Notification service (interface)
* Scheduler / cron worker (for auto-unpin)

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
