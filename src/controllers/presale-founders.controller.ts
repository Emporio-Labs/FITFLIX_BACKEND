import { randomUUID, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { z } from "zod";
import { PresaleApplication, PresaleCallRequest, PresaleCallSlot, PresaleSettings } from "../models/PresaleFounders";
import { applicationSchema, defaultSettings, memberCapacity, type CampaignSettings, type LeadRoute } from "../validators/presale-founders.validator";
import { publicFounderSlot, canRequestCallWindow } from "../utils/presale-founders.booking-policy";
import { asApplicationResult, buildStructuredSummary, decryptPrivateToken, encryptPrivateToken, hashApplicationPayload, hashContact, hashPrivateToken, qualifyApplication, newPrivateToken } from "../utils/presale-founders.utils";

const noStore = (_req: any, res: any, next: any) => { res.setHeader("Cache-Control", "no-store"); next(); };
const validationError = (res: any, error: z.ZodError) => res.status(400).json({ error: "Validation failed", code: "VALIDATION_ERROR", details: Object.fromEntries(error.issues.map((issue) => [issue.path.map(String).join(".") || "body", issue.message])) });
const conflict = (res: any, message: string) => res.status(409).json({ error: message, code: "CONFLICT" });
const envBool = (value: string | undefined, fallback: boolean) => value === undefined ? fallback : value.toLowerCase() === "true";
const envNullable = (value: string | undefined) => value?.trim() || null;
const envDeadline = () => { const raw = process.env.PRESALE_CAMPAIGN_DEADLINE?.trim(); return raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw) : null; };
const settingsFromEnv = (): CampaignSettings => ({ confirmedMembers: process.env.PRESALE_CONFIRMED_MEMBERS ? Math.max(0, Math.min(memberCapacity, Number(process.env.PRESALE_CONFIRMED_MEMBERS) || 0)) : defaultSettings.confirmedMembers, deadline: envDeadline()?.toISOString() ?? defaultSettings.deadline, bookingUrl: envNullable(process.env.PRESALE_BOOKING_URL), founderName: process.env.PRESALE_FOUNDER_NAME?.trim() || defaultSettings.founderName, applicationOpen: envBool(process.env.PRESALE_APPLICATION_OPEN, defaultSettings.applicationOpen), presaleNote: process.env.PRESALE_NOTE ?? defaultSettings.presaleNote, metaPixelId: envNullable(process.env.PRESALE_META_PIXEL_ID), publicOrigin: envNullable(process.env.PRESALE_PUBLIC_ORIGIN) });
const loadSettings = async () => { const doc = await PresaleSettings.findById("founders-club").lean(); const fallback = settingsFromEnv(); const configuredCount = doc?.confirmedMembers ?? fallback.confirmedMembers; const actualCount = configuredCount === null ? await PresaleApplication.countDocuments({ status: "confirmed" }) : configuredCount; return { confirmedMembers: actualCount > 0 ? actualCount : configuredCount, deadline: doc?.deadline?.toISOString() ?? fallback.deadline, bookingUrl: doc?.bookingUrl ?? fallback.bookingUrl, founderName: doc?.founderName ?? fallback.founderName, applicationOpen: doc?.applicationOpen ?? fallback.applicationOpen, presaleNote: doc?.presaleNote ?? fallback.presaleNote, metaPixelId: doc?.metaPixelId ?? fallback.metaPixelId, publicOrigin: doc?.publicOrigin ?? fallback.publicOrigin }; };
const isCampaignOpen = (settings: CampaignSettings) => settings.applicationOpen && (!settings.deadline || new Date(settings.deadline).getTime() > Date.now());
const capCheck = async (settings: CampaignSettings) => { const confirmed = settings.confirmedMembers ?? await PresaleApplication.countDocuments({ status: "confirmed" }); return confirmed >= memberCapacity; };
const asRecord = (value: unknown) => value as Record<string, any>;
const safeTokenMatch = (provided: string, stored: string) => { const a = Buffer.from(hashPrivateToken(provided), "hex"); const b = Buffer.from(stored, "hex"); return a.length === b.length && timingSafeEqual(a, b); };
const privateBodySchema = z.object({ id: z.string().uuid(), token: z.string().min(20).max(200) });
const callRequestSchema = privateBodySchema.extend({ slotId: z.string().uuid().optional(), preferredWindow: z.string().trim().max(200).optional(), kind: z.enum(["call", "tour"]) });
const statusSchema = z.object({ status: z.enum(["new", "contacted", "qualified", "confirmed", "closed"]) });
const settingsPatchSchema = z.object({ confirmedMembers: z.number().int().min(0).max(memberCapacity).nullable().optional(), deadline: z.string().datetime({ offset: true }).nullable().optional(), bookingUrl: z.string().url().max(1000).nullable().optional(), founderName: z.string().trim().min(1).max(120).optional(), applicationOpen: z.boolean().optional(), presaleNote: z.string().max(1000).optional(), metaPixelId: z.string().max(200).nullable().optional(), publicOrigin: z.string().url().max(500).nullable().optional() }).strict();
const slotCreateSchema = z.object({ startAt: z.coerce.date(), endAt: z.coerce.date(), capacity: z.literal(1).default(1) }).refine((v) => v.startAt > new Date() && v.endAt > v.startAt, { message: "Slot must be future-dated and end after start" });

