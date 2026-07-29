# 🚀 US-O3 - Share Public Posts (Outsider)

**Type:** Backend Community Feature

## Objective

Provide the REST endpoints and persistence needed to generate shareable links, track share counts, and record share channels for public community posts.

---

## Business Goal

* Encourage viral distribution of gym content across social and messaging platforms.
* Measure which channels drive the most shares to inform marketing.
* Ensure only public posts are shareable to protect member-only content.

---

## User Story

**As an** outsider

**I want** to share public posts

**So that** I can recommend the gym community to others.

---

## Scope

### Included

* **Share Endpoint:**
  - `POST /api/v1/community/public/posts/{id}/share` — increments the share counter and logs the channel (`facebook`, `twitter`, `whatsapp`, `link_copy`, etc.).
  - `GET /api/v1/community/public/posts/{id}/share-link` — returns a canonical shareable URL for the post.
* **Database Schema:** A `postShares` collection tracking `postId`, `channel`, `sharedAt`, optional `visitorId`.
* **Public-Only Guard:** Only posts with `visibility = PUBLIC` can be shared.
* **Aggregate Counter:** Maintain a denormalized `shareCount` on the post document.

### Excluded

* Actual publishing to social platforms (client-side deep link responsibility).
* Attribution tracking beyond channel string.

---

## Acceptance Criteria

- [ ] **Share Endpoint:** Increments `shareCount` and inserts a `postShares` document.
- [ ] **Share Link:** Returns a canonical URL of the form `https://<host>/community/p/{id}`.
- [ ] **Public-Only Guard:** Sharing a `MEMBERS_ONLY` post returns `403 Forbidden`.
- [ ] **Channel Validation:** Invalid channel values return `400 Bad Request` with a list of allowed values.
- [ ] **Count Consistency:** `shareCount` on the post equals the number of `postShares` records for that post.

---

## Dependencies

* US-O1 — Browse Community Posts
* Community `Post` model
* Rate-limiting middleware

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
