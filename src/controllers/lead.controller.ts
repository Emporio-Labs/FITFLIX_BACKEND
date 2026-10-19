import type { Request, RequestHandler } from "express";
import mongoose from "mongoose";
import Admin from "../models/Admin";
import { type Gender, LeadStatus, MembershipStatus } from "../models/Enums";
import Lead from "../models/Lead";
import User from "../models/User";
import Membership from "../models/Membership";
import { BranchScopeError } from "../services/staffContext.service";
import { calculateHealthScore } from "../utils/health-score";
import {
	resolveLocationId,
	scopedLocationFilter,
} from "../utils/location.resolver";
import { hashPassword } from "../utils/password";
import {
	contactAttemptBodySchema,
	convertLeadBodySchema,
	createLeadBodySchema,
	leadInteractionBodySchema,
	publicLeadCaptureBodySchema,
	reassignLeadBodySchema,
	updateLeadBodySchema,
} from "../validators/lead.validator";

const parseDateOrNull = (value: string | undefined) => {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
};

const dedupeNonEmptyTags = (tags: Array<string | undefined>): string[] => {
	const normalized = tags
		.filter((value): value is string => typeof value === "string")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);

	return Array.from(new Set(normalized));
};

const toTagSlug = (value: string): string =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (
		typeof idParam !== "string" ||
		!mongoose.Types.ObjectId.isValid(idParam)
	) {
		return null;
	}

	return idParam;
};

/** The branch a request targets: header wins, then body, then query. */
const readTargetBranch = (req: Request): string | undefined => {
	const header = req.header("x-location-id");
	if (header && header.trim()) return header.trim();

	const body = (req.body as { locationId?: unknown } | undefined)?.locationId;
	if (typeof body === "string" && body.trim()) return body.trim();

	const query = req.query?.locationId;
	if (typeof query === "string" && query.trim()) return query.trim();

	return undefined;
};

/**
 * The staff account performing a write — the person a claim, note, call or
 * conversion is recorded against (FX-33.5). Name comes from the Admin profile,
 * falling back to the token's email so the attribution is never blank.
 */
const resolveActor = async (
	req: Request,
): Promise<{ id: mongoose.Types.ObjectId | null; name: string }> => {
	const rawId = req.user?.id;
	if (!rawId || !mongoose.Types.ObjectId.isValid(rawId)) {
		return { id: null, name: req.user?.email ?? "" };
	}
	const id = new mongoose.Types.ObjectId(rawId);
	const admin = await Admin.findById(id).select("adminName").lean<{
		adminName?: string;
	} | null>();
	return { id, name: admin?.adminName || req.user?.email || "" };
};

/**
 * Refuse a staff caller acting on a lead outside their branch scope. The
 * branch-scope middleware only checks the branch *named* in the request; a
 * lead is targeted by id, so its own branch must be checked here (FX-17 +
 * FX-33). A no-op when enforcement is off (allowedBranchIds == null).
 */
const assertLeadInScope = (
	lead: { locationId?: unknown },
	req: Request,
): void => {
	const allowed = req.allowedBranchIds;
	if (allowed == null) return;
	const leadBranch = lead.locationId ? String(lead.locationId) : null;
	if (!leadBranch || !allowed.includes(leadBranch)) {
		throw new BranchScopeError(
			"NOT_YOUR_BRANCH",
			"This lead isn't at a branch you work at.",
		);
	}
};