const findPrivateApplication = async (id: string, token: string) => { const doc = await PresaleApplication.findById(id).lean(); if (!doc || !safeTokenMatch(token, doc.tokenHash)) return null; return doc; };
const resultFor = (doc: any) => asApplicationResult({ id: doc._id, name: doc.contact.name, route: doc.route as LeadRoute, fitScore: doc.fitScore, summary: doc.brief, answers: doc.answers, bookingStatus: doc.bookingStatus }, decryptPrivateToken(doc.encryptedToken));

export const getFounderSettings: RequestHandler = async (_req, res, next) => { try { const settings = await loadSettings(); res.setHeader("Cache-Control", "no-store"); res.json({ ...settings, bookingUrl: null }); } catch (error) { next(error); } };
export const getFounderSlots: RequestHandler = async (_req, res, next) => { try { const slots = await PresaleCallSlot.find({ status: "open", startAt: { $gt: new Date() } }).sort({ startAt: 1 }).lean(); res.setHeader("Cache-Control", "no-store"); res.json(slots.filter((slot) => slot.reservations.length < slot.capacity).map(publicFounderSlot)); } catch (error) { next(error); } };

export const submitFounderApplication: RequestHandler = async (req, res, next) => {
  const parsed = applicationSchema.safeParse(req.body);
  if (!parsed.success) { validationError(res, parsed.error); return; }
  try {
    const settings = await loadSettings();
    if (!isCampaignOpen(settings)) { res.status(409).json({ error: "Founders Club applications are closed", code: "CAMPAIGN_CLOSED" }); return; }
    if (await capCheck(settings)) { res.status(409).json({ error: "Founders Club capacity has been reached", code: "CAPACITY_REACHED" }); return; }
    const input = parsed.data;
    const payloadHash = hashApplicationPayload(input);
    const existing = await PresaleApplication.findOne({ requestId: input.requestId }).lean();
    if (existing) { if (existing.payloadHash !== payloadHash) { conflict(res, "requestId is already bound to a different payload"); return; } res.status(200).json(resultFor(existing)); return; }
    const token = newPrivateToken();
    const qualification = qualifyApplication(input.answers);
    const doc = { _id: randomUUID(), requestId: input.requestId, payloadHash, tokenHash: hashPrivateToken(token), encryptedToken: encryptPrivateToken(token), answers: input.answers, contact: input.contact, consents: { adultConsent: input.contact.adultConsent, serviceConsent: input.contact.serviceConsent, marketingConsent: input.contact.marketingConsent }, attribution: input.attribution, route: qualification.route, readinessRoute: qualification.route, fitScore: qualification.fitScore, brief: buildStructuredSummary(input.answers), summaryMode: "structured", status: "new", bookingStatus: qualification.route === "founder" ? "available" : "not_applicable", createdAt: new Date(), updatedAt: new Date() };
    try { await PresaleApplication.create(doc as any); } catch (error: any) { if (error?.code !== 11000) throw error; const raced = await PresaleApplication.findOne({ requestId: input.requestId }).lean(); if (!raced || raced.payloadHash !== payloadHash) { conflict(res, "requestId is already bound to a different payload"); return; } res.status(200).json(resultFor(raced)); return; }
    res.status(201).json(asApplicationResult({ id: doc._id, name: input.contact.name, route: doc.route, fitScore: doc.fitScore, summary: doc.brief, answers: doc.answers, bookingStatus: doc.bookingStatus }, token));
  } catch (error) { next(error); }
};

