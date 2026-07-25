import type { RequestHandler } from "express";
import mongoose from "mongoose";
import ConsentForm from "../models/ConsentForm";
import {
	type Gender,
	OnboardingStep,
} from "../models/Enums";
import HealthGoals from "../models/HealthGoals";
import HealthMarkers from "../models/HealthMarkers";
import HpodMetric from "../models/HpodMetric";
import { HpodReport } from "../models/Hpodreport.model";
import MedicalReport from "../models/MedicalReport";
import User from "../models/User";
import { buildApiErrorEnvelope } from "../utils/api-error";
import { hashPassword, verifyPassword } from "../utils/password";
import { generateSignedUrl } from "../utils/s3.service";
import {
	createUserBodySchema,
	listUsersQuerySchema,
	updateMyPasswordBodySchema,
	updateUserBodySchema,
} from "../validators/user.validator";

const canOnboard = (
	requester: Express.Request["user"],
	targetUserId: string,
) => {
	if (!requester) return false;
	if (requester.role === "admin") return true;
	return requester.role === "user" && requester.id === targetUserId;
};

const canUpdateUser = (
	requester: Express.Request["user"],
	targetUserId: string,
) => {
	if (!requester) return false;
	if (requester.role === "admin") return true;
	return requester.role === "user" && requester.id === targetUserId;
};

const getValidationDetails = (
	issues: Array<{ path: PropertyKey[]; message: string }>,
) => {
	const details: Record<string, string> = {};

	for (const issue of issues) {
		const field = issue.path.length > 0 ? issue.path.join(".") : "body";
		if (!details[field]) {
			details[field] = issue.message;
		}
	}

	return details;
};

const getStringArray = (value: unknown): string[] => {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter(Boolean);
};

const buildReportSuggestions = (
	aiSummary: Record<string, unknown> | null,
): string[] => {
	if (!aiSummary) {
		return [];
	}

	const suggestions = getStringArray(aiSummary.suggestions);
	if (suggestions.length > 0) {
		return suggestions;
	}

	const recommendations = getStringArray(aiSummary.recommendations);
	if (recommendations.length > 0) {
		return recommendations;
	}

	const insights = getStringArray(aiSummary.insights);
	if (insights.length > 0) {
		return insights;
	}

	const concerns = getStringArray(aiSummary.concerns);
	if (concerns.length > 0) {
		return concerns.map((concern) => `Follow up on: ${concern}`);
	}

	return [];
};

const buildReportSummary = (
	aiSummary: Record<string, unknown> | null,
): string => {
	if (!aiSummary) {
		return "Your personalized report summary is being generated.";
	}

	if (
		typeof aiSummary.healthInsight === "string" &&
		aiSummary.healthInsight.trim().length > 0
	) {
		return aiSummary.healthInsight.trim();
	}

	if (
		typeof aiSummary.summary === "string" &&
		aiSummary.summary.trim().length > 0
	) {
		return aiSummary.summary.trim();
	}

	return "Your personalized report summary is being generated.";
};

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (
		typeof idParam !== "string" ||
		!mongoose.Types.ObjectId.isValid(idParam)
	) {
		return null;
	}

	return idParam;
};

