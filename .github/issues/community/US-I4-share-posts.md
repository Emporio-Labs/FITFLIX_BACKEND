# 🚀 US-I4 - Share Posts (Insider)

**Type:** Backend Community Feature

## Objective

Provide endpoints for insiders to share community posts publicly or privately, generate share links, and track share counts by channel.

---

## Business Goal

* Amplify useful fitness content beyond the community platform.
* Distinguish between public and private shares for analytics.
* Preserve visibility rules — insiders cannot expose members-only posts publicly.

---

## User Story

**As an** insider

**I want** to share community posts

**So that** I can spread useful fitness information.

---

## Scope

### Included

* **Endpoints:**
  - `POST /api/v1/community/posts/{id}/share` — records share with `channel` (`public`, `private`, `link_copy`, `whatsapp`, etc.).
  - `GET /api/v1/community/posts/{id}/share-link` — returns a canonical URL.
* **Visibility Guard:** Public shares of `MEMBERS_ONLY` posts return `403 Forbidden`.
* **Aggregate Counter:** Denormalized `shareCount` on the post.
* **Persistence:** `postShares` collection with `postId`, `sharerId`, `channel`, `sharedAt`.

### Excluded

* Direct message delivery (client responsibility).
* Reposting (see US-I5).

---

## Acceptance Criteria

- [ ] **Share Endpoint:** Records the share, increments counter, returns updated `shareCount`.
- [ ] **Visibility Enforcement:** Public share of member-only post returns `403 Forbidden`.
- [ ] **Channel Validation:** Invalid channel returns `400 Bad Request` with allowed values listed.
- [ ] **Link Generation:** Public share links resolve without auth; private share links include a signed token.

---

## Dependencies

* US-I1 — Create Posts
* Auth middleware + active membership check
* Community `Post` model

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
