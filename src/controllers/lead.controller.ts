import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { type Gender, AlertSeverity, AlertStatus, AlertType, LeadStatus } from "../models/Enums";
import Lead from "../models/Lead";
import LeadActivity from "../models/LeadActivity";
import User from "../models/User";
import OperationalAlert from "../models/OperationalAlert";
import Location from "../models/Location";
import { emitOperationalAlert } from "../services/realtime.service";
import { autoResolveOperationalAlerts } from "./operational-alert.controller";
import { getEffectiveAlertRule } from "../utils/default-alert-rules";
import { isSalesStaffOnDuty } from "../services/staff-presence.service";
import { calculateHealthScore } from "../utils/health-score";
import { logLeadActivity, resolveActor } from "../services/lead-activity.service";
import { findExistingLead } from "../utils/lead-match";
import { pendingInvoiceIdsByLead } from "../utils/lead-pending-invoice";
import { hashPassword } from "../utils/password";
import {
	buildLocationFilter,
	LocationError,
	mapLocationError,
	resolveLocationId,
} from "../utils/location.resolver";

const sendLocationError = (
	res: Parameters<RequestHandler>[1],
	error: LocationError,
) => {
	const mapped = mapLocationError(error);
	res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
};
import {
	convertLeadBodySchema,
	createLeadBodySchema,
	publicLeadCaptureBodySchema,
	updateLeadBodySchema,
} from "../validators/lead.validator";

// A lead becomes Converted only when it turns into a member — its invoice is
// paid, or POST /leads/:id/convert. Setting the status by hand would leave a
// "converted" lead with no member behind it.
const rejectDirectConversion = (
	res: Parameters<RequestHandler>[1],
	status: string | undefined,
): boolean => {
	if (status !== LeadStatus.Converted) return false;
	res.status(400).json({
		message:
			"A lead can't be marked Converted directly. It converts when its invoice is paid, or via POST /leads/:id/convert.",
		code: "LEAD_CONVERSION_NOT_ALLOWED",
	});
	return true;
};

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

