# 🚀 US-O4 - View Trainer Content (Outsider)

**Type:** Backend Community Feature

## Objective

Expose REST endpoints that surface trainer-authored public content (educational posts, videos, profiles, tips, event announcements) to outsiders.

---

## Business Goal

* Position trainers as credible experts to convert outsiders into members.
* Provide a discoverable catalogue of trainer content and profiles for prospective members.
* Highlight gym events and announcements to draw new users.

---

## User Story

**As an** outsider

**I want** to view trainer posts and profiles

**So that** I can learn about workout routines, nutrition, and gym activities.

---

## Scope

### Included

* **Trainer Content Endpoints:**
  - `GET /api/v1/community/public/trainers` — list public trainer profiles (name, avatar, specialities, qualifications).
  - `GET /api/v1/community/public/trainers/{id}` — trainer profile detail.
  - `GET /api/v1/community/public/trainers/{id}/posts` — public posts authored by a specific trainer.
  - `GET /api/v1/community/public/posts?category=education|nutrition|announcement|demo` — filter public posts by category.
* **Category Support:** Extend the `posts` schema with a `category` enum.
* **Video Streaming:** Return media URLs (video/HLS) resolvable without auth for public assets.

### Excluded

* Private DMs with trainers.
* Paid course enrollment.

---

## Acceptance Criteria

- [ ] **Trainer List:** Public trainer profiles are returned with name, avatar, specialities, qualifications.
- [ ] **Trainer Detail:** Returns full public trainer profile with linked public posts.
- [ ] **Category Filter:** `?category=` returns only public posts of the requested category.
- [ ] **Media Access:** Video/image URLs on public posts are reachable without a JWT.
- [ ] **Visibility Guard:** Trainer's `MEMBERS_ONLY` posts do not appear in these endpoints.

---

## Dependencies

* US-O1 — Browse Community Posts
* Existing `Trainer` model (`src/models/Trainer.ts`)
* Community `Post` model with category field

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
