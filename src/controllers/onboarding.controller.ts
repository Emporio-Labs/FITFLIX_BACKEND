import { promises as fs } from "node:fs";
import type { Request, RequestHandler } from "express";
import mongoose from "mongoose";

import ConsentForm from "../models/ConsentForm";
import ExpertAppointment from "../models/ExpertAppointment";
import {
	AppointmentBookingStatus,
	ConsentType,
	ExpertType,
	OnboardingStep,
} from "../models/Enums";
import HealthGoals from "../models/HealthGoals";
import HealthMarkers from "../models/HealthMarkers";
import MedicalReport from "../models/MedicalReport";
import Slot from "../models/Slots";
import { normalizeRole } from "../middleware/rbac.middleware";
import {
	reserveSlotCapacity,
	resolveConcreteSlotForBooking,
} from "../services/slot-reservation.service";
import { validateFileSignature } from "../middleware/upload.middleware";
import type { AuthenticatedUser } from "../types/auth";
import {
	advanceStep,
	completeOnboarding,
	getOnboardingStatus,
	OnboardingServiceError,
	updateSharedOnboardingStep,
	validateStepAllowed,
} from "../utils/onboarding.service";
import {
	deleteFromS3,
	generateSignedUrl,
	uploadStreamToS3,
} from "../utils/s3.service";
import {
	bookSportsScientistSchema,
	consentBodySchema,
	healthGoalsBodySchema,
	healthMarkersBodySchema,
	legacyConsentBodySchema,
	reportBodySchema,
} from "../validators/onboarding.validator";

const getValidationDetails = (
	issues: Array<{ path: PropertyKey[]; message: string }>,
) => {
	const details: Record<string, string> = {};

	for (const issue of issues) {
		const field =
			issue.path.length > 0 ? issue.path.map(String).join(".") : "body";
		if (!details[field]) {
			details[field] = issue.message;
		}
	}

	return details;
};

type RequestWithUser = Request & {
	user?: AuthenticatedUser;
	file?: Express.Multer.File;
};

const handleServiceError = (
	error: unknown,
	res: Parameters<RequestHandler>[1],
	next: Parameters<RequestHandler>[2],
) => {
	if (error instanceof OnboardingServiceError) {
		const statusMap: Record<string, number> = {
			STEP_NOT_ALLOWED: 403,
			ALREADY_COMPLETED: 409,
			MISSING_STEPS: 400,
			NOT_FOUND: 404,
		};

		const status = statusMap[error.code] ?? 400;
		res.status(status).json({
			error: error.message,
			code: error.code,
		});
		return;
	}

	next(error);
};

export const getStatusByUserId: RequestHandler = async (req, res, next) => {
	const { userId } = req.params;

	if (typeof userId !== "string" || !mongoose.Types.ObjectId.isValid(userId)) {
		res.status(400).json({ error: "Invalid user ID", code: "BAD_REQUEST" });
		return;
	}

	try {
		const status = await getOnboardingStatus(userId);
		res.status(200).json(status);
	} catch (error) {
		handleServiceError(error, res, next);
	}
};

export const getStatus: RequestHandler = async (req, res, next) => {
	if (!req.user || normalizeRole(req.user.role) !== "user") {
		res.status(403).json({
			error: "Only users can access this endpoint",
			code: "FORBIDDEN",
		});
		return;
	}

	try {
		const status = await getOnboardingStatus(req.user.id);
		res.status(200).json(status);
	} catch (error) {
		handleServiceError(error, res, next);
	}
};