export const createUser: RequestHandler = async (req, res, next) => {
	const parsedBody = createUserBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsedBody.error.issues),
		});
		return;
	}

	const { password, onboarded = false, email, phone, ...rest } = parsedBody.data;

	try {
		const passwordHash = password ? await hashPassword(password) : undefined;
		const sanitizedEmail = (email && typeof email === "string" && email.trim() !== "") ? email.trim() : undefined;
		const last10 = phone.replace(/\D/g, "").slice(-10);

		// Enforce phone number uniqueness:
		const existingPhoneUser = await User.findOne({
			phone: { $regex: new RegExp(last10 + "$") },
		}).select("_id");

		if (existingPhoneUser) {
			res.status(409).json({
				error: "User with this phone number already exists",
				code: "CONFLICT",
			});
			return;
		}

		if (sanitizedEmail) {
			const existingUser = await User.findOne({
				email: sanitizedEmail,
			}).select("_id");

			if (existingUser) {
				res.status(409).json({
					error: "User with this email already exists",
					code: "CONFLICT",
				});
				return;
			}
		}

		const user = await User.create({
			...rest,
			gender: rest.gender as Gender,
			phone: last10,
			email: sanitizedEmail,
			onboarded,
			passwordHash,
			// Explicitly initialise onboardingStatus so the sub-document is
			// always present when the user first hits GET /onboarding/status.
			onboardingStatus: {
				currentStep: OnboardingStep.HEALTH_MARKERS,
				completedSteps: [],
				healthMarkersCompleted: false,
				healthGoalsCompleted: false,
				consentCompleted: false,
				reportsUploaded: false,
				onboardingCompleted: false,
				startedAt: new Date(),
			},
		});

		console.log("[POST /users] User created successfully:", {
			userId: user._id,
			email: user.email,
			onboarded: user.onboarded,
		});

		res.status(201).json({ message: "User created", user });
	} catch (error) {
		console.error("[POST /users] Error creating user:", error);
		next(error);
	}
};

export const getAllUsers: RequestHandler = async (req, res, next) => {
	const parsed = listUsersQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const { search, status, page, limit, sort, order } = parsed.data;

		const filter: Record<string, unknown> = {};
		if (search) {
			const searchRegex = new RegExp(search, "i");
			filter.$or = [
				{ username: { $regex: searchRegex } },
				{ email: { $regex: searchRegex } },
				{ phone: { $regex: searchRegex } },
			];
		}

		const sortOrder = order === "asc" ? 1 : -1;
		const sortField = sort;

		const aggregatePipeline: mongoose.PipelineStage[] = [
			{ $match: filter },
		];

		aggregatePipeline.push(
			// ── HealthMarkers lookup (one-to-one, userId unique index) ──────────
			{
				$lookup: {
					from: "healthmarkers",
					let: { uid: "$_id" },
					pipeline: [
						{ $match: { $expr: { $eq: ["$userId", "$$uid"] } } },
						{
							$project: {
								_id: 0,
								weight: 1,
								height: 1,
								gender: 1,
								activityLevel: 1,
								bmi: 1,
								bodyFatPct: "$bodyFatPercentage",
							},
						},
					],
					as: "_healthMarkersDocs",
				},
			},
			// ── HealthGoals lookup (one-to-one, userId unique index) ─────────────
			{
				$lookup: {
					from: "healthgoals",
					let: { uid: "$_id" },
					pipeline: [
						{ $match: { $expr: { $eq: ["$userId", "$$uid"] } } },
						{ $project: { _id: 0, goals: 1, targetWeight: 1 } },
					],
					as: "_healthGoalsDocs",
				},
			},
		);

		// Sort → paginate → project (order matters: filter/lookup before sort+paginate)
		aggregatePipeline.push(
			{ $sort: { [sortField]: sortOrder } },
			{ $skip: (page - 1) * limit },
			{ $limit: limit },
			{
				$project: {
					_id: 1,
					username: 1,
					email: 1,
					phone: 1,
					age: 1,
					gender: 1,
					createdAt: 1,
					updatedAt: 1,
					onboardingStatus: {
						currentStep: "$onboardingStatus.currentStep",
						completedSteps: {
							$ifNull: ["$onboardingStatus.completedSteps", []],
						},
						healthMarkersCompleted: {
							$ifNull: ["$onboardingStatus.healthMarkersCompleted", false],
						},
						healthGoalsCompleted: {
							$ifNull: ["$onboardingStatus.healthGoalsCompleted", false],
						},
						consentCompleted: {
							$ifNull: ["$onboardingStatus.consentCompleted", false],
						},
						reportsUploaded: {
							$ifNull: ["$onboardingStatus.reportsUploaded", false],
						},


						onboardingCompleted: {
							$ifNull: ["$onboardingStatus.onboardingCompleted", false],
						},
					},
					bookingStatus: 1,
					expertAppointments: {
						$cond: {
							if: "$unifiedAppointment",
							then: ["$unifiedAppointment"],
							else: [],
						},
					},
					// Shape healthMarkers: merge first lookup element with targetWeight from healthGoals
					healthMarkers: {
						$mergeObjects: [
							{
								$cond: [
									{ $gt: [{ $size: "$_healthMarkersDocs" }, 0] },
									{ $arrayElemAt: ["$_healthMarkersDocs", 0] },
									{},
								],
							},
							{
								targetWeight: {
									$ifNull: [
										{ $arrayElemAt: ["$_healthGoalsDocs.targetWeight", 0] },
										null,
									],
								},
							},
						],
					},
					// Shape healthGoals: goals[] from first element, or empty array
					healthGoals: {
						$cond: [
							{ $gt: [{ $size: "$_healthGoalsDocs" }, 0] },
							{ $arrayElemAt: ["$_healthGoalsDocs.goals", 0] },
							{ $ifNull: ["$healthGoals", []] },
						],
					},
				},
			},
		);

		const [users, total] = await Promise.all([
			User.aggregate(aggregatePipeline).exec(),
			User.countDocuments(filter),
		]);

		res.status(200).json({
			users,
			pagination: {
				page,
				limit,
				total,
				totalPages: Math.ceil(total / limit),
			},
		});
	} catch (error) {
		next(error);
	}
};

