# 🚀 US-I1 - Create Posts (Insider)

**Type:** Backend Community Feature

## Objective

Implement REST endpoints and persistence for authenticated members (insiders) to create text/media community posts with hashtags, mentions, drafts, and visibility control.

---

## Business Goal

* Enable members to share their fitness journey, driving community engagement.
* Support rich content (text, images, videos) with metadata (hashtags, mentions).
* Give members control over visibility (public/members-only) and publishing lifecycle (draft/publish).

---

## User Story

**As an** insider (gym member)

**I want** to create posts

**So that** I can share my fitness journey with other members.

---

## Scope

### Included

* **Endpoints:**
  - `POST /api/v1/community/posts` — create a new post.
  - `POST /api/v1/community/posts/{id}/publish` — publish a draft post.
  - `POST /api/v1/community/media/upload` — pre-signed multipart upload for images/videos.
* **Post Schema Fields:** `author`, `body`, `mediaUrls[]`, `hashtags[]`, `mentions[]`, `visibility`, `status` (`DRAFT`/`PUBLISHED`), `createdAt`, `updatedAt`.
* **Validation:** Enforce max body length, allowed media types, max media count per post.
* **Mentions/Hashtags:** Parsed and stored as indexed arrays for future search.

### Excluded

* Post scheduling (trainer-only capability handled under US-T1).
* Reposting (US-I5).

---

## Acceptance Criteria

- [ ] **Post Creation:** `POST /posts` accepts body, media URLs, hashtags, mentions and returns the created post ID.
- [ ] **Draft/Publish:** Posts default to `DRAFT`; explicit publish endpoint transitions to `PUBLISHED`.
- [ ] **Media Limits:** Requests exceeding max media count or containing unsupported types return `400 Bad Request`.
- [ ] **Visibility Guard:** Only authenticated users with role `user` (insider) and active membership can call these endpoints.
- [ ] **Author Attribution:** Post is stored with the authenticated user's ID as author.

---

## Dependencies

* Auth middleware (`authenticateToken`)
* Active `Membership` check
* Community `Post` model
* Media upload service

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
