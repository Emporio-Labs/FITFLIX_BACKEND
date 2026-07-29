# 🚀 US-O1 - Browse Community Posts (Outsider)

**Type:** Backend Community Feature

## Objective

Implement the REST endpoints and database schema/models in the FITFLIX backend to allow non-member (outsider) users to browse publicly visible community posts.

---

## Business Goal

* Enable non-members to explore public content and understand the gym culture before joining.
* Drive membership conversion by exposing a curated feed of trainer and member public posts.
* Serve as the foundation for the public community feed rendered in the marketing site and outsider app view.

---

## User Story

**As an** outsider (non-member)

**I want** to browse public community posts

**So that** I can understand the gym culture before deciding to join.

---

## Scope

### Included

* **Database Schema:** Ensure the `posts` collection stores visibility (`PUBLIC`/`MEMBERS_ONLY`), author, title, description, media URLs, createdAt, updatedAt, likeCount, shareCount.
* **Public Feed Endpoint:**
  - `GET /api/v1/community/public/posts` — paginated list of public posts (no auth required)
  - `GET /api/v1/community/public/posts/{id}` — get a single public post
  - `GET /api/v1/community/public/posts/search?q={keyword}` — keyword search on title/description
* **Response Payload:** Include post title, description, media, author (name + role), createdAt, likeCount, shareCount.
* **Rate Limiting:** Public endpoints must be rate-limited to prevent scraping.
* **Membership CTA Flag:** Response envelope includes a `membershipPrompt` field encouraging signup.

### Excluded

* Commenting or reacting from unauthenticated users (outsiders can only like/share via US-O2/US-O3).
* Member-only or draft posts.
* Personalized feed ranking.

---

## Acceptance Criteria

- [ ] **Database Schema:** The `posts` collection has a `visibility` field indexed for fast public queries.
- [ ] **Public Endpoint:** `GET /api/v1/community/public/posts` returns only posts with `visibility = PUBLIC` and is accessible without a JWT.
- [ ] **Pagination:** Supports `page` and `limit` query params with sensible defaults (10 per page, max 50).
- [ ] **Search:** Keyword search matches against title and description; empty query returns latest feed.
- [ ] **Rate Limit:** Requests over the configured threshold return `429 Too Many Requests`.
- [ ] **CTA Payload:** Every response body includes a `membershipPrompt` object with call-to-action copy.

---

## Dependencies

* Community `Post` model (see `src/models/community/Post.ts`)
* Rate-limiting middleware
* Existing public route configuration in `src/app.ts`

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