export const getMyUser: RequestHandler = async (req, res, next) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({
			error: "Only users can access this endpoint",
			code: "FORBIDDEN",
		});
		return;
	}

	try {
		const user = await User.findById(req.user.id);

		if (!user) {
			res.status(404).json({
				error: "User not found",
				code: "NOT_FOUND",
			});
			return;
		}

		const healthMarkers = await HealthMarkers.findOne({ userId: req.user.id });
		const userObj = user.toJSON();
		const userWithWeight = {
			...userObj,
			weight: healthMarkers?.weight ?? null,
		};

		res.status(200).json({ user: userWithWeight });
	} catch (error) {
		next(error);
	}
};

export const getUserById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (req.user?.role === "user" && req.user.id !== id) {
		res.status(403).json({
			error: "Forbidden",
			code: "FORBIDDEN",
		});
		return;
	}

	if (!id) {
		if (process.env.NODE_ENV !== "production") {
			console.warn("[getUserById] invalid id", {
				raw: req.params.id,
				role: req.user?.role,
				requestingUser: req.user?.id,
			});
		}
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: { id: "Invalid user id" },
		});
		return;
	}

	try {
		const user = await User.findById(id);

		if (!user) {
			if (process.env.NODE_ENV !== "production") {
				console.warn("[getUserById] user not found", {
					id,
					role: req.user?.role,
					requestingUser: req.user?.id,
				});
			}
			res.status(404).json({
				error: "User not found",
				code: "NOT_FOUND",
			});
			return;
		}

		const [healthMarkersRaw, healthGoals, reports] = await Promise.all([
			HealthMarkers.findOne({ userId: id }),
			HealthGoals.findOne({ userId: id }),
			MedicalReport.find({ userId: id }).sort({ uploadedAt: -1 }),
		]);

		let computedBmi = healthMarkersRaw?.bmi;
		if (
			healthMarkersRaw &&
			!computedBmi &&
			healthMarkersRaw.weight &&
			healthMarkersRaw.height
		) {
			const heightInMeters = healthMarkersRaw.height / 100;
			computedBmi = Number(
				(healthMarkersRaw.weight / (heightInMeters * heightInMeters)).toFixed(
					1,
				),
			);
		}

		const userObj = user.toJSON();
		const userWithAppointments = {
			...userObj,
			expertAppointments: [],
		};

		res.status(200).json({
			success: true,
			data: {
				user: userWithAppointments,
				onboarding: user.onboardingStatus ?? null,
				healthMarkers: {
					weight: healthMarkersRaw?.weight
						? `${healthMarkersRaw.weight}kg`
						: null,
					height: healthMarkersRaw?.height
						? `${healthMarkersRaw.height}cm`
						: null,
					age: user.age ?? null,
					goal: healthGoals?.goals?.[0] ?? null,
					gender: user.gender ?? null,
					bmi: computedBmi ?? null,
					activityLevel: healthMarkersRaw?.activityLevel ?? null,
					targetWeight: healthGoals?.targetWeight
						? `${healthGoals.targetWeight}kg`
						: null,
					bodyFatPct: healthMarkersRaw?.bodyFatPercentage ?? null,
					bodyFatPercentage: healthMarkersRaw?.bodyFatPercentage ?? null,
				},
				goals: healthGoals?.goals ?? [],
				reports,
			},
		});
	} catch (error) {
		next(error);
	}
};