export const createLead: RequestHandler = async (req, res, next) => {
	const parsedBody = createLeadBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid lead payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const { ownerId, ...leadData } = parsedBody.data;

	const followUpDateValue = parseDateOrNull(parsedBody.data.followUpDate);

	if (parsedBody.data.followUpDate && !followUpDateValue) {
		res.status(400).json({ message: "Invalid followUpDate" });
		return;
	}

	if (ownerId && !mongoose.Types.ObjectId.isValid(ownerId)) {
		res.status(400).json({ message: "Invalid ownerId" });
		return;
	}

	try {
		// FX-33.1 — stamp the lead with the branch the frontdesk has selected
		// (X-Location-Id). When no branch is named the model's pre-validate hook
		// fills the sole active branch; with several active and none named it
		// stays null rather than failing the create.
		const namedBranch = readTargetBranch(req);
		const locationId = namedBranch
			? await resolveLocationId(namedBranch)
			: undefined;

		const lead = await Lead.create({
			...leadData,
			status: leadData.status as
				| import("../models/Enums").LeadStatus
				| undefined,
			...(locationId ? { locationId } : {}),
			...(followUpDateValue ? { followUpDate: followUpDateValue } : {}),
			...(ownerId ? { owner: ownerId } : {}),
		});

		res.status(201).json({ message: "Lead created", lead });
	} catch (error) {
		next(error);
	}
};

export const createPublicLead: RequestHandler = async (req, res, next) => {
	const parsedBody = publicLeadCaptureBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid lead payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const {
		captchaToken: _captchaToken,
		website,
		followUpDate,
		formType,
		name,
		source,
		personalDetails,
		assessment,
		leadName,
		email,
		phone,
		interests,
		intrests,
		interestedIn,
		notes,
		tags,
	} = parsedBody.data;

	// Honeypot field for bot traffic; return accepted without writing data.
	if (website) {
		res.status(202).json({ message: "Lead captured" });
		return;
	}

	const followUpDateValue = parseDateOrNull(followUpDate);

	if (followUpDate && !followUpDateValue) {
		res.status(400).json({ message: "Invalid followUpDate" });
		return;
	}

	const normalizedSource =
		source?.trim() || process.env.PUBLIC_LEAD_DEFAULT_SOURCE || "fitflix.in";
	const normalizedCallbackInterests = dedupeNonEmptyTags([
		...(interests ?? []),
		...(intrests ?? []),
	]);

	const inferredFormType =
		personalDetails || assessment ? "healthscore" : "callback";
	const submissionFormType = formType ?? inferredFormType;

	const resolvedEmail = personalDetails?.emailAddress ?? email;
	const resolvedPhone = personalDetails?.phoneNumber ?? phone;
	// A phone-only callback still has to satisfy the schema's required
	// leadName, so the number stands in as the display name until front desk
	// speaks to them and edits it. Better an honest "+91…" on the card than a
	// placeholder like "App user" that every row shares.
	const resolvedLeadName =
		personalDetails?.fullName ?? leadName ?? name ?? resolvedPhone;
	const resolvedInterest =
		personalDetails?.primaryHealthGoal ??
		interestedIn ??
		(normalizedCallbackInterests.length > 0
			? normalizedCallbackInterests.join(", ")
			: undefined);

	// Callback requests are keyed by phone; every other form still needs an
	// email, because that is the only way we can reach a website lead.
	const isCallback = submissionFormType === "callback";

	if (!resolvedLeadName || (!isCallback && !resolvedEmail)) {
		res.status(400).json({
			message:
				"Missing required identity fields: leadName/email or personalDetails.fullName/emailAddress",
		});
		return;
	}

	// formType is *inferred* as "callback" whenever a payload carries no
	// personalDetails, so this branch also catches legacy leadName/email
	// submissions from the website. Those have no phone and never did —
	// demanding one here would reject them. What actually matters is that we
	// end up with some way to reach the person.
	if (isCallback && !resolvedPhone && !resolvedEmail) {
		res.status(400).json({
			message: "A callback request requires a phone number or an email",
		});
		return;
	}

	const scoreResult = assessment
		? calculateHealthScore(assessment.version, assessment.answers)
		: null;

	const scoreSummary = scoreResult
		? `Health score ${scoreResult.overallScore}/100 (${scoreResult.brandTier.brand} - ${scoreResult.brandTier.tier})`
		: null;

	const resolvedNotes = [notes, personalDetails?.notes, scoreSummary]
		.filter((value): value is string => typeof value === "string")
		.map((value) => value.trim())
		.filter((value) => value.length > 0)
		.join("\n\n");

	const finalTags = dedupeNonEmptyTags([
		...(tags ?? []),
		...normalizedCallbackInterests,
		...(personalDetails?.wellnessInterests ?? []),
		submissionFormType === "healthscore"
			? "fitflix-health-score-form"
			: "fitflix-callback-form",
		assessment ? `assessment:${assessment.version}` : undefined,
		scoreResult ? `health-score:${scoreResult.overallScore}` : undefined,
		scoreResult
			? `health-tier:${toTagSlug(scoreResult.brandTier.brand)}`
			: undefined,
		personalDetails?.fitnessLevel
			? `fitness-level:${toTagSlug(personalDetails.fitnessLevel)}`
			: undefined,
	]);

	const publicCapture = {
		formType: submissionFormType,
		callback:
			submissionFormType === "callback"
				? {
						name: resolvedLeadName,
						email: resolvedEmail ?? null,
						phone: resolvedPhone ?? null,
						interests: normalizedCallbackInterests,
					}
				: null,
		personalDetails: personalDetails ?? null,
		assessment:
			assessment && scoreResult
				? {
						version: assessment.version,
						answers: assessment.answers,
						totalScore: scoreResult.totalScore,
						maxScore: scoreResult.maxScore,
						overallScore: scoreResult.overallScore,
						categoryScores: scoreResult.categoryScores,
						brandTier: scoreResult.brandTier,
					}
				: null,
		submittedAt: new Date(),
	};

	try {
		const lead = await Lead.create({
			leadName: resolvedLeadName,
			...(resolvedEmail ? { email: resolvedEmail } : {}),
			...(resolvedPhone ? { phone: resolvedPhone } : {}),
			source: normalizedSource,
			...(resolvedInterest ? { interestedIn: resolvedInterest } : {}),
			...(resolvedNotes ? { notes: resolvedNotes } : {}),
			tags: finalTags,
			...(followUpDateValue ? { followUpDate: followUpDateValue } : {}),
			status: LeadStatus.New,
			publicCapture,
		});

		const responseBody: Record<string, unknown> = {
			message: "Lead captured",
			leadId: lead._id,
		};

		if (scoreResult) {
			responseBody.healthScore = {
				overallScore: scoreResult.overallScore,
				categoryScores: scoreResult.categoryScores,
				brand: scoreResult.brandTier.brand,
				tier: scoreResult.brandTier.tier,
			};
		}

		res.status(202).json(responseBody);
	} catch (error) {
		next(error);
	}
};

