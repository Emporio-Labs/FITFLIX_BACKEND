# FX-03 — No double bookings when many book at once (runbook)

**Story:** US-QA-04 · **Work-plan:** N8 (race part) · **Release gate:** yes (see
[RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md))

Proves that a booking we tell a member succeeded really has a seat behind it, even when many
people book the same class or slot at the same instant — and that credits are charged exactly
once per confirmed booking and never on a refused one.

| Criterion | What it asserts |
|---|---|
| FX-03.1 | 50 simultaneous bookings for a **10-seat class** → exactly **10 confirmed**, **40 "class full"** |
| FX-03.2 | 50 simultaneous bookings for **one PT slot** → exactly **1 confirmed** |
| FX-03.3 | Every **confirmed** booking takes credits **once**; every **refused** booking takes **none** |
| FX-03.4 | Anyone can re-run this from these instructions; it is on the release checklist |

---

## Why a replica set (copy of production), never production

- The PT flow deducts the member's PT session and writes the credit-ledger row **before** it
  writes the booking. The structural double-booking guard (a partial **unique** index) makes all
  but one of 50 racing inserts fail; the loser's deduction must then roll back so a refused
  booking costs nothing. That rollback is a **MongoDB transaction**, which only works on a
  **replica set**. On a standalone mongod, `executeInTransaction`
  (`src/utils/transaction.util.ts`) runs with no session and cannot roll back — so FX-03.3 cannot
  be guaranteed there, and the test **refuses to run** against a standalone.
- Run it against a **copy of production** (a restored snapshot / staging replica set), **never
  production itself** — the test creates and deletes fixtures. Wider sustained-load testing is a
  separate story (FX-26, Release 2).

## 1. Start a replica set

If you have a staging / copy-of-prod replica set already, just point `MONGODB_URL` at it (step 2)
and skip this.

Otherwise spin up a disposable single-node replica set with Docker:

```bash
docker run -d --name fitflix-rs -p 27017:27017 mongo:7 --replSet rs0
# wait a couple of seconds for mongod to accept connections, then initiate:
docker exec fitflix-rs mongosh --quiet --eval 'rs.initiate()'
# confirm it reached PRIMARY:
docker exec fitflix-rs mongosh --quiet --eval 'rs.status().myState'   # prints 1 when PRIMARY
```

(Optional) restore a production snapshot into it with `mongorestore` before the next step.

## 2. Point the backend at it

In `D:\FITFLIX_BACKEND\.env` (or your shell), set:

```
MONGODB_URL=mongodb://127.0.0.1:27017/fitflix?replicaSet=rs0
```

The `?replicaSet=rs0` is required — without it the driver connects in standalone mode and the test
will stop at the preflight check.

## 3. Reconcile the slot-guard index (once per database)

```bash
bun run migrate:slot-index
```

Expected tail:

```
✅ Corrected unique index present: expertId_1_bookingDate_1_startTime_1 pfe={"slotHold":true}
```

This backfills the `slotHold` flag and rebuilds the partial unique index that stops two people
taking the same PT slot. (The FX-03 test also rebuilds it in setup, so it is self-contained, but
running the migration makes the running server safe too.)

## 4. Run the test

```bash
bun run test:fx-03
```

### Expected output (abridged)

```
=== FX-03: No double bookings when many book at once ===
  MongoDB topology: ReplicaSetWithPrimary
  ✅ Connected to a replica set ...
--- Setup ---
  ✅ PT slot unique index is present and version-proof (pfe={"slotHold":true})
--- FX-03.1 / FX-03.3 (class) : 50 bookings for a 10-seat session ---
  confirmed=10 full(409)=40 other=0
  ✅ Exactly 10 bookings confirmed
  ✅ Exactly 40 refused with "class full" (409)
  ✅ Exactly 10 booking rows exist for the session (found 10)
  ✅ Session remainingCapacity is 0 ...
  ✅ Exactly 10 credit-consume transactions (found 10)
  ✅ The other 40 members kept their credit (no charge on refusal)
--- FX-03.2 / FX-03.3 (PT) : 50 bookings for one trainer slot ---
  confirmed=1 rejected=49 (slot-conflict=49)
  ✅ Exactly 1 PT booking confirmed
  ✅ Exactly 1 PT credit-consume transaction (found 1)
  ✅ The other 49 members' PT quota was rolled back (no charge on refusal)
✅ FX-03 PASSED — no overbooking, credits charged exactly once.
```

Exit code `0` = pass. The run is deterministic — re-run a few times and the numbers
(10/40, 1/49) must not change.

## How to read a failure

| Symptom | Meaning |
|---|---|
| Stops at `MongoDB topology: Single` | You are on a standalone. Add `?replicaSet=rs0` / point at a real replica set. |
| `PT slot unique index ... version-proof` fails | `syncIndexes` could not build the index — check the mongod log; the `slotHold` partial index is missing. |
| `confirmed` > 10 (class) or > 1 (PT) | **Overbooking** — the atomic guard regressed. Do not release. |
| PT `quota was rolled back` fails (losers at 0) | Refused bookings are being charged — transactions are not rolling back (standalone? transaction code regressed). |

## What it exercises

- Calls the booking **services directly** (`registerGroupClassBooking`,
  `createPersonalTrainingBooking`) under `Promise.all`, so the API rate-limiter does not reject the
  burst and the test hits the database-level guard directly.
- Class seat reservation: atomic `allocateSeatAtomic` (`src/services/capacity-engine.service.ts`).
- PT slot: partial unique index on `{ expertId, bookingDate, startTime }` filtered by `slotHold`
  (`src/models/UnifiedBooking.ts`), with the duplicate-key mapped to a clean `SlotConflictError`.

Test source: `tests/fx-03-no-double-booking.test.ts`.
