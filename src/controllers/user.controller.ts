import type { RequestHandler } from "express";
import mongoose from "mongoose";
import ConsentForm from "../models/ConsentForm";
import ExpertAppointment from "../models/ExpertAppointment";
import NutritionistBooking from "../models/NutritionistBooking";
import { type Gender, OnboardingStep } from "../models/Enums";
import HealthGoals from "../models/HealthGoals";
import HealthMarkers from "../models/HealthMarkers";
import BcaMetric from "../models/BcaMetric";
import MedicalReport from "../models/MedicalReport";
import Membership from "../models/Membership";
import Trainer from "../models/Trainer";
import User from "../models/User";
import { buildActivePtMembershipFilter } from "../utils/membership-status.util";
import {
	ActiveXError,
	fetchBcaRecords,
	upsertBcaRecordForUser,
} from "../utils/activex.service";
import { buildApiErrorEnvelope } from "../utils/api-error";
import { hashPassword, verifyPassword } from "../utils/password";
import { isEmailInUseAcrossSystem } from "../utils/email-uniqueness";
import { generateSignedUrl } from "../utils/s3.service";
import {
	assignTrainerBodySchema,
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

	const {
		password,
		onboarded = false,
		email,
		phone,
		...rest
	} = parsedBody.data;

	try {
		const passwordHash = password ? await hashPassword(password) : undefined;
		const sanitizedEmail =
			email && typeof email === "string" && email.trim() !== ""
				? email.trim()
				: undefined;
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
			const emailCheck = await isEmailInUseAcrossSystem(sanitizedEmail);
			if (emailCheck.exists) {
				res.status(409).json({
					error: `An account with this email already exists as a ${emailCheck.accountType}`,
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
				nutritionistBooked: false,
				activeXTestCompleted: false,
				dnaSampleCompleted: false,
				valdTestCompleted: false,
				sportsScientistBooked: false,
				planTrainerAssignmentCompleted: false,
				appOnboardingCompleted: false,
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

		const aggregatePipeline: mongoose.PipelineStage[] = [{ $match: filter }];

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
			// ── Latest active NutritionistBooking (drives expertAppointments[]) ──
			// The frontend admin roster reads slot time / mode / assigned name from
			// this. Without the lookup, the $unifiedAppointment reference below
			// stays undefined and every row's expertAppointments comes back empty.
			{
				$lookup: {
					from: "nutritionistbookings",
					let: { uid: "$_id" },
					pipeline: [
						{
							$match: {
								$expr: { $eq: ["$userId", "$$uid"] },
								status: { $nin: ["REJECTED", "CANCELLED"] },
							},
						},
						{ $sort: { createdAt: -1 } },
						{ $limit: 1 },
						{
							$project: {
								_id: 1,
								userId: 1,
								expertType: { $literal: "nutritionist" },
								// Map backend enum (PENDING/ACCEPTED/…) to the casing the
								// frontend ExpertAppointment type expects.
								bookingStatus: {
									$switch: {
										branches: [
											{
												case: { $eq: ["$status", "ACCEPTED"] },
												then: "Confirmed",
											},
											{
												case: { $eq: ["$status", "COMPLETED"] },
												then: "Completed",
											},
											{
												case: { $eq: ["$status", "REJECTED"] },
												then: "Cancelled",
											},
											{
												case: { $eq: ["$status", "RESCHEDULE_REQUIRED"] },
												then: "RescheduleRequired",
											},
											{
												case: { $eq: ["$status", "EXPIRED"] },
												then: "Expired",
											},
										],
										default: "Pending",
									},
								},
								appointmentDate: "$bookingDate",
								startTime: 1,
								endTime: 1,
								// Legacy field the current formatBookingTime still reads.
								appointmentStart: "$startTime",
								appointmentMode: 1,
								assignedNutritionistName: 1,
								zegoRoomId: 1,
								meetingLink: 1,
								createdAt: 1,
							},
						},
					],
					as: "_nutritionistBooking",
				},
			},
			{
				$addFields: {
					unifiedAppointment: { $arrayElemAt: ["$_nutritionistBooking", 0] },
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
					onboarded: {
						$ifNull: ["$onboarded", "$onboardingStatus.onboardingCompleted"],
					},
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
						activeXTestCompleted: {
							$ifNull: ["$onboardingStatus.activeXTestCompleted", false],
						},
						dnaSampleCompleted: {
							$ifNull: ["$onboardingStatus.dnaSampleCompleted", false],
						},
						valdTestCompleted: {
							$ifNull: ["$onboardingStatus.valdTestCompleted", false],
						},
						sportsScientistBooked: {
							$ifNull: ["$onboardingStatus.sportsScientistBooked", false],
						},
						nutritionistBooked: {
							$ifNull: ["$onboardingStatus.nutritionistBooked", false],
						},
						planTrainerAssignmentCompleted: {
							$ifNull: [
								"$onboardingStatus.planTrainerAssignmentCompleted",
								false,
							],
						},
						appOnboardingCompleted: {
							$ifNull: ["$onboardingStatus.appOnboardingCompleted", false],
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

		const [
			healthMarkers,
			healthGoals,
			consent,
			reports,
			nutritionistAppointments,
			sportsScientistAppointments,
		] = await Promise.all([
			HealthMarkers.findOne({ userId: id }),
			HealthGoals.findOne({ userId: id }),
			ConsentForm.findOne({ userId: id }),
			MedicalReport.find({ userId: id }).sort({ uploadedAt: -1 }),
			NutritionistBooking.find({ userId: id, status: { $ne: "REJECTED" } })
				.sort({ createdAt: -1 })
				.lean(),
			ExpertAppointment.find({
				userId: id,
				expertType: "sports_scientist",
				bookingStatus: { $ne: "Cancelled" },
			})
				.sort({ createdAt: -1 })
				.lean(),
		]);

		const status = user.onboardingStatus;
		// Return the complete shared status object. The member app and
		// front-desk profile must read the same flags, not a reduced legacy
		// projection that drops the physical-test fields.
		const onboardingStatus = status ?? null;

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
			appointments: [
				...nutritionistAppointments.map((appointment) => ({
					id: appointment._id.toString(),
					_id: appointment._id.toString(),
					userId: id,
					expertType: "nutritionist",
					bookingStatus: appointment.status,
					appointmentDate: appointment.bookingDate,
					appointmentStart: appointment.startTime,
					startTime: appointment.startTime,
					endTime: appointment.endTime,
					meetingLink: null,
					meetingUrl: null,
					zegoRoomId: appointment.zegoRoomId ?? null,
					appointmentMode: appointment.appointmentMode,
					assignedNutritionistName:
						appointment.assignedNutritionistName ?? null,
				})),
				...sportsScientistAppointments.map((appointment) => ({
					id: appointment._id.toString(),
					_id: appointment._id.toString(),
					userId: id,
					expertType: appointment.expertType,
					bookingStatus: appointment.bookingStatus,
					appointmentDate: appointment.appointmentDate,
					appointmentStart: appointment.startTime,
					startTime: appointment.startTime,
					endTime: appointment.endTime,
					meetingLink: appointment.meetingLink ?? null,
					meetingUrl: appointment.meetingLink ?? null,
					appointmentMode: appointment.appointmentMode,
				})),
			],
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
		const sanitizedEmail =
			email && typeof email === "string" && email.trim() !== ""
				? email.trim()
				: undefined;
		const normalizedPhone = phone
			? phone.replace(/\D/g, "").slice(-10)
			: undefined;

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
			const emailCheck = await isEmailInUseAcrossSystem(sanitizedEmail, id);
			if (emailCheck.exists) {
				res.status(409).json({
					error: `An account with this email already exists as a ${emailCheck.accountType}`,
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
		const medicalReports = await MedicalReport.find({
			userId: req.user.id,
		}).sort({ uploadedAt: -1 });

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

		// Sort by date descending
		const allReports = [...formattedMedical].sort(
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

export const getMyUserBcaMetrics: RequestHandler = async (req, res, next) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({
			error: "Only users can access this endpoint",
			code: "FORBIDDEN",
		});
		return;
	}

	try {
		const history = await BcaMetric.find({ userId: req.user.id })
			.sort({ recordedAt: -1 })
			.select("-userId -__v");

		res.status(200).json({ history });
	} catch (error) {
		next(error);
	}
};

/**
 * GET /users/:id/bca-metrics — staff-facing counterpart to `/me/bca-metrics`.
 * Before this, the only reader of `bca_metrics` was the member themselves;
 * front-desk staff had no way to see a scan the member never opened the app
 * to view. `authorize(["admin", "frontdesk"])` at the route matches the
 * guard on the onboarding-steps PATCH endpoint this feeds.
 */
export const getUserBcaMetrics: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid user id" });
		return;
	}

	try {
		const history = await BcaMetric.find({ userId: id })
			.sort({ recordedAt: -1 })
			.select("-userId -__v");

		res.status(200).json({ history });
	} catch (error) {
		next(error);
	}
};

/**
 * Pull the latest Body Composition Analysis records from the ActiveX API for
 * the caller's phone number, upsert them into `bca_metrics`, and return the
 * refreshed history.
 */
export const syncMyBcaMetrics: RequestHandler = async (req, res, next) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({
			error: "Only users can access this endpoint",
			code: "FORBIDDEN",
		});
		return;
	}

	try {
		const user = await User.findById(req.user.id).select("phone");
		const phone = user?.phone?.trim();

		if (!phone) {
			res.status(400).json({
				error: "No phone number is associated with this account.",
				code: "NO_PHONE",
			});
			return;
		}

		const records = await fetchBcaRecords(phone);
		const userObjectId = new mongoose.Types.ObjectId(req.user.id);
		const receivedAt = new Date();

		let synced = 0;
		for (const record of records) {
			await upsertBcaRecordForUser(userObjectId, record, receivedAt);
			synced += 1;
		}

		const history = await BcaMetric.find({ userId: req.user.id })
			.sort({ recordedAt: -1 })
			.select("-userId -__v");

		res.status(200).json({ success: true, synced, history });
	} catch (error) {
		if (error instanceof ActiveXError) {
			res.status(error.status).json({
				error: error.message,
				code: error.code,
			});
			return;
		}
		next(error);
	}
};

// ── PATCH /users/:id/assigned-trainer ────────────────────────────────────
// Admin-only: set or clear a member's primary trainer.

export const updateAssignedTrainer: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);
	if (!id) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: { id: "Invalid user id" },
		});
		return;
	}

	const parsedBody = assignTrainerBodySchema.safeParse(req.body);
	if (!parsedBody.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsedBody.error.issues),
		});
		return;
	}

	try {
		const { trainerId } = parsedBody.data;
		let assignedTrainerName = "";

		if (trainerId) {
			if (!mongoose.Types.ObjectId.isValid(trainerId)) {
				res.status(400).json({
					error: "Validation failed",
					code: "VALIDATION_ERROR",
					details: { trainerId: "Invalid trainer id" },
				});
				return;
			}

			const trainer = await Trainer.findById(trainerId).select("trainerName");
			if (!trainer) {
				res.status(404).json({
					error: "Trainer not found",
					code: "NOT_FOUND",
				});
				return;
			}
			assignedTrainerName = trainer.trainerName || "";
		}

		const user = await User.findByIdAndUpdate(
			id,
			{
				$set: {
					assignedTrainer: trainerId ?? null,
					assignedTrainerAt: trainerId ? new Date() : null,
					"onboardingStatus.planTrainerAssignmentCompleted": Boolean(trainerId),
				},
			},
			{ new: true },
		).select("username assignedTrainer assignedTrainerAt");

		if (!user) {
			res.status(404).json({ error: "User not found", code: "NOT_FOUND" });
			return;
		}

		// Mirror onto every active PT-bearing membership. `User.assignedTrainer`
		// is what this admin screen edits, but the member app's booking flow
		// (and getMyPtPackage) reads `Membership.assignedTrainerId` — a
		// different field on a different document that historically was only
		// ever written by the trainer-change-request approval flow. Without
		// this sync, assigning a trainer here had no effect on what the app
		// showed: the booking screen kept offering the full trainer picker
		// instead of locking to the assigned coach.
		const membershipSync = await Membership.updateMany(
			buildActivePtMembershipFilter(id),
			{
				$set: {
					assignedTrainerId: trainerId ?? null,
					assignedTrainerName,
				},
			},
		);

		res.status(200).json({
			message: "Assigned trainer updated",
			user,
			membershipsSynced: membershipSync.modifiedCount,
		});
	} catch (error) {
		if (error instanceof ActiveXError) {
			res.status(error.status).json({
				error: error.message,
				code: error.code,
			});
			return;
		}
		next(error);
	}
};
