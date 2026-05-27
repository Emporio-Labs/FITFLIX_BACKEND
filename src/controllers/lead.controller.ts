import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { LeadStatus } from "../models/Enums";
import Lead from "../models/Lead";
import User from "../models/User";
import { calculateHealthScore } from "../utils/health-score";
import { hashPassword } from "../utils/password";
import {
	convertLeadBodySchema,
	createLeadBodySchema,
	publicLeadCaptureBodySchema,
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
		const lead = await Lead.create({
			...leadData,
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

	const resolvedLeadName = personalDetails?.fullName ?? leadName ?? name;
	const resolvedEmail = personalDetails?.emailAddress ?? email;
	const resolvedPhone = personalDetails?.phoneNumber ?? phone;
	const resolvedInterest =
		personalDetails?.primaryHealthGoal ??
		interestedIn ??
		(normalizedCallbackInterests.length > 0
			? normalizedCallbackInterests.join(", ")
			: undefined);

	if (!resolvedLeadName || !resolvedEmail) {
		res.status(400).json({
			message:
				"Missing required identity fields: leadName/email or personalDetails.fullName/emailAddress",
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
						email: resolvedEmail,
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
			email: resolvedEmail,
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
		const { source, status, tags } = req.query;
		const filter: Record<string, unknown> = {};

		if (typeof source === "string" && source) {
			filter.source = source;
		}
		if (typeof status === "string" && status) {
			filter.status = status;
		}
		if (typeof tags === "string" && tags) {
			filter.tags = { $in: tags.split(",").map((t) => t.trim()).filter(Boolean) };
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

		const existingUser = await User.findOne({ email: lead.email });

		if (existingUser) {
			lead.status = LeadStatus.Converted;
			lead.convertedUser = existingUser._id;
			await lead.save();

			res.status(200).json({
				message: "Lead linked to existing user",
				lead,
				userId: existingUser._id,
			});
			return;
		}

		const { username, phone, age, gender, healthGoals, password } =
			parsedBody.data;
		const passwordHash = await hashPassword(password);

		const createdUser = await User.create({
			username: username ?? lead.leadName,
			phone,
			email: lead.email,
			age: Number(age),
			gender,
			healthGoals,
			passwordHash,
		});

		lead.status = LeadStatus.Converted;
		lead.convertedUser = createdUser._id;
		await lead.save();

		res.status(201).json({
			message: "Lead converted to user",
			lead,
			user: {
				id: createdUser._id,
				email: createdUser.email,
				role: "user" as const,
			},
		});
	} catch (error) {
		next(error);
	}
};