export const getAllLeads: RequestHandler = async (req, res, next) => {
	try {
		const { source, status, tags, locationId, queue } = req.query;
		const filter: Record<string, unknown> = {};

		if (typeof source === "string" && source) {
			filter.source = source;
		}
		if (typeof status === "string" && status) {
			filter.status = status;
		}
		if (typeof tags === "string" && tags) {
			filter.tags = {
				$in: tags
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean),
			};
		}

		// FX-33.4 — branch scope. With enforcement off (or a global admin)
		// allowedBranchIds is null and this is `{}` / the one explicit id, exactly
		// as before. A branch-scoped caller is narrowed to their branches.
		const branchFilter = scopedLocationFilter(
			req.allowedBranchIds,
			typeof locationId === "string" ? locationId : undefined,
			"locationId",
		);
		Object.assign(filter, branchFilter);

		// FX-33.4 — queue visibility. Sales see the unclaimed queue plus their own
		// leads; managers (and admins/frontdesk) see every lead at their branch.
		// Enforcement off → allowedBranchIds null → no ownership narrowing (today's
		// behaviour: everyone sees everything).
		const staffRole = req.staffContext?.staffRole ?? req.user?.staffRole ?? null;
		const callerId = req.user?.id;
		const isSales = req.allowedBranchIds != null && staffRole === "sales";

		// Optional explicit queue view, re-restricted below for a sales caller so
		// they can never widen past unclaimed + own.
		const ownershipClauses: Array<Record<string, unknown>> = [];
		if (isSales) {
			if (queue === "mine" && callerId) {
				ownershipClauses.push({ claimedBy: callerId });
			} else if (queue === "unclaimed") {
				ownershipClauses.push({ claimedBy: null });
			} else {
				ownershipClauses.push({ claimedBy: null });
				if (callerId) ownershipClauses.push({ claimedBy: callerId });
			}
		} else {
			// Manager / admin / frontdesk may still opt into a narrower view.
			if (queue === "unclaimed") {
				ownershipClauses.push({ claimedBy: null });
			} else if (queue === "mine" && callerId) {
				ownershipClauses.push({ claimedBy: callerId });
			}
		}
		if (ownershipClauses.length === 1) {
			Object.assign(filter, ownershipClauses[0]);
		} else if (ownershipClauses.length > 1) {
			filter.$or = ownershipClauses;
		}

		const leads = await Lead.find(filter).populate(
			"convertedUser",
			"username email onboarded onboardingStatus",
		);
		res.status(200).json({ leads });
	} catch (error) {
		next(error);
	}
};

