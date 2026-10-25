import assert from "node:assert/strict";
import { test } from "node:test";
import { applicationSchema, type ApplicationInput } from "../src/validators/presale-founders.validator.ts";
import { buildStructuredSummary, decryptPrivateToken, encryptPrivateToken, hashApplicationPayload, qualifyApplication } from "../src/utils/presale-founders.utils.ts";

const validApplication = (): ApplicationInput => ({
  requestId: "2a1f4b4d-7f34-4d4d-8e1f-2c8f95aa2b12",
  answers: {
    goals: ["A consistent training routine"], motivation: "More present with my family", buyingPriority: "Expert guidance I can trust", hesitation: "Finding time consistently", location: "Kompally / nearby", routine: "Once a week", barrier: "A demanding schedule", support: "One-to-one coaching", sessions: "2 sessions", windows: ["Evening"], timeline: "Within a month of opening", investment: "Club — ₹1,00,000 / year", decision: "I decide independently", pledge: "Begin small and build consistently", nextStep: "Speak with the founder",
  },
  contact: { name: "Test Founder", email: "test@example.com", phone: "+919876543210", channel: "WhatsApp", adultConsent: true, serviceConsent: true, marketingConsent: false },
  attribution: { source: "test" }, website: "",
});

test("accepts the exact 16-choice-field application contract", () => {
  const parsed = applicationSchema.parse(validApplication());
  assert.equal(parsed.contact.adultConsent, true);
  assert.equal(parsed.answers.goals.length, 1);
  assert.equal(Object.keys(parsed.answers).length, 15);
});

test("rejects non-empty honeypot and missing mandatory consent", () => {
  const input = validApplication();
  assert.equal(applicationSchema.safeParse({ ...input, website: "bot" }).success, false);
  assert.equal(applicationSchema.safeParse({ ...input, contact: { ...input.contact, adultConsent: false } }).success, false);
  assert.equal(applicationSchema.safeParse({ ...input, contact: { ...input.contact, serviceConsent: false } }).success, false);
});

test("uses shared qualification semantics and structured summary only", () => {
  const input = validApplication();
  const qualification = qualifyApplication(input.answers);
  assert.equal(qualification.route, "founder");
  assert.equal(qualification.fitScore, 100);
  const summary = buildStructuredSummary(input.answers);
  assert.equal(summary.actions.length, 3);
  assert.equal(summary.agenda.length, 3);
  assert.match(summary.narration, /practical/);
});

test("encrypts and recovers the private token with JWT_SECRET-derived AES-GCM", () => {
  process.env.JWT_SECRET = "pure-test-secret";
  const encrypted = encryptPrivateToken("private-token-value");
  assert.notEqual(encrypted.ciphertext, "private-token-value");
  assert.equal(decryptPrivateToken(encrypted), "private-token-value");
});

test("binds an idempotency request to a stable payload hash", () => {
  const input = validApplication();
  assert.equal(hashApplicationPayload(input), hashApplicationPayload(JSON.parse(JSON.stringify(input))));
  assert.notEqual(hashApplicationPayload(input), hashApplicationPayload({ ...input, website: "" , requestId: "7f5a4b6d-cf97-4d2d-b589-981d1b32c4d8" }));
});

import { publicFounderSlot, canRequestCallWindow } from "../src/utils/presale-founders.booking-policy.ts";

test("publishes the exact id/startAt/endAt slot fields consumed by the website", () => {
  const id = "2a1f4b4d-7f34-4d4d-8e1f-2c8f95aa2b12";
  const slot = publicFounderSlot({ _id: id, startAt: new Date("2030-01-01T08:00:00Z"), endAt: new Date("2030-01-01T08:30:00Z") });
  assert.deepEqual(slot, { id, startAt: "2030-01-01T08:00:00.000Z", endAt: "2030-01-01T08:30:00.000Z" });
});

test("permits pending team follow-ups but keeps published founder slots qualified", () => {
  assert.equal(canRequestCallWindow("concierge"), true);
  assert.equal(canRequestCallWindow("explore"), true);
  assert.equal(canRequestCallWindow("founder", "published-slot"), true);
  assert.equal(canRequestCallWindow("concierge", "published-slot"), false);
  assert.equal(canRequestCallWindow("explore", "published-slot"), false);
});