export const getPrivateFounderLead: RequestHandler = async (req, res, next) => { const parsed = privateBodySchema.safeParse(req.body); if (!parsed.success) { validationError(res, parsed.error); return; } try { const doc = await findPrivateApplication(parsed.data.id, parsed.data.token); if (!doc) { res.status(404).json({ error: "Application not found", code: "NOT_FOUND" }); return; } res.json(resultFor(doc)); } catch (error) { next(error); } };
export const getPrivateBookingConfig: RequestHandler = async (req, res, next) => { const parsed = privateBodySchema.safeParse(req.body); if (!parsed.success) { validationError(res, parsed.error); return; } try { const doc = await findPrivateApplication(parsed.data.id, parsed.data.token); if (!doc) { res.status(404).json({ error: "Application not found", code: "NOT_FOUND" }); return; } const settings = await loadSettings(); res.json({ bookingUrl: doc.route === "founder" ? settings.bookingUrl : null }); } catch (error) { next(error); } };

export const requestFounderCall: RequestHandler = async (req, res, next) => {
  const parsed = callRequestSchema.safeParse(req.body); if (!parsed.success) { validationError(res, parsed.error); return; }
  try {
    const doc = await findPrivateApplication(parsed.data.id, parsed.data.token);
    if (!doc) { res.status(404).json({ error: "Application not found", code: "NOT_FOUND" }); return; }
    if (!canRequestCallWindow(doc.route as LeadRoute, parsed.data.slotId)) { res.status(403).json({ error: "Published founder windows are available for founder-route applications. Please request a team follow-up without a slot.", code: "FORBIDDEN" }); return; }
    const existing = await PresaleCallRequest.findOne({ applicationId: doc._id, kind: parsed.data.kind }).lean(); if (existing) { res.json({ status: "requested", message: "Your request is already with the team." }); return; }
    let reserved = false;
    if (parsed.data.slotId) {
      const slot = await PresaleCallSlot.findOneAndUpdate({ _id: parsed.data.slotId, status: "open", startAt: { $gt: new Date() }, $expr: { $lt: [{ $size: "$reservations" }, "$capacity"] }, "reservations.applicationId": { $ne: doc._id } }, { $push: { reservations: { applicationId: doc._id, reservedAt: new Date() } }, $set: { updatedAt: new Date() } }, { new: true }).lean();
      if (!slot) { res.status(409).json({ error: "That slot is unavailable", code: "SLOT_UNAVAILABLE" }); return; }
      reserved = true;
    }
    try { await PresaleCallRequest.create({ _id: randomUUID(), applicationId: doc._id, slotId: parsed.data.slotId ?? null, preferredWindow: parsed.data.preferredWindow ?? null, kind: parsed.data.kind, status: "requested" }); } catch (error: any) { if (reserved) await PresaleCallSlot.updateOne({ _id: parsed.data.slotId }, { $pull: { reservations: { applicationId: doc._id } } }); if (error?.code === 11000) { res.json({ status: "requested", message: "Your request is already with the team." }); return; } throw error; }
    await PresaleApplication.updateOne({ _id: doc._id }, { $set: { bookingStatus: "requested", updatedAt: new Date() } });
    res.json({ status: "requested", message: "Your request is with the team. We will confirm the next step directly." });
  } catch (error) { next(error); }
};