export const getLeadStats: RequestHandler = async (_req, res, next) => {
	try {
		const [byStatus, bySource, signupFunnel] = await Promise.all([
			Lead.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
			Lead.aggregate([{ $group: { _id: "$source", count: { $sum: 1 } } }]),
			Lead.aggregate([
				{ $match: { source: "app-signup", convertedUser: { $ne: null } } },
				{
					$lookup: {
						from: "users",
						localField: "convertedUser",
						foreignField: "_id",
						as: "user",
						pipeline: [
							{
								$project: {
									onboarded: 1,
									"onboardingStatus.currentStep": 1,
									"onboardingStatus.onboardingCompleted": 1,
								},
							},
						],
					},
				},
				{ $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
				{
					$group: {
						_id: {
							onboarded: { $ifNull: ["$user.onboarded", false] },
							currentStep: {
								$ifNull: [
									"$user.onboardingStatus.currentStep",
									"HEALTH_MARKERS",
								],
							},
						},
						count: { $sum: 1 },
					},
				},
				{ $sort: { count: -1 } },
			]),
		]);

		res.status(200).json({
			byStatus: Object.fromEntries(
				byStatus.map((s) => [s._id ?? "unknown", s.count]),
			),
			bySource: Object.fromEntries(
				bySource.map((s) => [s._id ?? "unknown", s.count]),
			),
			signupFunnel,
		});
	} catch (error) {
		next(error);
	}
};

/**
 * FX-34.4 — per-person performance for the branch manager's view: each staff
 * member's open leads, conversions, and average time to first contact.
 *
 * Grouped by the lead's claimer (`claimedBy`), so credit follows whoever worked
 * the lead. Branch-scoped the same way the queue is: a branch manager sees only
 * their branch(es); a global admin sees all. "Time to first contact" is from
 * when the person got the lead (claimedAt, falling back to the lead's creation)
 * to their first call/whatsapp/email on it; leads never contacted don't count
 * toward the average. Computed from the full interaction history (no notesLimit
 * cap), so it's accurate regardless of how the list endpoint paginates notes.
 */
export const getTeamPerformance: RequestHandler = async (req, res, next) => {
	try {
		const { locationId } = req.query;
		const branchFilter = scopedLocationFilter(
			req.allowedBranchIds,
			typeof locationId === "string" ? locationId : undefined,
			"locationId",
		);

		const contactTypes = ["call", "whatsapp", "email"];
		const closedStatuses = [LeadStatus.Converted, LeadStatus.Lost];

		const rows = await Lead.aggregate([
			{ $match: { ...branchFilter, claimedBy: { $ne: null } } },
			{
				$addFields: {
					firstContactAt: {
						$min: {
							$map: {
								input: {
									$filter: {
										input: { $ifNull: ["$interactions", []] },
										as: "i",
										cond: { $in: ["$$i.type", contactTypes] },
									},
								},
								as: "i",
								in: "$$i.createdAt",
							},
						},
					},
					baseline: { $ifNull: ["$claimedAt", "$createdAt"] },
				},
			},
			{
				$addFields: {
					timeToFirstContactMs: {
						$cond: [
							{
								$and: [
									{ $ne: ["$firstContactAt", null] },
									{ $ne: ["$baseline", null] },
								],
							},
							{ $subtract: ["$firstContactAt", "$baseline"] },
							null,
						],
					},
				},
			},
			{
				$group: {
					_id: "$claimedBy",
					staffName: { $first: "$claimedByName" },
					totalClaimed: { $sum: 1 },
					openLeads: {
						$sum: {
							$cond: [{ $in: ["$status", closedStatuses] }, 0, 1],
						},
					},
					conversions: {
						$sum: {
							$cond: [{ $eq: ["$status", LeadStatus.Converted] }, 1, 0],
						},
					},
					// A first-contact time can be negative if the lead was contacted
					// before it was claimed (reassigned after work began); drop those
					// rather than let them pull the average below zero.
					contactSamples: {
						$push: {
							$cond: [
								{
									$and: [
										{ $ne: ["$timeToFirstContactMs", null] },
										{ $gte: ["$timeToFirstContactMs", 0] },
									],
								},
								"$timeToFirstContactMs",
								"$$REMOVE",
							],
						},
					},
				},
			},
			{ $sort: { openLeads: -1, conversions: -1 } },
		]);

		const members = rows.map((row) => {
			const samples: number[] = Array.isArray(row.contactSamples)
				? row.contactSamples
				: [];
			const avgTimeToFirstContactMs = samples.length
				? Math.round(samples.reduce((sum, ms) => sum + ms, 0) / samples.length)
				: null;
			return {
				staffId: row._id ? String(row._id) : null,
				staffName: row.staffName || "Unknown",
				openLeads: row.openLeads ?? 0,
				conversions: row.conversions ?? 0,
				totalClaimed: row.totalClaimed ?? 0,
				avgTimeToFirstContactMs,
				firstContactSamples: samples.length,
			};
		});

		res.status(200).json({ members });
	} catch (error) {
		next(error);
	}
};

export const getLeadById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid lead id" });
		return;
	}

	try {
		const lead = await Lead.findById(id).populate(
			"convertedUser",
			"username email onboarded onboardingStatus",
		);

		if (!lead) {
			res.status(404).json({ message: "Lead not found" });
			return;
		}

		res.status(200).json({ lead });
	} catch (error) {
		next(error);
	}
};

