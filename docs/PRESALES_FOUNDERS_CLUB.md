# Kompally Founders Club presales integration

This branch adds the isolated backend integration for the FITFLIX_SAINIKPURI website questionnaire. It is not live by itself and does not start `index.ts`, connect to production MongoDB, seed slots, or submit test leads.

## Endpoints

The public surface is mounted before the strict `/api/v1` routers:

- `GET /presales/founders/settings` — public campaign settings; `bookingUrl` is withheld as `null`.
- `GET /presales/founders/slots` — future owner-created slots only; returns `[]` until an admin creates real slots.
- `POST /presales/founders/submit` — validates the shared current questionnaire contract, stores an application, and returns the private `ApplicationResult`.
- `POST /presales/founders/lead` — retrieves a private application using `{ id, token }` in the body only.
- `POST /presales/founders/booking-config` — returns a booking URL only for an authenticated private founder-route application.
- `POST /presales/founders/request-call` — records a pending call/tour request and optionally atomically reserves a real slot.

Admin-only routes are under `/presales/founders/admin`: lead review, status updates, settings read/update, future slot creation, and slot closing. They require the existing JWT middleware and `admin` role. No public lead-listing route exists.

## Environment

Use the existing backend variables `MONGODB_URL` and `JWT_SECRET`. The private token is a random 256-bit bearer secret returned once in the result and stored as a SHA-256 lookup hash plus AES-256-GCM ciphertext. The encryption key is SHA-256-derived from `JWT_SECRET`; do not copy provider keys or credentials into this repository.

Optional campaign fallback settings are:

```dotenv
PRESALE_APPLICATION_OPEN=true
PRESALE_FOUNDER_NAME=FitFlix Founder
PRESALE_NOTE=
PRESALE_META_PIXEL_ID=
PRESALE_PUBLIC_ORIGIN=https://www.fitflix.in
PRESALE_BOOKING_URL=
# Leave the following unset unless FitFlix has verified the values:
# PRESALE_CONFIRMED_MEMBERS=<actual confirmed membership count, 0–100>
# PRESALE_CAMPAIGN_DEADLINE=<approved future ISO timestamp>
```

The default is the current open Founders Club campaign, with `confirmedMembers: null`, `deadline: null`, `bookingUrl: null` publicly, and a 100-member confirmed cap. A database settings document overrides environment fallbacks after an admin saves settings. Keep `PRESALE_BOOKING_URL` unset until the real booking route is configured; public settings never expose it.

If the website is served through the main-site proxy, no browser CORS change is needed. For direct browser calls, add the website origin to the existing `CORS_ALLOWED_ORIGINS` allowlist; do not broaden global CORS for this feature.

## Storage and safety behavior

The dedicated collections are `PresaleFoundersApplication`, `PresaleFoundersSettings`, `PresaleFoundersCallSlot`, and `PresaleFoundersCallRequest`. Application `_id`, slot `_id`, and request `_id` are UUID strings, not MongoDB ObjectIds. Applications store all answers, contact, consent, attribution, route, fit score, structured brief, timestamps, request UUID, and payload hash. Tokens are not stored in plaintext.

The submit route requires all current choice enums, true `adultConsent` and `serviceConsent`, and an empty honeypot. A repeated request UUID with the same hash is idempotent and recovers the original encrypted token; a changed payload receives `409`. Public responses are `no-store`. Submission throttling is keyed by a hash of normalized email and phone, rather than a five-person shared-proxy bucket. The scoped JSON body check is 256 KB.

Slots are never invented. Admin-created future slots are one-person slots, and a request uses an atomic reservation predicate to prevent double booking and concurrent multi-window claims. Without configured slots, `GET /slots` returns `[]`; an unknown supplied slot UUID is rejected.

## Validation and test commands

Install from the repository package metadata without lifecycle scripts when dependencies are absent:

```bash
npm install --ignore-scripts --no-audit --no-fund --package-lock=false
```

Pure/mock-only tests do not require MongoDB, production credentials, or `index.ts`:

```bash
npx tsx --test tests/presale-founders.test.ts
```

The repository-wide compiler includes known pre-existing diagnostics documented in `AGENTS.md`. For this branch, filter `npx tsc --noEmit --pretty false` for `src/controllers/presale-founders`, `src/models/PresaleFounders`, `src/presales`, `src/routes/presale-founders`, and `src/app.ts`; the new integration should have zero diagnostics. Do not run existing end-to-end suites because they write against configured databases.

## Deployment checklist

1. Review the branch diff and confirm the website adapter maps the exact public methods and `ApplicationResult` shape.
2. Set `MONGODB_URL` and `JWT_SECRET` in the deployment secret store; never commit them.
3. Leave `PRESALE_BOOKING_URL` unset or set it only to the verified real booking route.
4. Add the website origin to `CORS_ALLOWED_ORIGINS` only if the website is not using its serverless proxy.
5. Deploy the feature branch through the normal review process; review and merge this feature branch before deploying; no production migration, test lead, or seeded slot was created during implementation.
6. After deployment, an authorized admin may create actual future slots and update settings; no test submission should be made against production.

Public slot records use `{ id, startAt, endAt }`, with ISO timestamps. Any applicant may voluntarily request a pending team follow-up without a slot; published founder windows remain restricted to founder-route applications. A pending request never creates or confirms a Google Meet invitation.