export const getOnboardingProfile: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (req.user?.role === "user" && req.user.id !== id) {
		res.status(403).json({
			error: "Forbidden",
			code: "FORBIDDEN",
		});
		return;
	}

	if (!id) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: { id: "Invalid user id" },
		});
		return;
	}

	try {
		const user = await User.findById(id).select(
			"username email age gender onboarded onboardingStatus",
		);

		if (!user) {
			res.status(404).json({
				error: "User not found",
				code: "NOT_FOUND",
			});
			return;
		}

		const [healthMarkers, healthGoals, consent, reports] =
			await Promise.all([
				HealthMarkers.findOne({ userId: id }),
				HealthGoals.findOne({ userId: id }),
				ConsentForm.findOne({ userId: id }),
				MedicalReport.find({ userId: id }).sort({ uploadedAt: -1 }),
			]);

		const status = user.onboardingStatus;
		const onboardingStatus = {
			currentStep: status?.currentStep ?? "HEALTH_MARKERS",
			completedSteps: status?.completedSteps ?? [],
			isCompleted: Boolean(status?.onboardingCompleted),
		};

		const reportsWithUrls = await Promise.all(
			reports.map(async (report) => {
				const r = report.toObject();
				// Strip direct bucket domain if it was stored previously
				if (
					r.reportUrl &&
					(r.reportUrl.includes(".amazonaws.com") ||
						r.reportUrl.includes("fitflix-storage"))
				) {
					r.reportUrl = undefined;
				}
				if (r.s3Key) {
					try {
						r.reportUrl = await generateSignedUrl(r.s3Key, 900, r.mimeType);
					} catch (err) {
						console.error(
							`[S3_SIGNING_ERROR] Failed to generate signed URL for key ${r.s3Key} in getOnboardingProfile:`,
							err,
						);
						r.reportUrl = undefined;
					}
				}
				return r;
			}),
		);

		res.status(200).json({
			user,
			onboardingStatus,
			healthMarkers: healthMarkers ?? null,
			healthGoals: healthGoals ?? null,
			consents: consent?.consents ?? [],
			reports: reportsWithUrls,
			appointments: [],
		});
	} catch (error) {
		next(error);
	}
};

export const getReportSignedUrl: RequestHandler = async (req, res, next) => {
	const userId = getIdParam(req.params.id);
	const reportId = getIdParam(req.params.reportId);

	if (!userId || !reportId) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: { id: "Invalid user id or report id" },
		});
		return;
	}

	try {
		const report = await MedicalReport.findOne({ _id: reportId, userId });

		if (!report) {
			res.status(404).json({ error: "Report not found", code: "NOT_FOUND" });
			return;
		}

		if (!report.s3Key) {
			res.status(404).json({
				error: "No file is attached to this report",
				code: "NOT_FOUND",
			});
			return;
		}

		const url = await generateSignedUrl(report.s3Key);
		res.status(200).json({ url, expiresIn: 3600 });
	} catch (error) {
		next(error);
	}
};