export const updateLeadById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid lead id" });
		return;
	}

	const parsedBody = updateLeadBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid lead update payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const { ownerId, ...payload } = parsedBody.data;

	const followUpDateValue = parseDateOrNull(parsedBody.data.followUpDate);

	if (parsedBody.data.followUpDate && !followUpDateValue) {
		res.status(400).json({ message: "Invalid followUpDate" });
		return;
	}

	if (ownerId && !mongoose.Types.ObjectId.isValid(ownerId)) {
		res.status(400).json({ message: "Invalid ownerId" });
		return;
	}

	try {
		const updatedLead = await Lead.findByIdAndUpdate(
			id,
			{
				...payload,
				...(followUpDateValue !== null
					? { followUpDate: followUpDateValue }
					: {}),
				...(ownerId ? { owner: ownerId } : {}),
			},
			{ returnDocument: "after", runValidators: true },
		);

		if (!updatedLead) {
			res.status(404).json({ message: "Lead not found" });
			return;
		}

		res.status(200).json({ message: "Lead updated", lead: updatedLead });
	} catch (error) {
		next(error);
	}
};

export const deleteLeadById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid lead id" });
		return;
	}

	try {
		const deletedLead = await Lead.findByIdAndDelete(id);

		if (!deletedLead) {
			res.status(404).json({ message: "Lead not found" });
			return;
		}

		res.status(200).json({ message: "Lead deleted" });
	} catch (error) {
		next(error);
	}
};

