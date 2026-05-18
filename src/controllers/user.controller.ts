import type { RequestHandler } from "express";
import mongoose from "mongoose";
import HpodMetric from "../models/HpodMetric";
import { HpodReport } from "../models/Hpodreport.model";
import User from "../models/User";
import HealthMarkers from "../models/HealthMarkers";
import HealthGoals from "../models/HealthGoals";
import ConsentForm from "../models/ConsentForm";
import MedicalReport from "../models/MedicalReport";
import ExpertAppointment from "../models/ExpertAppointment";
import { buildApiErrorEnvelope } from "../utils/api-error";
import { hashPassword, verifyPassword } from "../utils/password";
import {
	createUserBodySchema,
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
	issues: Array<{ path: Array<string | number>; message: string }>,
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
	console.log("[POST /users] Incoming user payload:", req.body);

	const parsedBody = createUserBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		const details = getValidationDetails(parsedBody.error.issues);
		console.warn("[POST /users] Validation failed:", {
			details,
			issues: parsedBody.error.issues,
			receivedKeys: Object.keys(req.body ?? {}),
		});
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details,
		});
		return;
	}

	const { password, onboarded = false, ...rest } = parsedBody.data;

	try {
		const passwordHash = await hashPassword(password);

		const existingUser = await User.findOne({
			email: parsedBody.data.email,
		}).select("_id");

		if (existingUser) {
			res.status(409).json({
				error: "User with this email already exists",
				code: "CONFLICT",
			});
			return;
		}

		const user = await User.create({
			...rest,
			onboarded,
			passwordHash,
		});

		res.status(201).json({ message: "User created", user });
	} catch (error) {
		next(error);
	}
};

export const getAllUsers: RequestHandler = async (_req, res, next) => {
	try {
		const users = await User.find();
		res.status(200).json({ users });
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

		res.status(200).json({ user });
	} catch (error) {
		next(error);
	}
};

export const getUserById: RequestHandler = async (req, res, next) => {
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
		const user = await User.findById(id);

		if (!user) {
			res.status(404).json({
				error: "User not found",
				code: "NOT_FOUND",
			});
			return;
		}

		res.status(200).json({ user });
	} catch (error) {
		next(error);
	}
};

export const getOnboardingProfile: RequestHandler = async (req, res, next) => {
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

		const [healthMarkers, healthGoals, consent, reports, appointments] =
			await Promise.all([
				HealthMarkers.findOne({ userId: id }),
				HealthGoals.findOne({ userId: id }),
				ConsentForm.findOne({ userId: id }),
				MedicalReport.find({ userId: id }).sort({ uploadedAt: -1 }),
				ExpertAppointment.find({ userId: id }).populate(
					"userId",
					"username email phone",
				),
			]);

		res.status(200).json({
			user,
			healthMarkers: healthMarkers ?? null,
			healthGoals: healthGoals ?? null,
			consents: consent?.consents ?? [],
			reports,
			appointments,
		});
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
		if (parsedBody.data.email) {
			const existingUser = await User.findOne({
				email: parsedBody.data.email,
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

		const { password, ...rest } = parsedBody.data;
		const hashedPassword = password ? await hashPassword(password) : null;
		const updatePayload = {
			...rest,
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
			user.passwordHash,
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
		const reports = await HpodReport.find({ userId: req.user.id })
			.sort({ receivedAt: -1 })
			.select("subject aiSummary summaryGeneratedAt receivedAt hasPdf userId");

		const origin = `${req.protocol}://${req.get("host") ?? "localhost"}`;
		const normalizedReports = reports.map((report) => {
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
				summary: buildReportSummary(aiSummary),
				suggestions,
				recommendations: suggestions,
				insights: suggestions,
				generated_date: generatedDate.toISOString(),
				pdf_url: `${origin}/users/me/reports/${reportId}/pdf`,
			};
		});

		res.status(200).json({ reports: normalizedReports });
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
