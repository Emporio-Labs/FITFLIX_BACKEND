# 🚀 US-I5 - Repost Trainer Posts (Insider)

**Type:** Backend Community Feature

## Objective

Implement a repost mechanism that allows insiders to reshare trainer-authored posts with a personal caption while preserving original attribution.

---

## Business Goal

* Amplify professional fitness advice within the community.
* Preserve authorship credit for the original trainer.
* Prevent tampering with original trainer content.

---

## User Story

**As an** insider

**I want** to repost trainer posts

**So that** I can share professional fitness advice with others.

---

## Scope

### Included

* **Endpoint:**
  - `POST /api/v1/community/posts/{id}/repost` — creates a new post referencing the original.
* **Schema:** Add fields to `Post`: `repostOfId` (ObjectId ref), `repostCaption` (optional), `isRepost` (boolean).
* **Guard:** Only allow reposting when the original author has role `trainer` and post visibility permits.
* **Immutability:** Reposting duplicates a snapshot reference; original content cannot be edited by the reposter.
* **Repost Indicator:** Feed responses flag reposts and include original post metadata.

### Excluded

* Reposting member content (handled under US-T3 for trainers).
* Nested reposts (repost of repost).

---

## Acceptance Criteria

- [ ] **Repost Endpoint:** Creates a new post with `isRepost = true` and `repostOfId` linked to the original.
- [ ] **Trainer-Only Source:** Attempting to repost a non-trainer post returns `403 Forbidden`.
- [ ] **Attribution:** Feed serialization includes original trainer name, avatar, and post link.
- [ ] **No Original Edit:** Editing endpoints reject changes to the referenced original content.
- [ ] **Caption Limit:** `repostCaption` enforces the same max length as regular post body.

---

## Dependencies

* US-I1 — Create Posts
* `Trainer` model
* Community `Post` model

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