/**
 * FX-33.2 / FX-33.3 — claim an unclaimed lead for the acting staff member.
 *
 * The write is a single atomic `findOneAndUpdate` filtered on `claimedBy: null`,
 * so when two people claim the same lead at the same moment exactly one update
 * matches: the winner gets 200, the loser gets 409 "already claimed".
 */
export const claimLead: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid lead id" });
		return;
	}

	try {
		// Branch gate: the lead must be at a branch the caller works at.
		const existing = await Lead.findById(id).select(
			"locationId claimedBy claimedByName",
		);
		if (!existing) {
			res.status(404).json({ message: "Lead not found" });
			return;
		}
		assertLeadInScope(existing, req);

		const actor = await resolveActor(req);

		const claimed = await Lead.findOneAndUpdate(
			{ _id: id, claimedBy: null },
			{
				$set: {
					claimedBy: actor.id,
					claimedByName: actor.name,
					claimedAt: new Date(),
					// Mirror into the existing owner/assignedStaffName so the current
					// frontdesk "Assigned Staff" column reflects the claim unchanged.
					owner: actor.id,
					assignedStaffName: actor.name,
				},
			},
			{ returnDocument: "after", runValidators: true },
		);

		if (!claimed) {
			// The filter missed because someone already holds it (we proved the
			// lead exists above). Tell the loser who got it (FX-33.3).
			const current = await Lead.findById(id).select("claimedByName");
			// claimedByName goes under `details` so it survives the global error
			// normalizer (which keeps only error/code/details on non-2xx bodies).
			res.status(409).json({
				message: current?.claimedByName
					? `Lead already claimed by ${current.claimedByName}`
					: "Lead already claimed",
				code: "LEAD_ALREADY_CLAIMED",
				details: { claimedByName: current?.claimedByName ?? "" },
			});
			return;
		}

		res.status(200).json({ message: "Lead claimed", lead: claimed });
	} catch (error) {
		next(error);
	}
};

/**
 * FX-34.1 / FX-34.3 — reassign a lead to another staff member, or release it
 * back to the branch's unclaimed queue.
 *
 * `assigneeId` names the new holder; null/omitted releases to the queue. A
 * manager (or a global admin / frontdesk) may do either to any lead at their
 * branch. A sales caller is limited to releasing their *own* lead — they may
 * not hand a lead to someone else, nor release one they don't hold (FX-34.3).
 *
 * The move is written through `doc.save()` (not an atomic filtered update like
 * claim) because a manager is deliberately overriding the current holder, not
 * racing other claimers. A `system` interaction records from/to/by/when so the
 * lead's history shows the reassignment (FX-34.2).
 */
