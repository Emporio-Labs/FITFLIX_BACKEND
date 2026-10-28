import type { RequestHandler } from "express";
import mongoose from "mongoose";
import z from "zod";
import { LeadStatus } from "../models/Enums";
import Lead from "../models/Lead";
import LeadActivity from "../models/LeadActivity";
import {
	LeadNotFoundError,
	logLeadActivity,
	recordLeadOutcome,
	resolveActor,
} from "../services/lead-activity.service";
import {
	COLD_AFTER_NO_ANSWERS,
	LEAD_OUTCOMES,
	LeadOutcomeError,
	LOST_REASONS,
	SUGGEST_LOST_AFTER_ATTEMPTS,
	SUGGEST_LOST_AFTER_DAYS,
} from "../utils/lead-outcomes";
import {
	buildLocationFilter,
	LocationError,
	mapLocationError,
} from "../utils/location.resolver";

const isoDate = z
	.string()
	.trim()
	.min(1)
	.refine((v) => !Number.isNaN(new Date(v).getTime()), "Invalid date")
	.transform((v) => new Date(v));

const activityBodySchema = z.object({
	type: z.enum(["call", "whatsapp", "visit", "note"]),
	outcome: z.string().trim().min(1).optional(),
	customLabel: z.string().trim().max(200).optional(),
	customStatus: z
		.enum([
			LeadStatus.New,
			LeadStatus.Contacted,
			LeadStatus.VisitBooked,
			LeadStatus.Qualified,
			LeadStatus.Lost,
		])
		.optional(),
	temperature: z.enum(["hot", "warm", "cold"]).optional(),
	note: z.string().trim().max(2000).optional(),
	nextFollowUpAt: isoDate.optional().nullable(),
	visitAt: isoDate.optional().nullable(),
	lostReason: z.string().trim().max(100).optional(),
	lostReasonText: z.string().trim().max(300).optional(),
});

const validId = (value: unknown): string | null =>
	typeof value === "string" && mongoose.Types.ObjectId.isValid(value) ? value : null;

/** GET /leads/outcomes — what the "Log outcome" dialog offers. */
export const getLeadOutcomes: RequestHandler = (_req, res) => {
	res.status(200).json({
		outcomes: LEAD_OUTCOMES,
		lostReasons: LOST_REASONS,
		rules: {
			coldAfterNoAnswers: COLD_AFTER_NO_ANSWERS,
			suggestLostAfterAttempts: SUGGEST_LOST_AFTER_ATTEMPTS,
			suggestLostAfterDays: SUGGEST_LOST_AFTER_DAYS,
		},
	});
};

/** GET /leads/:id/activities — the lead's timeline, newest first. */
export const getLeadActivities: RequestHandler = async (req, res, next) => {
	const id = validId(req.params.id);
	if (!id) {
		res.status(400).json({ message: "Invalid lead id" });
		return;
	}
	try {
		const items = await LeadActivity.find({ leadId: id })
			.sort({ createdAt: -1 })
			.limit(500);
		res.status(200).json({ items });
	} catch (error) {
		next(error);
	}
};

/**
 * POST /leads/:id/activities — log a note, or a call/WhatsApp/visit outcome.
 * Outcomes move the lead per lead-outcomes.ts.
 */
export const createLeadActivity: RequestHandler = async (req, res, next) => {
	const id = validId(req.params.id);
	if (!id) {
		res.status(400).json({ message: "Invalid lead id" });
		return;
	}
	const parsed = activityBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			message: "Invalid activity payload",
			errors: parsed.error.issues,
		});
		return;
	}
	const body = parsed.data;

	try {
		const actor = await resolveActor(req.user);

		if (body.type === "note") {
			if (!body.note) {
				res.status(400).json({ message: "Write the note first", code: "NOTE_REQUIRED" });
				return;
			}
			const lead = await Lead.findById(id).select("locationId");
			if (!lead) {
				res.status(404).json({ message: "Lead not found" });
				return;
			}
			const activity = await logLeadActivity({
				leadId: id,
				locationId: lead.locationId,
				type: "note",
				label: "Note",
				note: body.note,
				actor,
			});
			res.status(201).json({ message: "Note added", activity, lead });
			return;
		}

		if (!body.outcome) {
			res.status(400).json({ message: "Pick what happened", code: "OUTCOME_REQUIRED" });
			return;
		}

		const result = await recordLeadOutcome(
			id,
			{
				channel: body.type,
				outcome: body.outcome,
				customLabel: body.customLabel,
				customStatus: body.customStatus,
				temperature: body.temperature,
				nextFollowUpAt: body.nextFollowUpAt ?? null,
				visitAt: body.visitAt ?? null,
				lostReason: body.lostReason,
				lostReasonText: body.lostReasonText,
				note: body.note,
			},
			actor,
		);
		res.status(201).json({ message: "Outcome logged", ...result });
	} catch (error) {
		if (error instanceof LeadNotFoundError) {
			res.status(404).json({ message: "Lead not found" });
			return;
		}
		if (error instanceof LeadOutcomeError) {
			res.status(400).json({ message: error.message, code: error.code });
			return;
		}
		next(error);
	}
};