export const createLead: RequestHandler = async (req, res, next) => {
	const parsedBody = createLeadBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid lead payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	if (rejectDirectConversion(res, parsedBody.data.status)) return;

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
		const { locationId, ...fields } = leadData;
		const lead = await Lead.create({
			...fields,
			// Left out, the location-stamp plugin applies the default branch.
			...(locationId !== undefined
				? { locationId: locationId && (await resolveLocationId(locationId)) }
				: {}),
			status: leadData.status as
				| import("../models/Enums").LeadStatus
				| undefined,
			...(followUpDateValue ? { followUpDate: followUpDateValue } : {}),
			...(ownerId ? { owner: ownerId } : {}),
		});

		void logLeadActivity({
			leadId: lead._id,
			locationId: lead.locationId,
			type: "system",
			outcome: "created",
			label: `Lead added${lead.source ? ` (${lead.source})` : ""}`,
			note: lead.notes ?? "",
			statusTo: lead.status,
			actor: await resolveActor(req.user),
		});

		res.status(201).json({ message: "Lead created", lead });
	} catch (error) {
		if (error instanceof LocationError) {
			sendLocationError(res, error);
			return;
		}
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
		// Someone enquiring again lands on their existing lead instead of a
		// duplicate the desk would call twice. A lead marked Lost reopens. A
		// member (Converted) enquiring again is a new sale, so gets a new lead.
		const existing = await findExistingLead({
			phone: resolvedPhone,
			email: resolvedEmail,
		});
		const reuse = existing && existing.status !== LeadStatus.Converted;

		const lead = reuse
			? ((await Lead.findByIdAndUpdate(
					existing._id,
					{
						$set: {
							notes: [
								existing.notes?.trim(),
								`Enquired again via ${normalizedSource} on ${new Date().toISOString().slice(0, 10)}${
									resolvedNotes ? `:\n${resolvedNotes}` : ""
								}`,
							]
								.filter(Boolean)
								.join("\n"),
							publicCapture,
							...(existing.status === LeadStatus.Lost
								? { status: LeadStatus.New }
								: {}),
							...(!existing.email && resolvedEmail ? { email: resolvedEmail } : {}),
							...(!existing.phone && resolvedPhone ? { phone: resolvedPhone } : {}),
							...(!existing.interestedIn && resolvedInterest
								? { interestedIn: resolvedInterest }
								: {}),
							// The phone stood in as the name until a real one arrived.
							...(existing.leadName === existing.phone && resolvedLeadName
								? { leadName: resolvedLeadName }
								: {}),
							...(followUpDateValue ? { followUpDate: followUpDateValue } : {}),
						},
						$addToSet: { tags: { $each: [...finalTags, "repeat-enquiry"] } },
					},
					{ returnDocument: "after" },
				)) ?? existing)
			: await Lead.create({
					leadName: resolvedLeadName,
					...(resolvedEmail ? { email: resolvedEmail } : {}),
					...(resolvedPhone ? { phone: resolvedPhone } : {}),
					source: normalizedSource,
					...(resolvedInterest ? { interestedIn: resolvedInterest } : {}),
					...(resolvedNotes ? { notes: resolvedNotes } : {}),
					tags: existing ? [...finalTags, "existing-member"] : finalTags,
					...(followUpDateValue ? { followUpDate: followUpDateValue } : {}),
					status: LeadStatus.New,
					publicCapture,
				});

		void logLeadActivity({
			leadId: lead._id,
			locationId: lead.locationId,
			type: "system",
			outcome: reuse ? "enquired_again" : "created",
			label: reuse
				? `Enquired again via ${normalizedSource}`
				: `Enquiry via ${normalizedSource}`,
			note: resolvedNotes ?? "",
			statusFrom: reuse ? existing.status : null,
			statusTo: lead.status,
		});

		// FX-35.1: If lead is an urgent callback or hot lead, raise an OperationalAlert
		const isUrgent =
			finalTags.includes("callback") ||
			finalTags.includes("hot") ||
			(resolvedNotes && resolvedNotes.includes("[APP_PURCHASE_FALLBACK]"));

		if (isUrgent) {
			try {
				const defaultBranch = await Location.findOne({ isActive: true }).select("_id");
				if (defaultBranch) {
					const rule = await getEffectiveAlertRule(AlertType.LeadUnclaimed);
					const salesOnDuty = await isSalesStaffOnDuty(defaultBranch._id);
					const targetRoles = salesOnDuty
						? [rule.firstResponderRole]
						: ["branch_manager", "admin"];
					const escalationLadder = salesOnDuty
						? rule.escalationLadder
						: [{ role: "admin", afterMinutes: 15 }];
					const title = salesOnDuty
						? `Urgent Callback Lead: ${resolvedLeadName}`
						: `[Direct to Manager] Urgent Callback Lead: ${resolvedLeadName}`;
					const message = salesOnDuty
						? `New high-intent lead requires callback (${resolvedPhone || resolvedEmail || "Phone pending"}). First responder: ${rule.firstResponderRole}.`
						: `New high-intent lead requires callback with no sales staff on duty at branch (${resolvedPhone || resolvedEmail || "Phone pending"}). Escalated directly to Branch Manager.`;

					const alert = await OperationalAlert.create({
						type: AlertType.LeadUnclaimed,
						severity: rule.severity,
						status: AlertStatus.Open,
						title,
						message,
						branchId: defaultBranch._id,
						targetRoles,
						sound: rule.sound,
						escalationLadder,
						relatedEntity: {
							entityType: "lead",
							entityId: lead._id.toString(),
							summary: `${resolvedLeadName} - ${resolvedInterest || "Membership inquiry"}`,
						},
						autoResolveKey: `lead:${lead._id.toString()}`,
					});
					emitOperationalAlert(alert.toObject());
				}
			} catch (alertErr) {
				console.error("[OperationalAlert] Failed to raise alert for lead", alertErr);
			}
		}

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
		const { source, status, tags, locationId } = req.query;
		const filter: Record<string, unknown> = buildLocationFilter(
			typeof locationId === "string" ? locationId : undefined,
		);

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

		const leads = await Lead.find(filter).populate(
			"convertedUser",
			"username email onboarded onboardingStatus",
		);
		const pending = await pendingInvoiceIdsByLead(leads.map((l) => l._id));
		res.status(200).json({
			leads: leads.map((lead) => ({
				...lead.toJSON(),
				pendingInvoiceId: pending.get(String(lead._id)) ?? null,
			})),
		});
	} catch (error) {
		if (error instanceof LocationError) {
			sendLocationError(res, error);
			return;
		}
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

		const pending = await pendingInvoiceIdsByLead([lead._id]);
		res.status(200).json({
			lead: {
				...lead.toJSON(),
				pendingInvoiceId: pending.get(String(lead._id)) ?? null,
			},
		});
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

	if (rejectDirectConversion(res, parsedBody.data.status)) return;

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
		const before = await Lead.findById(id).select("status visitAt");
		if (!before) {
			res.status(404).json({ message: "Lead not found" });
			return;
		}

		const { locationId, visitAt: visitAtRaw, ...fields } = payload;
		const visitAtValue =
			visitAtRaw === undefined ? undefined : parseDateOrNull(visitAtRaw ?? undefined);
		if (visitAtRaw && !visitAtValue) {
			res.status(400).json({ message: "Invalid visitAt" });
			return;
		}
		// A booked visit needs a time; the desk asks for one before moving it.
		if (
			fields.status === LeadStatus.VisitBooked &&
			!(visitAtValue ?? before.visitAt)
		) {
			res.status(400).json({
				message: "Pick the visit date and time",
				code: "VISIT_AT_REQUIRED",
			});
			return;
		}

		const updatedLead = await Lead.findByIdAndUpdate(
			id,
			{
				...fields,
				...(visitAtValue !== undefined ? { visitAt: visitAtValue } : {}),
				...(locationId !== undefined
					? { locationId: locationId && (await resolveLocationId(locationId)) }
					: {}),
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

		if (fields.status && fields.status !== before.status) {
			void logLeadActivity({
				leadId: updatedLead._id,
				locationId: updatedLead.locationId,
				type: "status_change",
				outcome: "moved",
				label: "Moved on the board",
				statusFrom: before.status,
				statusTo: updatedLead.status,
				lostReason: updatedLead.lostReason ?? "",
				visitAt: updatedLead.visitAt ?? null,
				actor: await resolveActor(req.user),
			});
		}

		// FX-35.4: Auto-resolve alert when lead is claimed or updated
		void autoResolveOperationalAlerts("lead", id, "Lead updated or claimed by staff");

		res.status(200).json({ message: "Lead updated", lead: updatedLead });
	} catch (error) {
		if (error instanceof LocationError) {
			sendLocationError(res, error);
			return;
		}
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

		await LeadActivity.deleteMany({ leadId: deletedLead._id });

		// FX-42.4: Auto-resolve alerts on lead deletion
		void autoResolveOperationalAlerts("lead", id, "Lead deleted");

		res.status(200).json({ message: "Lead deleted" });
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
				// A converted lead joins the branch they enquired at; with no
				// branch on the lead the plugin applies the default.
				...(lead.locationId ? { homeLocationId: lead.locationId } : {}),
			});

			targetUserId = createdUser._id;
			userResponsePayload = {
				id: createdUser._id,
				email: createdUser.email,
				role: "user" as const,
			};
		}

		// No membership is created here. The member's plan comes from the
		// invoice they pay (Mark as Paid provisions it) or from the desk assigning
		// one, so a converted lead never gets free credits they didn't buy.

		// Audit Trail Update
		lead.status = LeadStatus.Converted;
		lead.convertedUser = targetUserId;
		await lead.save();

		void logLeadActivity({
			leadId: lead._id,
			locationId: lead.locationId,
			type: "system",
			outcome: "converted",
			label: "Converted to a member",
			statusTo: LeadStatus.Converted,
			actor: await resolveActor(req.user),
		});

		// FX-35.4: Auto-resolve alert when lead is converted to member
		void autoResolveOperationalAlerts("lead", id, "Lead converted to member");

		res.status(201).json({
			message: "Lead converted to user",
			lead,
			user: userResponsePayload,
		});
	} catch (error) {
		next(error);
	}
};
