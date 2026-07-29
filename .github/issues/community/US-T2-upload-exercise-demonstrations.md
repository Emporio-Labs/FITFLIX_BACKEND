# 🚀 US-T2 - Upload Exercise Demonstrations (Trainer)

**Type:** Backend Community Feature

## Objective

Implement REST endpoints and persistence for trainers to upload exercise demonstration videos with structured metadata (muscle groups, difficulty, precautions, reps).

---

## Business Goal

* Provide a canonical, professional exercise video library for members.
* Reduce injury risk by attaching safety precautions to each demo.
* Feed the workout planning module with structured exercise metadata.

---

## User Story

**As a** trainer

**I want** to upload exercise demonstration videos

**So that** members can perform exercises correctly.

---

## Scope

### Included

* **Endpoint:**
  - `POST /api/v1/community/trainer/exercise-demos` — creates a demo linked to an `Exercise` record.
* **Schema Fields:** `exerciseId` (ref `Exercise`), `videoUrl`, `hdVariants[]`, `description`, `muscleGroup` (`MuscleGroup` enum), `difficulty` (`ExerciseDifficulty` enum), `precautions`, `recommendedReps`, `authorId`.
* **HD Support:** Store multiple quality variants (e.g., 720p, 1080p).
* **Cross-Linking:** Update the referenced `Exercise` with the latest demo video URL.

### Excluded

* Video transcoding pipeline (assume external service).
* Live streaming.

---

## Acceptance Criteria

- [ ] **Trainer-Only Guard:** Enforced via `authorize(["trainer"])`.
- [ ] **Exercise Link:** Rejects if `exerciseId` doesn't exist.
- [ ] **Metadata:** Requires `muscleGroup`, `difficulty`, `precautions`, `recommendedReps`.
- [ ] **HD Variants:** Accepts optional array of variant URLs.
- [ ] **Exercise Update:** The referenced `Exercise` document is updated with the latest video reference.

---

## Dependencies

* `Exercise` model (`src/models/Exercise.ts`)
* Auth middleware + trainer role
* Media upload service

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