export const submitHealthMarkers = async (
	req: RequestWithUser,
	res: Parameters<RequestHandler>[1],
	next: Parameters<RequestHandler>[2],
) => {
	if (!req.user || normalizeRole(req.user.role) !== "user") {
		res.status(403).json({
			error: "Only users can access this endpoint",
			code: "FORBIDDEN",
		});
		return;
	}

	const parsedBody = healthMarkersBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsedBody.error.issues),
		});
		return;
	}

	try {
		await validateStepAllowed(req.user.id, OnboardingStep.HEALTH_MARKERS);

		const { weight, height, ...rest } = parsedBody.data;
		const heightInMeters = height / 100;
		const bmi =
			Math.round((weight / (heightInMeters * heightInMeters)) * 10) / 10;

		const healthMarkers = await HealthMarkers.findOneAndUpdate(
			{ userId: req.user.id },
			{ userId: req.user.id, weight, height, bmi, ...rest },
			{ upsert: true, returnDocument: "after", runValidators: true },
		);

		await advanceStep(req.user.id, OnboardingStep.HEALTH_MARKERS);

		res.status(201).json({
			message: "Health markers submitted",
			healthMarkers,
		});
	} catch (error) {
		handleServiceError(error, res, next);
	}
};

export const submitHealthGoals = async (
	req: RequestWithUser,
	res: Parameters<RequestHandler>[1],
	next: Parameters<RequestHandler>[2],
) => {
	if (!req.user || normalizeRole(req.user.role) !== "user") {
		res.status(403).json({
			error: "Only users can access this endpoint",
			code: "FORBIDDEN",
		});
		return;
	}

	const parsedBody = healthGoalsBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsedBody.error.issues),
		});
		return;
	}

	try {
		await validateStepAllowed(req.user.id, OnboardingStep.HEALTH_GOALS);

		const healthGoals = await HealthGoals.findOneAndUpdate(
			{ userId: req.user.id },
			{ userId: req.user.id, ...parsedBody.data },
			{ upsert: true, returnDocument: "after", runValidators: true },
		);

		await advanceStep(req.user.id, OnboardingStep.HEALTH_GOALS);

		res.status(201).json({
			message: "Health goals submitted",
			healthGoals,
		});
	} catch (error) {
		handleServiceError(error, res, next);
	}
};

export const submitConsent = async (
	req: RequestWithUser,
	res: Parameters<RequestHandler>[1],
	next: Parameters<RequestHandler>[2],
) => {
	const requester = req.user;
	if (!requester || normalizeRole(requester.role) !== "user") {
		res.status(403).json({
			error: "Only users can access this endpoint",
			code: "FORBIDDEN",
		});
		return;
	}

	// Try new dual-consent payload first, then fall back to legacy single-consent
	const parsedNew = consentBodySchema.safeParse(req.body);
	const parsedLegacy = parsedNew.success
		? null
		: legacyConsentBodySchema.safeParse(req.body);

	if (!parsedNew.success && !parsedLegacy?.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsedNew.error.issues),
		});
		return;
	}

	try {
		await validateStepAllowed(requester.id, OnboardingStep.CONSENT);

		const ipAddress =
			(req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
			req.ip ??
			undefined;

		const now = new Date();

		// Build consents array from either new or legacy payload
		let consentsData: Array<{
			type: string;
			accepted: boolean;
			acceptedAt: Date;
			signatureName?: string;
			dateSigned?: Date;
			signatureUrl?: string;
		}>;

		if (parsedNew.success) {
			consentsData = parsedNew.data.consents.map((c) => ({
				type: c.type,
				accepted: c.accepted,
				acceptedAt: now,
				signatureName: c.signatureName,
				dateSigned: c.dateSigned,
			}));
		} else {
			// Legacy payload: map to both consent types
			// parsedLegacy is guaranteed non-null and successful here
			// because we already returned 400 if both parsedNew and parsedLegacy failed
			const legacyData = (
				parsedLegacy as {
					success: true;
					data: { accepted: true; signatureUrl?: string };
				}
			).data;
			consentsData = [
				{
					type: ConsentType.WELLNESS_SERVICES,
					accepted: legacyData.accepted,
					acceptedAt: now,
					signatureUrl: legacyData.signatureUrl,
				},
				{
					type: ConsentType.GYM_FITNESS,
					accepted: legacyData.accepted,
					acceptedAt: now,
					signatureUrl: legacyData.signatureUrl,
				},
			];
		}

		const consentForm = await ConsentForm.findOneAndUpdate(
			{ userId: requester.id },
			{
				userId: requester.id,
				consents: consentsData,
				ipAddress,
			},
			{ upsert: true, returnDocument: "after", runValidators: true },
		);

		await advanceStep(requester.id, OnboardingStep.CONSENT);

		res.status(201).json({
			message: "Consent submitted",
			consentForm,
		});
	} catch (error) {
		handleServiceError(error, res, next);
	}
};