export const adminListFounderLeads: RequestHandler = async (req, res, next) => { try { const limit = Math.min(Number(req.query.limit) || 50, 100); const leads = await PresaleApplication.find({}).sort({ createdAt: -1 }).limit(limit).select("_id requestId contact answers route fitScore brief status bookingStatus attribution createdAt updatedAt").lean(); res.json(leads.map((lead) => ({ id: lead._id, requestId: lead.requestId, contact: lead.contact, answers: lead.answers, route: lead.route, fitScore: lead.fitScore, summary: lead.brief, status: lead.status, bookingStatus: lead.bookingStatus, attribution: lead.attribution, createdAt: lead.createdAt, updatedAt: lead.updatedAt }))); } catch (error) { next(error); } };
export const adminUpdateFounderLeadStatus: RequestHandler = async (req, res, next) => { const parsed = statusSchema.safeParse(req.body); if (!parsed.success || typeof req.params.id !== "string") { if (!parsed.success) validationError(res, parsed.error); else res.status(400).json({ error: "Invalid id", code: "VALIDATION_ERROR" }); return; } try { const current = await PresaleApplication.findById(req.params.id).lean(); if (!current) { res.status(404).json({ error: "Application not found", code: "NOT_FOUND" }); return; } if (parsed.data.status === "confirmed" && current.status !== "confirmed" && await capCheck(await loadSettings())) { res.status(409).json({ error: "Founders Club capacity has been reached", code: "CAPACITY_REACHED" }); return; } const updated = await PresaleApplication.findOneAndUpdate({ _id: req.params.id }, { $set: { status: parsed.data.status, updatedAt: new Date() } }, { new: true }).lean(); res.json({ id: updated?._id, status: updated?.status }); } catch (error) { next(error); } };
export const adminGetFounderSettings: RequestHandler = async (_req, res, next) => { try { res.json(await loadSettings()); } catch (error) { next(error); } };
export const adminPatchFounderSettings: RequestHandler = async (req, res, next) => { const parsed = settingsPatchSchema.safeParse(req.body); if (!parsed.success) { validationError(res, parsed.error); return; } try { const updated = await PresaleSettings.findOneAndUpdate({ _id: "founders-club" }, { $set: { ...parsed.data, deadline: parsed.data.deadline === undefined ? undefined : parsed.data.deadline ? new Date(parsed.data.deadline) : null, updatedAt: new Date() } }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean(); res.json({ confirmedMembers: updated?.confirmedMembers ?? null, deadline: updated?.deadline?.toISOString() ?? null, bookingUrl: updated?.bookingUrl ?? null, founderName: updated?.founderName, applicationOpen: updated?.applicationOpen, presaleNote: updated?.presaleNote, metaPixelId: updated?.metaPixelId ?? null, publicOrigin: updated?.publicOrigin ?? null }); } catch (error) { next(error); } };
export const adminCreateFounderSlot: RequestHandler = async (req, res, next) => { const parsed = slotCreateSchema.safeParse(req.body); if (!parsed.success) { validationError(res, parsed.error); return; } try { const slot = await PresaleCallSlot.create({ _id: randomUUID(), startAt: parsed.data.startAt, endAt: parsed.data.endAt, capacity: 1, reservations: [], status: "open", createdBy: req.user?.id ?? "admin", createdAt: new Date(), updatedAt: new Date() }); res.status(201).json({ id: slot._id, startAt: slot.startAt.toISOString(), endAt: slot.endAt.toISOString(), status: slot.status }); } catch (error) { next(error); } };
export const adminCloseFounderSlot: RequestHandler = async (req, res, next) => { if (typeof req.params.id !== "string") { res.status(400).json({ error: "Invalid id", code: "VALIDATION_ERROR" }); return; } try { const slot = await PresaleCallSlot.findOneAndUpdate({ _id: req.params.id }, { $set: { status: "closed", updatedAt: new Date() } }, { new: true }).lean(); if (!slot) { res.status(404).json({ error: "Slot not found", code: "NOT_FOUND" }); return; } res.json({ id: slot._id, status: slot.status }); } catch (error) { next(error); } };

export { noStore };