export const updateUserById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: { id: "Invalid user id" },
		});
		return;
	}

	if (!req.user || !canUpdateUser(req.user, id)) {
		res.status(403).json({
			error: "Forbidden",
			code: "FORBIDDEN",
		});
		return;
	}

	const parsedBody = updateUserBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsedBody.error.issues),
		});
		return;
	}

	if (req.user.role === "user" && parsedBody.data.password) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: {
				password: "Use PATCH /users/me/password to change password",
			},
		});
		return;
	}

	try {
		const { password, email, phone, ...rest } = parsedBody.data;
		const sanitizedEmail = (email && typeof email === "string" && email.trim() !== "") ? email.trim() : undefined;
		const normalizedPhone = phone ? phone.replace(/\D/g, "").slice(-10) : undefined;

		if (normalizedPhone) {
			const existingPhoneUser = await User.findOne({
				phone: { $regex: new RegExp(normalizedPhone + "$") },
				_id: { $ne: id },
			}).select("_id");

			if (existingPhoneUser) {
				res.status(409).json({
					error: "User with this phone number already exists",
					code: "CONFLICT",
				});
				return;
			}
		}

		if (sanitizedEmail) {
			const existingUser = await User.findOne({
				email: sanitizedEmail,
				_id: { $ne: id },
			}).select("_id");

			if (existingUser) {
				res.status(409).json({
					error: "User with this email already exists",
					code: "CONFLICT",
				});
				return;
			}
		}

		const hashedPassword = password ? await hashPassword(password) : null;
		const updatePayload = {
			...rest,
			email: sanitizedEmail,
			...(normalizedPhone ? { phone: normalizedPhone } : {}),
			...(hashedPassword ? { passwordHash: hashedPassword } : {}),
		};

		const updatedUser = await User.findByIdAndUpdate(id, updatePayload, {
			returnDocument: "after",
			runValidators: true,
		});

		if (!updatedUser) {
			res.status(404).json({
				error: "User not found",
				code: "NOT_FOUND",
			});
			return;
		}

		res.status(200).json({ user: updatedUser });
	} catch (error) {
		next(error);
	}
};

export const deleteUserById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: { id: "Invalid user id" },
		});
		return;
	}

	try {
		const deletedUser = await User.findByIdAndDelete(id);

		if (!deletedUser) {
			res.status(404).json({
				error: "User not found",
				code: "NOT_FOUND",
			});
			return;
		}

		res.status(200).json({ message: "User deleted" });
	} catch (error) {
		next(error);
	}
};

// Allow a user to mark themselves onboarded (or admin to onboard any user)
export const onboardUser: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: { id: "Invalid user id" },
		});
		return;
	}

	if (!req.user || !canOnboard(req.user, id)) {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}

	const parsedBody = updateUserBodySchema.safeParse({
		...req.body,
		onboarded: true,
	});

	if (!parsedBody.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsedBody.error.issues),
		});
		return;
	}

	const { password, ...rest } = parsedBody.data;
	const hashedPassword = password ? await hashPassword(password) : null;
	const updatePayload = {
		...rest,
		...(hashedPassword ? { passwordHash: hashedPassword } : {}),
	};

	try {
		const updatedUser = await User.findByIdAndUpdate(id, updatePayload, {
			returnDocument: "after",
			runValidators: true,
		});

		if (!updatedUser) {
			res.status(404).json({
				error: "User not found",
				code: "NOT_FOUND",
			});
			return;
		}

		res.status(200).json({
			message: "User onboarded",
			user: updatedUser,
		});
	} catch (error) {
		next(error);
	}
};