export const submitReport = async (
	req: RequestWithUser,
	res: Parameters<RequestHandler>[1],
	_next: Parameters<RequestHandler>[2],
) => {
	const requester = req.user;
	if (!requester || normalizeRole(requester.role) !== "user") {
		res.status(403).json({
			error: "Access Denied",
			code: "FORBIDDEN",
		});
		return;
	}

	const parsedBody = reportBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsedBody.error.issues),
		});
		return;
	}

	let s3Key: string | undefined;
	let mimeType: string | undefined;
	let fileSize: number | undefined;
	let wasUploadedToS3 = false;

	try {
		const status = await getOnboardingStatus(requester.id);

		if (
			status.currentStep !== OnboardingStep.REPORT_UPLOAD &&
			!status.completedSteps.includes(OnboardingStep.REPORT_UPLOAD)
		) {
			await validateStepAllowed(requester.id, OnboardingStep.REPORT_UPLOAD);
		}

		if (req.file) {
			const filePath = req.file.path;
			mimeType = req.file.mimetype;
			fileSize = req.file.size;

			// Validate file content signature (magic numbers) on disk
			const isValidSignature = await validateFileSignature(filePath, mimeType);
			if (!isValidSignature) {
				console.error(
					`[SECURITY] File signature validation failed for user ${requester.id}. File path: ${filePath}, Expected: ${mimeType}`,
				);
				res.status(400).json({
					error: "Invalid file contents",
					code: "VALIDATION_ERROR",
				});
				return;
			}

			const ext = req.file.originalname.split(".").pop() ?? "bin";
			const key = `medical-reports/${requester.id}/${Date.now()}-${new mongoose.Types.ObjectId().toString()}.${ext}`;

			// Stream file directly to S3
			const result = await uploadStreamToS3(key, filePath, mimeType, fileSize);
			s3Key = result.s3Key;
			wasUploadedToS3 = true;
		}

		// Save record in MongoDB, clean up S3 on failure
		let report: any = null;
		try {
			let reportUrl = parsedBody.data.reportUrl;
			if (
				reportUrl &&
				(reportUrl.includes(".amazonaws.com") ||
					reportUrl.includes("fitflix-storage"))
			) {
				reportUrl = undefined;
			}

			report = new MedicalReport({
				userId: requester.id,
				reportName: parsedBody.data.reportName,
				reportType: parsedBody.data.reportType,
				reportUrl,
				s3Key,
				mimeType,
				fileSize,
			});
			await report.save();
		} catch (dbError) {
			console.error(
				`[DATABASE_ERROR] MongoDB save failed for user ${requester.id}:`,
				dbError,
			);
			if (s3Key && wasUploadedToS3) {
				try {
					await deleteFromS3(s3Key);
					console.log(
						`[CLEANUP] Successfully removed orphaned S3 object: ${s3Key}`,
					);
				} catch (s3Error) {
					console.error(
						`[CLEANUP_ERROR] Failed to delete orphaned S3 object ${s3Key}:`,
						s3Error,
					);
				}
			}
			res.status(500).json({
				error: "Failed to store report record",
				code: "INTERNAL_ERROR",
			});
			return;
		}

		if (!status.completedSteps.includes(OnboardingStep.REPORT_UPLOAD)) {
			await advanceStep(requester.id, OnboardingStep.REPORT_UPLOAD);
		}

		// Generate a short-lived presigned URL for the response payload safely
		const reportObj = report.toObject();
		if (s3Key) {
			try {
				reportObj.reportUrl = await generateSignedUrl(s3Key, 900, mimeType);
			} catch (s3SignError) {
				console.error(
					`[S3_SIGNING_ERROR] Failed to generate signed URL for key ${s3Key}:`,
					s3SignError,
				);
				reportObj.reportUrl = undefined; // Proceed without crashing the response
			}
		}

		res.status(201).json({
			message: "Report uploaded",
			report: reportObj,
		});
	} catch (error) {
		console.error(
			`[UPLOAD_FAILED] Failed file ingestion for user ${requester.id}:`,
			error,
		);
		res.status(500).json({
			error: "An error occurred during report ingestion",
			code: "INTERNAL_ERROR",
		});
	} finally {
		// Rule 2: Wrap fs.promises.unlink tightly in a finally block so local storage never leaks
		if (req.file?.path) {
			try {
				await fs.unlink(req.file.path);
			} catch (unlinkError) {
				console.error(
					`[CLEANUP_ERROR] Failed to unlink temp file at ${req.file.path}:`,
					unlinkError,
				);
			}
		}
	}
};