const median = (values: number[]): number | null => {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? (sorted[mid] as number)
		: ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};
const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

/**
 * GET /leads/analytics?from&to&locationId — real funnel and team numbers,
 * built from the activity log. Defaults to the last 30 days.
 */
export const getLeadAnalytics: RequestHandler = async (req, res, next) => {
	try {
		const to = req.query.to ? new Date(String(req.query.to)) : new Date();
		const from = req.query.from
			? new Date(String(req.query.from))
			: new Date(to.getTime() - 30 * 24 * 3600_000);
		if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
			res.status(400).json({ message: "Invalid from/to date" });
			return;
		}
		const locationFilter = buildLocationFilter(
			typeof req.query.locationId === "string" ? req.query.locationId : undefined,
		);
		const range = { $gte: from, $lte: to };

		// ── Cohort: leads that came in during the range ──────────────────
		const cohort = await Lead.find({ ...locationFilter, createdAt: range })
			.select("status source createdAt firstContactedAt attemptCount lostReason")
			.lean();
		const cohortIds = cohort.map((l) => l._id);
		const cohortActivity = await LeadActivity.aggregate<{
			_id: mongoose.Types.ObjectId;
			visitBooked: number;
			visited: number;
		}>([
			{ $match: { leadId: { $in: cohortIds } } },
			{
				$group: {
					_id: "$leadId",
					visitBooked: {
						$max: { $cond: [{ $eq: ["$statusTo", LeadStatus.VisitBooked] }, 1, 0] },
					},
					visited: {
						$max: {
							$cond: [
								{
									$in: [
										"$outcome",
										["visited_joining", "visited_deciding", "visited_not_interested"],
									],
								},
								1,
								0,
							],
						},
					},
				},
			},
		]);
		const reachedVisit = new Set(
			cohortActivity.filter((a) => a.visitBooked).map((a) => String(a._id)),
		);
		const visited = new Set(
			cohortActivity.filter((a) => a.visited).map((a) => String(a._id)),
		);

		const contacted = cohort.filter((l) => l.firstContactedAt);
		const converted = cohort.filter((l) => l.status === LeadStatus.Converted);
		const firstContactHours = contacted.map(
			(l) =>
				(new Date(l.firstContactedAt as Date).getTime() -
					new Date(l.createdAt as Date).getTime()) /
				3600_000,
		);
		const attempted = cohort.filter((l) => (l.attemptCount ?? 0) > 0);

		const bySource = new Map<string, { leads: number; converted: number }>();
		for (const l of cohort) {
			const key = l.source || "unknown";
			const row = bySource.get(key) ?? { leads: 0, converted: 0 };
			row.leads += 1;
			if (l.status === LeadStatus.Converted) row.converted += 1;
			bySource.set(key, row);
		}

		// ── Work done during the range ───────────────────────────────────
		const activityMatch = {
			...(locationFilter.locationId ? { locationId: locationFilter.locationId } : {}),
			createdAt: range,
		};
		const [outcomes, lostReasons, staff, conversions] = await Promise.all([
			LeadActivity.aggregate<{ _id: { outcome: string; label: string }; count: number }>([
				{ $match: { ...activityMatch, type: { $in: ["call", "whatsapp", "visit"] } } },
				{ $group: { _id: { outcome: "$outcome", label: "$label" }, count: { $sum: 1 } } },
				{ $sort: { count: -1 } },
			]),
			LeadActivity.aggregate<{ _id: string; count: number }>([
				{ $match: { ...activityMatch, statusTo: LeadStatus.Lost, lostReason: { $ne: "" } } },
				{ $group: { _id: "$lostReason", count: { $sum: 1 } } },
				{ $sort: { count: -1 } },
			]),
			LeadActivity.aggregate<{
				_id: string;
				name: string;
				attempts: number;
				connected: number;
				visitsBooked: number;
				lost: number;
				leads: string[];
			}>([
				{
					$match: {
						...activityMatch,
						type: { $in: ["call", "whatsapp", "visit"] },
						"createdBy.id": { $ne: null },
					},
				},
				{
					$group: {
						_id: "$createdBy.id",
						name: { $last: "$createdBy.name" },
						attempts: { $sum: 1 },
						connected: { $sum: { $cond: ["$connected", 1, 0] } },
						visitsBooked: {
							$sum: { $cond: [{ $eq: ["$statusTo", LeadStatus.VisitBooked] }, 1, 0] },
						},
						lost: { $sum: { $cond: [{ $eq: ["$statusTo", LeadStatus.Lost] }, 1, 0] } },
						leads: { $addToSet: { $toString: "$leadId" } },
					},
				},
				{ $sort: { attempts: -1 } },
			]),
			LeadActivity.find({ ...activityMatch, type: "system", outcome: "converted" })
				.select("leadId")
				.lean(),
		]);

		// Conversions are credited to the lead's owner.
		const convertedLeads = await Lead.find({
			_id: { $in: conversions.map((c) => c.leadId) },
		})
			.select("owner")
			.lean();
		const conversionsByOwner = new Map<string, number>();
		for (const l of convertedLeads) {
			if (!l.owner) continue;
			const key = String(l.owner);
			conversionsByOwner.set(key, (conversionsByOwner.get(key) ?? 0) + 1);
		}

		const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
		const lostLabel = new Map(LOST_REASONS.map((r) => [r.key, r.label]));

		res.status(200).json({
			range: { from, to },
			totals: {
				leads: cohort.length,
				contacted: contacted.length,
				contactRate: pct(contacted.length, cohort.length),
				converted: converted.length,
				conversionRate: pct(converted.length, cohort.length),
				avgAttemptsPerLead: attempted.length
					? round1(
							attempted.reduce((s, l) => s + (l.attemptCount ?? 0), 0) / attempted.length,
						)
					: null,
				medianHoursToFirstContact: round1(median(firstContactHours)),
				neverAttempted: cohort.filter(
					(l) => !(l.attemptCount ?? 0) && l.status !== LeadStatus.Converted,
				).length,
			},
			funnel: [
				{ stage: "New", count: cohort.length },
				{ stage: "Contacted", count: contacted.length },
				{ stage: "Visit booked", count: reachedVisit.size },
				{ stage: "Visited", count: visited.size },
				{ stage: "Converted", count: converted.length },
			],
			outcomes: outcomes.map((o) => ({
				outcome: o._id.outcome,
				label: o._id.label,
				count: o.count,
			})),
			lostReasons: lostReasons.map((r) => {
				const [key = "", ...rest] = r._id.split(":");
				return {
					reason: r._id,
					label: key === "other" && rest.length ? `Other: ${rest.join(":").trim()}` : lostLabel.get(key) ?? r._id,
					count: r.count,
				};
			}),
			bySource: [...bySource.entries()]
				.map(([source, v]) => ({ source, ...v, conversionRate: pct(v.converted, v.leads) }))
				.sort((a, b) => b.leads - a.leads),
			staff: staff.map((s) => ({
				staffId: s._id,
				name: s.name,
				attempts: s.attempts,
				connected: s.connected,
				connectRate: pct(s.connected, s.attempts),
				leadsWorked: s.leads.length,
				visitsBooked: s.visitsBooked,
				lost: s.lost,
				converted: conversionsByOwner.get(s._id) ?? 0,
			})),
		});
	} catch (error) {
		if (error instanceof LocationError) {
			const mapped = mapLocationError(error);
			res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
			return;
		}
		next(error);
	}
};
