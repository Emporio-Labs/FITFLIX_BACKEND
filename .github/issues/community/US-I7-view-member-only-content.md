# 🚀 US-I7 - View Member-Only Content (Insider)

**Type:** Backend Community Feature

## Objective

Expose REST endpoints that gate premium/member-only community content behind an active membership check.

---

## Business Goal

* Deliver exclusive value for paying members to reinforce membership ROI.
* Consolidate premium plans, guides, challenges, announcements, and videos into a single access layer.
* Ensure lapsed or inactive members lose access automatically.

---

## User Story

**As an** insider

**I want** to access exclusive content

**So that** I receive additional benefits from my membership.

---

## Scope

### Included

* **Endpoints:**
  - `GET /api/v1/community/members/feed` — member-only feed (posts, videos, guides, announcements).
  - `GET /api/v1/community/members/challenges` — active member-only challenges.
  - `GET /api/v1/community/members/announcements` — exclusive announcements.
* **Membership Guard:** Middleware verifies `Membership.status = ACTIVE` for the requesting user.
* **Visibility Filter:** Only surface posts where `visibility = MEMBERS_ONLY` or `PUBLIC`.

### Excluded

* Content authoring (covered by US-I1/US-T1).
* Payment/subscription upgrades.

---

## Acceptance Criteria

- [ ] **Membership Guard:** Requests without an active membership return `403 Forbidden` with code `MEMBERSHIP_REQUIRED`.
- [ ] **Feed Content:** Response includes both public and member-only content in a unified feed.
- [ ] **Challenges:** Endpoint returns only currently active member-only challenges.
- [ ] **Announcements:** Announcements endpoint respects publish/expiry windows.
- [ ] **Cache:** Feed responses cacheable with per-user membership status.

---

## Dependencies

* Auth middleware
* `Membership` model + status check
* Community `Post` model

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