export const bookSportsScientist: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester || normalizeRole(requester.role) !== "user") {
		res.status(403).json({
			error: "Only members can book a sport scientist appointment",
			code: "FORBIDDEN",
		});
		return;
	}

	const parsed = bookSportsScientistSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation error",
			code: "VALIDATION_ERROR",
			details: parsed.error.format(),
		});
		return;
	}

	const { slotId, appointmentMode, meetingLink, notes } = parsed.data;
	const appointmentDate = new Date(parsed.data.appointmentDate);
	let startTime = parsed.data.startTime ?? null;
	let endTime = parsed.data.endTime ?? null;
	let resolvedSlotId: mongoose.Types.ObjectId | null = null;

	try {
		// Reserve a real seat against sports-scientist inventory when a slot was
		// picked — mirrors bookNutritionist's flow exactly (same shared
		// primitives), so "Sports Scientist" slots and "Nutritionist" slots at
		// the same time draw from separate pools and neither can overbook the
		// other. A slot id is optional: without one this still records the
		// appointment, just without capacity enforcement.
		if (slotId && mongoose.Types.ObjectId.isValid(slotId)) {
			const slot = await Slot.findOne({
				_id: slotId,
				expertType: ExpertType.SportsScientist,
			});
			if (!slot) {
				res.status(400).json({
					error: "Selected slot is not a sports-scientist slot",
					code: "SLOT_UNAVAILABLE",
				});
				return;
			}

			const concreteSlot = await resolveConcreteSlotForBooking(
				slot,
				appointmentDate,
			);
			if (!concreteSlot) {
				res.status(400).json({
					error: "Selected slot is not available on that date",
					code: "SLOT_UNAVAILABLE",
				});
				return;
			}

			const reservedSlot = await reserveSlotCapacity(
				concreteSlot._id.toString(),
			);
			if (!reservedSlot) {
				res.status(400).json({
					error: "Selected slot is fully booked",
					code: "SLOT_FULL",
				});
				return;
			}

			resolvedSlotId = concreteSlot._id;
			startTime = concreteSlot.startTime;
			endTime = concreteSlot.endTime;
		}

		const appointment = await ExpertAppointment.findOneAndUpdate(
			{
				userId: requester.id,
				expertType: ExpertType.SportsScientist,
				bookingStatus: {
					$in: [
						AppointmentBookingStatus.Pending,
						AppointmentBookingStatus.Confirmed,
					],
				},
			},
			{
				$set: {
					appointmentDate,
					appointmentMode,
					meetingLink: meetingLink || null,
					startTime,
					endTime,
					notes: notes || null,
					...(resolvedSlotId ? { slotId: resolvedSlotId } : {}),
				},
				$setOnInsert: {
					userId: requester.id,
					expertType: ExpertType.SportsScientist,
					bookingStatus: AppointmentBookingStatus.Pending,
				},
			},
			{ new: true, upsert: true, setDefaultsOnInsert: true },
		);

		await updateSharedOnboardingStep(
			requester.id,
			OnboardingStep.SPORT_SCIENTIST_APPOINTMENT,
			true,
		);
		// Also advances the app-owned `currentStep` (SPORT_SCIENTIST_APPOINTMENT
		// now sits between REPORT_UPLOAD and NUTRITIONIST_BOOKING in STEP_ORDER),
		// so the member wizard's next page unlocks the same way it does after
		// every other step — without this the sports-scientist wizard page
		// would book successfully but the client would have no server signal
		// to move forward to the nutritionist page.
		await advanceStep(requester.id, OnboardingStep.SPORT_SCIENTIST_APPOINTMENT);
		res
			.status(201)
			.json({ message: "Sport scientist appointment booked", appointment });
	} catch (error) {
		next(error);
	}
};