export const updateMyPassword: RequestHandler = async (req, res, next) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({
			error: "Only users can access this endpoint",
			code: "FORBIDDEN",
		});
		return;
	}

	const parsedBody = updateMyPasswordBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsedBody.error.issues),
		});
		return;
	}

	try {
		const user = await User.findById(req.user.id).select("+passwordHash");

		if (!user) {
			res.status(404).json({
				error: "User not found",
				code: "NOT_FOUND",
			});
			return;
		}

		const isCurrentPasswordValid = await verifyPassword(
			parsedBody.data.currentPassword,
			user.passwordHash ?? "",
		);

		if (!isCurrentPasswordValid) {
			res.status(401).json({
				error: "Current password is incorrect",
				code: "UNAUTHORIZED",
			});
			return;
		}

		user.passwordHash = await hashPassword(parsedBody.data.newPassword);
		await user.save();

		res.status(200).json({ message: "Password updated successfully" });
	} catch (error) {
		next(error);
	}
};

export const getMyUserReports: RequestHandler = async (req, res, next) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({
			error: "Only users can access this endpoint",
			code: "FORBIDDEN",
		});
		return;
	}

	try {
		const [hpodReports, medicalReports] = await Promise.all([
			HpodReport.find({ userId: req.user.id }).sort({ receivedAt: -1 }),
			MedicalReport.find({ userId: req.user.id }).sort({ uploadedAt: -1 }),
		]);

		const origin = `${req.protocol}://${req.get("host") ?? "localhost"}`;

		// Format HPOD Reports
		const formattedHpod = hpodReports.map((report) => {
			const reportId = report._id.toString();
			const aiSummary =
				report.aiSummary && typeof report.aiSummary === "object"
					? (report.aiSummary as Record<string, unknown>)
					: null;
			const suggestions = buildReportSuggestions(aiSummary);
			const generatedDate = report.summaryGeneratedAt ?? report.receivedAt;
			const title = report.subject?.trim()
				? report.subject
				: `Health report ${generatedDate.toISOString().slice(0, 10)}`;

			return {
				id: reportId,
				title,
				type: "HPOD",
				summary: buildReportSummary(aiSummary),
				suggestions,
				recommendations: suggestions,
				insights: suggestions,
				generated_date: generatedDate.toISOString(),
				pdf_url: `${origin}/users/me/reports/${reportId}/pdf`,
			};
		});

		// Format Medical Reports (including DNA, Blood Test, etc.)
		const formattedMedical = await Promise.all(
			medicalReports.map(async (report) => {
				const reportId = report._id.toString();
				let reportUrl: string | undefined;
				if (report.s3Key) {
					try {
						reportUrl = await generateSignedUrl(
							report.s3Key,
							900,
							report.mimeType,
						);
					} catch (err) {
						console.error(
							`[S3_SIGNING_ERROR] Failed to generate signed URL for key ${report.s3Key} in getMyUserReports:`,
							err,
						);
						reportUrl = undefined;
					}
				}

				return {
					id: reportId,
					title: report.reportName,
					type: report.reportType, // E.g., "DNA", "Blood Test"
					summary: `Uploaded ${report.reportType} report`,
					suggestions: [],
					recommendations: [],
					insights: [],
					generated_date: (report.uploadedAt ?? report.createdAt).toISOString(),
					pdf_url: reportUrl,
				};
			}),
		);

		// Combine and sort by date descending
		const allReports = [...formattedHpod, ...formattedMedical].sort(
			(a, b) =>
				new Date(b.generated_date).getTime() -
				new Date(a.generated_date).getTime(),
		);

		res.status(200).json({ reports: allReports });
	} catch (error) {
		next(error);
	}
};

export const getMyMedicalReports: RequestHandler = async (req, res, next) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({
			error: "Only users can access this endpoint",
			code: "FORBIDDEN",
		});
		return;
	}

	try {
		const reports = await MedicalReport.find({ userId: req.user.id }).sort({
			uploadedAt: -1,
		});

		const reportsWithUrls = await Promise.all(
			reports.map(async (report) => {
				const r = report.toObject();
				if (
					r.reportUrl &&
					(r.reportUrl.includes(".amazonaws.com") ||
						r.reportUrl.includes("fitflix-storage"))
				) {
					r.reportUrl = undefined;
				}
				if (r.s3Key) {
					try {
						r.reportUrl = await generateSignedUrl(r.s3Key, 900, r.mimeType);
					} catch (err) {
						console.error(
							`[S3_SIGNING_ERROR] Failed to generate signed URL for key ${r.s3Key} in getMyMedicalReports:`,
							err,
						);
						r.reportUrl = undefined;
					}
				}
				return r;
			}),
		);

		res.status(200).json({ reports: reportsWithUrls });
	} catch (error) {
		next(error);
	}
};

