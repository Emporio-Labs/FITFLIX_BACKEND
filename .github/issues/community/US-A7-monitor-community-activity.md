# 🚀 US-A7 - Monitor Community Activity (Admin)

**Type:** Backend Community Feature

## Objective

Expose aggregate analytics endpoints so admins can monitor active users, post/engagement metrics, moderation reports, and community growth.

---

## Business Goal

* Give admins a data-driven view of community health.
* Detect anomalies (spam surges, engagement drops) early.
* Inform strategic decisions on content and moderation.

---

## User Story

**As an** admin

**I want** to monitor overall community activity

**So that** I can ensure healthy engagement.

---

## Scope

### Included

* **Endpoints:**
  - `GET /api/v1/admin/community/metrics/active-users?range=` — DAU/WAU/MAU.
  - `GET /api/v1/admin/community/metrics/posts?range=` — post volume, category breakdown.
  - `GET /api/v1/admin/community/metrics/engagement?range=` — likes, comments, shares per period.
  - `GET /api/v1/admin/community/metrics/reports?range=` — reports created/resolved.
  - `GET /api/v1/admin/community/metrics/growth?range=` — new signups, memberships, churn.
* **Aggregation:** Backed by MongoDB aggregations, cached for 5 minutes.
* **Time Ranges:** Supports `today`, `7d`, `30d`, `90d`, or custom `from/to`.

### Excluded

* Real-time streaming metrics.
* Data export/CSV (future).

---

## Acceptance Criteria

- [ ] **Admin-Only Guard:** All endpoints require `authorize(["admin"])`.
- [ ] **Range Validation:** Invalid ranges return `400 Bad Request`.
- [ ] **Cache:** Responses cached with 5-minute TTL keyed by (endpoint, range).
- [ ] **Response Shape:** Every metric returns timeseries buckets suitable for charting.
- [ ] **Performance:** Each query completes in under 2s on the current dataset.

---

## Dependencies

* Auth middleware + admin role
* All community collections (`posts`, `comments`, `postLikes`, `postShares`, `commentReports`)
* Cache layer (in-memory or Redis)

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
