# 🚀 US-T5 - Like and Share Posts (Trainer)

**Type:** Backend Community Feature

## Objective

Extend like/share endpoints so trainers can react to and distribute member and community content, with trainer-tagged share telemetry.

---

## Business Goal

* Allow trainers to amplify motivational stories and events.
* Distinguish trainer-driven engagement from insider engagement in analytics.
* Reuse the existing like/share primitives without duplication.

---

## User Story

**As a** trainer

**I want** to like and share valuable posts

**So that** useful information reaches more members.

---

## Scope

### Included

* **Reuses Endpoints from US-I2 / US-I4:**
  - `POST /api/v1/community/posts/{id}/like`
  - `POST /api/v1/community/posts/{id}/share`
* **Telemetry:** Share and like records store `actorRole = trainer` when appropriate.
* **Event Promotion Flag:** Optional `promotionContext` (e.g., `event`, `challenge`, `education`) on share payload.

### Excluded

* New endpoints beyond those in US-I2/US-I4.

---

## Acceptance Criteria

- [ ] **Role Recorded:** Like/share records include `actorRole` derived from the JWT.
- [ ] **Promotion Context:** Accepts optional context string; invalid values return `400 Bad Request`.
- [ ] **No Duplicate Endpoints:** Trainers use the shared endpoints; no separate `/trainer/like` route.
- [ ] **Analytics Query:** Backend supports filtering share/like aggregates by `actorRole`.

---

## Dependencies

* US-I2 — Like Community Posts
* US-I4 — Share Posts
* Auth middleware + trainer role

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
