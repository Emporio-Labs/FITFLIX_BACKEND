# Release checklist — FITFLIX backend

Run before promoting a build to production. Tick every required gate; a failing gate blocks the
release. Run data-affecting checks against a **copy of production** (a restored snapshot / staging
replica set), never production itself.

## Required gates

- [ ] `npx tsc --noEmit` passes (no new type errors vs. the known pre-existing ones).
- [ ] Group-class regression suite green: `bun run test:class-all`.
- [ ] **FX-03 — no double bookings under concurrency.** Run `bun run test:fx-03` against a
      copy-of-production **replica set**; all assertions green (exactly 10/40 for the class,
      1/49 for the PT slot, credits charged exactly once, none on refusal).
      Runbook: [FX-03-no-double-booking.md](./FX-03-no-double-booking.md). *(US-QA-04 / N8)*
      - [ ] First run on a fresh database: `bun run migrate:slot-index` reports the corrected
            `{ slotHold: true }` unique index is present.
- [ ] **FX-21 — cross-branch access blocked.** Run `bun run test:fx-21` against a
      copy-of-production database; all assertions green. The suite stands up two
      fully-seeded branches and proves a branch-scoped staff account gets
      `NOT_YOUR_BRANCH` or nothing for the other branch's data in every staff list
      and record page, and that forged / invalid / deactivated branch ids and a
      pre-FX-16 sign-in are all refused. **A second branch may not be opened until
      this gate is green.** Needs only a running MongoDB (no replica set — it does
      no multi-document transactions). It seeds and cleans up its own fixtures and
      toggles `STAFF_RBAC_ENFORCE` internally, so it is safe to run with the flag
      off in the environment. Runbook:
      [FX-21-cross-branch-isolation.md](./FX-21-cross-branch-isolation.md). *(US-QA-01 / S10)*
- [ ] Personal-training engine regression green: `bun run tests/personal-training-unified-engine.test.ts`.
- [ ] Expert concurrent-booking check green: `bun run test:feature-016`.

## Notes

- Sustained / multi-process load testing is tracked separately as **FX-26 (Release 2)**; FX-03
  covers data-layer correctness under a simultaneous burst, not throughput.
- The FX-03 test creates and deletes its own fixtures and must run on a replica set so transaction
  rollback (and therefore the "no charge on refusal" guarantee) is real.