export const skipSportsScientist: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester || normalizeRole(requester.role) !== "user") {
		res.status(403).json({
			error: "Only members can skip the sport scientist step",
			code: "FORBIDDEN",
		});
		return;
	}

	try {
		const status = await getOnboardingStatus(requester.id);

		// Idempotent: a double tap, a retry after a dropped response, or a
		// stale client re-sending this must not error — they should just see
		// wherever the wizard already is.
		if (status.currentStep === OnboardingStep.SPORT_SCIENTIST_APPOINTMENT) {
			// markCompleted: false — this only moves currentStep forward. It
			// deliberately leaves `sportsScientistBooked` false and keeps the
			// step out of completedSteps: that flag also drives the frontdesk
			// sports-scientist triage queue and shared-onboarding completion,
			// so skipping here must never look like a human actually saw one.
			await advanceStep(requester.id, OnboardingStep.SPORT_SCIENTIST_APPOINTMENT, {
				markCompleted: false,
			});
		}

		res.status(200).json({
			message: "Sport scientist step skipped",
			status: await getOnboardingStatus(requester.id),
		});
	} catch (error) {
		next(error);
	}
};

export const updateSharedStep: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester || !["admin", "frontdesk"].includes(normalizeRole(requester.role))) {
		res.status(403).json({
			error: "Only front desk staff can update shared onboarding steps",
			code: "FORBIDDEN",
		});
		return;
	}

	const rawStep = String(req.params.step ?? "")
		.trim()
		.toUpperCase();
	if (!Object.values(OnboardingStep).includes(rawStep as OnboardingStep)) {
		res
			.status(400)
			.json({ error: "Invalid onboarding step", code: "VALIDATION_ERROR" });
		return;
	}
	const centreManagedSteps = new Set([
		OnboardingStep.ACTIVE_X_TEST,
		OnboardingStep.DNA_SAMPLE,
		OnboardingStep.VALD_TEST,
	]);
	if (!centreManagedSteps.has(rawStep as OnboardingStep)) {
		res.status(403).json({
			error:
				"This onboarding step is completed in the member app or by its owning workflow",
			code: "STEP_NOT_ALLOWED",
		});
		return;
	}
	if (typeof req.body?.completed !== "boolean") {
		res
			.status(400)
			.json({ error: "completed must be a boolean", code: "VALIDATION_ERROR" });
		return;
	}

	try {
		const status = await updateSharedOnboardingStep(
			String(req.params.userId ?? ""),
			rawStep as OnboardingStep,
			req.body.completed,
		);
		res.status(200).json({ message: "Onboarding step updated", status });
	} catch (error) {
		handleServiceError(error, res, next);
	}
};

export const submitComplete = async (
	req: RequestWithUser,
	res: Parameters<RequestHandler>[1],
	next: Parameters<RequestHandler>[2],
) => {
	const requester = req.user;
	if (!requester || normalizeRole(requester.role) !== "user") {
		res.status(403).json({
			error: "Only users can access this endpoint",
			code: "FORBIDDEN",
		});
		return;
	}

	try {
		const completedAt = await completeOnboarding(requester.id);

		res.status(200).json({
			message: "Onboarding completed",
			completedAt,
		});
	} catch (error) {
		handleServiceError(error, res, next);
	}
};