export const reassignLead: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid lead id" });
		return;
	}

	const parsedBody = reassignLeadBodySchema.safeParse(req.body ?? {});
	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid reassignment payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const assigneeId = parsedBody.data.assigneeId ?? null;
	if (assigneeId && !mongoose.Types.ObjectId.isValid(assigneeId)) {
		res.status(400).json({ message: "Invalid assigneeId" });
		return;
	}

	try {
		const lead = await Lead.findById(id);
		if (!lead) {
			res.status(404).json({ message: "Lead not found" });
			return;
		}
		// Branch gate: the lead must be at a branch the caller works at.
		assertLeadInScope(lead, req);

		const actor = await resolveActor(req);

		// FX-34.3 — sales may only release their own lead to the queue. The role
		// is re-derived from the DB (staffContext); narrowing only applies when
		// enforcement is on (allowedBranchIds != null), mirroring the claim flow.
		const enforcing = req.allowedBranchIds != null;
		const staffRole =
			req.staffContext?.staffRole ?? req.user?.staffRole ?? null;
		if (enforcing && staffRole === "sales") {
			if (assigneeId) {
				res.status(403).json({
					message:
						"Sales staff can't reassign leads. You can only release your own lead back to the queue.",
					code: "FORBIDDEN_REASSIGN",
				});
				return;
			}
			const holder = lead.claimedBy ? String(lead.claimedBy) : null;
			if (!holder || holder !== String(actor.id)) {
				res.status(403).json({
					message: "You can only release a lead you currently hold.",
					code: "FORBIDDEN_RELEASE",
				});
				return;
			}
		}

		const fromName =
			lead.claimedByName || lead.assignedStaffName || "the unclaimed queue";

		let toName: string;
		if (assigneeId) {
			// Reassign to a named staff member. They must work at the lead's branch
			// (FX-34.1 "at that branch"). A global/all-branches account passes.
			const assignee = await Admin.findById(assigneeId)
				.select("adminName branchIds allBranches staffRole status isActive")
				.lean<
					{
						adminName?: string;
						branchIds?: unknown;
						allBranches?: boolean;
						status?: string;
						isActive?: boolean;
					} | null
				>();
			if (!assignee) {
				res.status(404).json({ message: "Assignee not found" });
				return;
			}
			const assigneeDisabled =
				assignee.isActive === false ||
				String(assignee.status ?? "").toLowerCase() === "disabled";
			if (assigneeDisabled) {
				res.status(400).json({
					message: "That staff member's account is disabled.",
					code: "ASSIGNEE_DISABLED",
				});
				return;
			}
			const leadBranch = lead.locationId ? String(lead.locationId) : null;
			const assigneeBranches = Array.isArray(assignee.branchIds)
				? assignee.branchIds.map(String)
				: [];
			const assigneeAtBranch =
				assignee.allBranches === true ||
				!leadBranch ||
				assigneeBranches.includes(leadBranch);
			if (!assigneeAtBranch) {
				res.status(400).json({
					message: "You can only reassign to staff at this lead's branch.",
					code: "ASSIGNEE_NOT_AT_BRANCH",
				});
				return;
			}

			toName = assignee.adminName || "staff";
			lead.claimedBy = new mongoose.Types.ObjectId(assigneeId);
			lead.claimedByName = toName;
			lead.claimedAt = new Date();
			lead.owner = new mongoose.Types.ObjectId(assigneeId);
			lead.assignedStaffName = toName;
		} else {
			// Release to the unclaimed queue.
			toName = "the unclaimed queue";
			lead.claimedBy = null;
			lead.claimedByName = "";
			lead.claimedAt = null;
			lead.set("owner", undefined);
			lead.assignedStaffName = "";
		}

		// FX-34.2 — the lead's history shows who reassigned it, from whom, to whom.
		lead.interactions.push({
			type: "system",
			note: `Reassigned from ${fromName} to ${toName}`,
			createdBy: actor.id,
			createdByName: actor.name,
			createdAt: new Date(),
		} as never);

		await lead.save();

		res.status(200).json({ message: "Lead reassigned", lead });
	} catch (error) {
		next(error);
	}
};

/**
 * FX-33.5 — record a free-text note against the acting staff member.
 */
export const addLeadInteraction: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid lead id" });
		return;
	}

	const parsedBody = leadInteractionBodySchema.safeParse(req.body);
	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid interaction payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	try {
		const lead = await Lead.findById(id);
		if (!lead) {
			res.status(404).json({ message: "Lead not found" });
			return;
		}
		assertLeadInScope(lead, req);

		const actor = await resolveActor(req);
		lead.interactions.push({
			type: parsedBody.data.type ?? "note",
			note: parsedBody.data.note,
			createdBy: actor.id,
			createdByName: actor.name,
			createdAt: new Date(),
		} as never);
		await lead.save();

		res.status(201).json({ message: "Interaction added", lead });
	} catch (error) {
		next(error);
	}
};

/**
 * FX-33.5 — log a contact attempt (call/whatsapp/email) against the acting
 * staff member, bump the contact counter, and advance a New lead to Contacted.
 */
