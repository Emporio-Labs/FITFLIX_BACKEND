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
- [ ] Personal-training engine regression green: `bun run tests/personal-training-unified-engine.test.ts`.
- [ ] Expert concurrent-booking check green: `bun run test:feature-016`.

## Notes

- Sustained / multi-process load testing is tracked separately as **FX-26 (Release 2)**; FX-03
  covers data-layer correctness under a simultaneous burst, not throughput.
- The FX-03 test creates and deletes its own fixtures and must run on a replica set so transaction
  rollback (and therefore the "no charge on refusal" guarantee) is real.
