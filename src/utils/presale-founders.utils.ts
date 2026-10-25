import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Answers, ApplicationResult, LeadRoute, Summary } from "../validators/presale-founders.validator";
import { reasonOptions, summarySchema, intentionOptions } from "../validators/presale-founders.validator";

export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
};
export const hashApplicationPayload = (value: unknown): string => createHash("sha256").update(stableStringify(value)).digest("hex");
export const hashContact = (email: string, phone: string): string => createHash("sha256").update(`${email.trim().toLowerCase()}|${phone.replace(/\D/g, "")}`).digest("hex");

export function qualifyApplication(answers: Answers): { route: LeadRoute; fitScore: number; direction: string } {
  const locationWorks = ["Kompally / nearby", "Hyderabad — happy to travel"].includes(answers.location);
  const timeProtected = ["2 sessions", "3 sessions", "4+ sessions", "Help me find a rhythm"].includes(answers.sessions);
  const readyTimeline = answers.timeline !== "Exploring for now";
  const preparedToExplore = answers.investment !== "Not ready to invest yet";
  const fitScore = Math.min(100, 40 + (locationWorks ? 20 : 0) + (timeProtected ? 20 : 0) + (readyTimeline ? 15 : 0) + (answers.goals.length ? 5 : 0));
  const route: LeadRoute = answers.nextStep === "Keep my brief and explore" ? "explore" : answers.nextStep === "Speak with the founder" && locationWorks && timeProtected && readyTimeline && preparedToExplore ? "founder" : "concierge";
  const direction: Record<Answers["goals"][number], string> = { "Strength & body composition": "a progressive strength and body-composition conversation", "A consistent training routine": "a simple, repeatable training rhythm", "Daily energy & performance": "an energy and performance routine that fits real weeks", "Mobility & movement quality": "movement quality and sustainable strength foundations", "Sleep, stress & recovery habits": "a recovery-aware routine with practical consistency cues", "An event, trip or sport": "a time-bound preparation plan with measured training steps" };
  const primaryGoal = answers.goals[0] ?? "A consistent training routine";
  return { route, fitScore, direction: direction[primaryGoal] };
}

export function buildStructuredSummary(answers: Answers): Summary {
  const qualification = qualifyApplication(answers);
  const locationLine = answers.location === "Outside Hyderabad" ? "Distance is part of the decision, so begin with a practical remote-or-visit conversation." : `Your stated location preference is ${answers.location.toLowerCase()}, which can be explored alongside your schedule.`;
  const selectedPurpose = (reasonOptions as readonly string[]).includes(answers.motivation) ? `Your stated purpose is ${answers.motivation.toLowerCase()}. ` : "";
  const decisionContext = answers.buyingPriority ? `You value ${answers.buyingPriority.toLowerCase()} and want clarity on ${answers.hesitation?.toLowerCase() || "the available options"}. ` : "";
  return summarySchema.parse({
    title: `Your ${(answers.goals[0] ?? "training").toLowerCase()} brief`,
    reflection: `You are looking for ${qualification.direction}. ${selectedPurpose}${decisionContext}Your main practical friction is ${answers.barrier.toLowerCase()}. This is a planning brief, not a diagnosis or medical recommendation.`,
    rhythm: `A useful starting rhythm is ${answers.sessions.toLowerCase()}, with ${answers.windows.join(" or ").toLowerCase()} as preferred windows. ${locationLine}`,
    focus: [answers.goals[0] ?? "Training", answers.buyingPriority || answers.barrier, answers.support],
    actions: ["Look at a recent ordinary week and identify the windows you could realistically protect.", "Recall one small habit that already works for you, without judging your starting point.", answers.hesitation ? `Bring your question about ${answers.hesitation.toLowerCase()} to the call.` : "Note what you want clarified about route, inclusions and next steps."],
    agenda: [`Clarify a realistic ${answers.sessions.toLowerCase()} routine and how it fits your schedule.`, answers.buyingPriority ? `Explore ${answers.buyingPriority.toLowerCase()} with the actual coaching process and inclusions.` : `Discuss how ${answers.support.toLowerCase()} could support your stated goal.`, answers.hesitation ? `Clarify ${answers.hesitation.toLowerCase()} before discussing any commitment.` : "Review options, inclusions and a sensible first commitment without pressure."],
    narration: `Your next conversation can stay practical: start with your goal, explain the routine barrier you named, and explore a weekly rhythm that feels repeatable. ${decisionContext}The team can then explain the available route and inclusions clearly. Your pace and any skipped intention are respected. Nothing in this brief is a medical assessment or a promise of genetic or DNA-based outcomes.`,
    approach: qualification.direction,
  });
}

const encryptionKey = (): Buffer => { const secret = process.env.JWT_SECRET?.trim(); if (!secret) throw new Error("JWT_SECRET is required for presales token encryption"); return createHash("sha256").update(secret).digest(); };
export function encryptPrivateToken(token: string): { iv: string; tag: string; ciphertext: string } { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv); const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]); return { iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url") }; }
export function decryptPrivateToken(value: { iv: string; tag: string; ciphertext: string }): string { const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(value.iv, "base64url")); decipher.setAuthTag(Buffer.from(value.tag, "base64url")); return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64url")), decipher.final()]).toString("utf8"); }
export const hashPrivateToken = (token: string): string => createHash("sha256").update(token).digest("hex");
export const newPrivateToken = (): string => randomBytes(32).toString("base64url");

export function asApplicationResult(doc: { id: string; name: string; route: LeadRoute; fitScore: number; summary: Summary; answers: Answers; bookingStatus: string }, token: string): ApplicationResult { return { id: doc.id, token, name: doc.name, route: doc.route, fitScore: doc.fitScore, summary: doc.summary, summaryMode: "structured", answers: doc.answers, bookingStatus: doc.bookingStatus }; }