export const recordLeadContactAttempt: RequestHandler = async (
	req,
	res,
	next,
) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid lead id" });
		return;
	}

	const parsedBody = contactAttemptBodySchema.safeParse(req.body);
	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid contact attempt payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	try {
		const lead = await Lead.findById(id);
		if (!lead) {
			res.status(404).json({ message: "Lead not found" });
			return;
		}
		assertLeadInScope(lead, req);

		const actor = await resolveActor(req);
		const channel = parsedBody.data.channel ?? "call";
		const now = new Date();

		lead.interactions.push({
			type: channel,
			note: parsedBody.data.note || `Contact attempt via ${channel}`,
			createdBy: actor.id,
			createdByName: actor.name,
			createdAt: now,
		} as never);
		lead.contactCount = (lead.contactCount ?? 0) + 1;
		lead.lastContactedAt = now;
		if (lead.status === LeadStatus.New) {
			lead.status = LeadStatus.Contacted;
		}
		await lead.save();

		res.status(201).json({ message: "Contact attempt recorded", lead });
	} catch (error) {
		next(error);
	}
};

export const convertLeadToUser: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid lead id" });
		return;
	}

	const parsedBody = convertLeadBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid lead conversion payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	try {
		const lead = await Lead.findById(id);

		if (!lead) {
			res.status(404).json({ message: "Lead not found" });
			return;
		}

		assertLeadInScope(lead, req);

		if (lead.status === LeadStatus.Converted && lead.convertedUser) {
			res.status(409).json({
				message: "Lead already converted",
				userId: lead.convertedUser,
			});
			return;
		}

		const { username, phone, age, gender, healthGoals, password } = parsedBody.data;
		const last10 = phone.replace(/\D/g, "").slice(-10);

		// Collision Detection Gate: check if a user with this phone or email already exists.
		const userQuery: any[] = [];
		if (lead.email && lead.email.trim() !== "") {
			userQuery.push({ email: lead.email.trim() });
		}
		if (last10) {
			userQuery.push({ phone: { $regex: new RegExp(last10 + "$") } });
		}

		const existingUser = userQuery.length > 0 ? await User.findOne({ $or: userQuery }) : null;

		let targetUserId: mongoose.Types.ObjectId;
		let userResponsePayload: any;

		if (existingUser) {
			// Case A: User Exists
			targetUserId = existingUser._id;
			userResponsePayload = {
				id: existingUser._id,
				email: existingUser.email,
				role: "user" as const,
			};
		} else {
			// Case B: User is New
			const passwordHash = password ? await hashPassword(password) : undefined;
			const sanitizedEmail = (lead.email && typeof lead.email === "string" && lead.email.trim() !== "") ? lead.email.trim() : undefined;

			const createdUser = await User.create({
				username: username ?? lead.leadName,
				phone: last10,
				email: sanitizedEmail,
				age: Number(age),
				gender: gender as Gender,
				healthGoals,
				passwordHash,
			});

			targetUserId = createdUser._id;
			userResponsePayload = {
				id: createdUser._id,
				email: createdUser.email,
				role: "user" as const,
			};
		}

		// Transactional Membership Allocation: Instantly create and save a new Membership document
		await Membership.create({
			user: targetUserId,
			planName: "Standard Protocol Membership",
			creditsIncluded: 10,
			creditsRemaining: 10,
			status: MembershipStatus.Active,
			price: 0,
			startDate: new Date(),
			endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30-day default limits
		});

		// Audit Trail Update — FX-33.5: record the conversion against the acting
		// staff member (the claimer in the normal flow; a manager converting on
		// their behalf is attributed to the manager).
		const actor = await resolveActor(req);
		lead.status = LeadStatus.Converted;
		lead.convertedUser = targetUserId;
		lead.convertedBy = actor.id;
		lead.interactions.push({
			type: "status-change",
			note: "Converted to member",
			createdBy: actor.id,
			createdByName: actor.name,
			createdAt: new Date(),
		} as never);
		await lead.save();

		res.status(201).json({
			message: "Lead converted to user",
			lead,
			user: userResponsePayload,
		});
	} catch (error) {
		next(error);
	}
};