export const getMyUserHpodMetrics: RequestHandler = async (req, res, next) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({
			error: "Only users can access this endpoint",
			code: "FORBIDDEN",
		});
		return;
	}

	try {
		const history = await HpodMetric.find({ userId: req.user.id })
			.sort({ recordedAt: -1 })
			.select("-gmailMessageId -userId -__v");

		res.status(200).json({ history });
	} catch (error) {
		next(error);
	}
};

export const uploadHpodMetrics: RequestHandler = async (req, res, next) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({
			error: "Only users can access this endpoint",
			code: "FORBIDDEN",
		});
		return;
	}

	try {
		const { weight_kg, body_fat_percent, skeletal_muscle_mass_kg, age } = req.body;

		if (
			weight_kg === undefined ||
			body_fat_percent === undefined ||
			skeletal_muscle_mass_kg === undefined ||
			age === undefined
		) {
			res.status(400).json({
				error: "All fields (weight_kg, body_fat_percent, skeletal_muscle_mass_kg, age) are required",
				code: "BAD_REQUEST",
			});
			return;
		}

		const metric = new HpodMetric({
			userId: req.user.id,
			recordedAt: new Date(),
			receivedAt: new Date(),
			age: age ? age.toString() : null,
			source: "manual",
			vitals: {
				weight_kg: Number(weight_kg),
				height_cm: null,
				bmi: null,
				bmi_category: null,
				spo2_percent: null,
				body_temperature_f: null,
				pulse: null,
				blood_pressure: null,
			},
			bodyComposition: {
				body_fat_mass_kg: null,
				body_fat_percent: Number(body_fat_percent),
				total_body_water_L: null,
				protein_kg: null,
				minerals_kg: null,
				skeletal_muscle_mass_kg: Number(skeletal_muscle_mass_kg),
				visceral_fat_cm2: null,
				basal_metabolic_rate_cal: null,
				intracellular_water_L: null,
				extracellular_water_L: null,
			},
			ecg: {
				pr_interval: null,
				qrs_interval: null,
				qtc_interval: null,
				heart_rate: null,
			},
			idealBodyWeight_kg: null,
			weightToLose_kg: null,
			testsNotTaken: [],
			healthInsight: "",
			concerns: [],
		});

		await metric.save();

		res.status(201).json({
			success: true,
			metric,
		});
	} catch (error) {
		next(error);
	}
};

export const getMyUserReportPdf: RequestHandler = async (req, res, next) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({
			error: "Only users can access this endpoint",
			code: "FORBIDDEN",
		});
		return;
	}

	const reportId = getIdParam(req.params.id);

	if (!reportId) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: { id: "Invalid report id" },
		});
		return;
	}

	try {
		const report =
			await HpodReport.findById(reportId).select("_id userId hasPdf");

		if (!report) {
			res.status(404).json({
				error: "Report not found",
				code: "NOT_FOUND",
			});
			return;
		}

		if (!report.userId || report.userId.toString() !== req.user.id) {
			res.status(403).json({
				error: "Not authorized to access this report",
				code: "FORBIDDEN",
			});
			return;
		}

		res.status(501).json(
			buildApiErrorEnvelope({
				error: "Report PDF endpoint is not available yet",
				code: "NOT_IMPLEMENTED",
				details: {
					id: reportId,
					hasPdf: report.hasPdf,
				},
			}),
		);
	} catch (error) {
		next(error);
	}
};
