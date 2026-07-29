# 🚀 US-O5 - Apply for Membership (Outsider)

**Type:** Backend Community Feature

## Objective

Implement the REST endpoints, database schema, and notification hooks to allow outsiders to submit a membership application, upload identification documents, and track status.

---

## Business Goal

* Provide a self-serve pipeline for outsiders to become members.
* Capture applicant data and documents needed for admin review (see US-A5).
* Notify applicants automatically as their application progresses.

---

## User Story

**As an** outsider

**I want** to apply for gym membership

**So that** I can access exclusive community features.

---

## Scope

### Included

* **Database Schema:** A `membershipApplications` collection with fields: applicant name, email, phone, selected plan, uploaded document URLs, status (`PENDING`/`APPROVED`/`REJECTED`), submittedAt, reviewedAt, reviewerId.
* **Endpoints:**
  - `POST /api/v1/community/public/membership-applications` — submit application (multipart for document uploads).
  - `GET /api/v1/community/public/membership-applications/{id}` — status lookup by application ID + email.
  - `GET /api/v1/admin/membership-applications` — admin listing (auth required, see US-A5).
* **Plan Selection:** Applications reference an active `MembershipPlan` (existing model).
* **Confirmation Notification:** Send email confirming submission and later notifying approval/rejection.

### Excluded

* Payment collection (handled post-approval).
* Automatic KYC verification.

---

## Acceptance Criteria

- [ ] **Submission:** `POST` accepts multipart form data with required fields and at least one ID document, returning a tracking ID.
- [ ] **Validation:** Missing required fields or unsupported document types return `400 Bad Request`.
- [ ] **Status Lookup:** `GET /{id}` requires the applicant's email as a verification param.
- [ ] **Notifications:** Applicant receives an email on submission, approval, and rejection.
- [ ] **Admin Handoff:** New applications appear immediately in the admin listing (US-A5).

---

## Dependencies

* Existing `MembershipPlan` model
* Existing `Lead` model (for CRM handoff)
* Email service (`src/utils/email.service.ts`)
* File upload storage (S3 or equivalent)

---

## Linked Documents

* SPEC-002 API Contracts
* SPEC-004 Repository Breakdown
* SPEC-005 QA Plan
