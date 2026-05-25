import type { Request, RequestHandler } from "express";
import mongoose from "mongoose";
import { uploadToS3 } from "../utils/s3.service";
import { ConsentType, ExpertType, OnboardingStep } from "../models/Enums";
import ConsentForm from "../models/ConsentForm";
import ExpertAppointment from "../models/ExpertAppointment";
import HealthGoals from "../models/HealthGoals";
import HealthMarkers from "../models/HealthMarkers";
import MedicalReport from "../models/MedicalReport";
import type { AuthenticatedUser } from "../types/auth";
import {
	OnboardingServiceError,
	advanceStep,
	cancelExpertAppointment,
	completeOnboarding,
	getOnboardingStatus,
	validateStepAllowed,
} from "../utils/onboarding.service";
import {
	appointmentBodySchema,
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
			issue.path.length > 0
				? issue.path.map(String).join(".")
				: "body";
		if (!details[field]) {
			details[field] = issue.message;
		}
	}

	return details;
};

type RequestWithUser = Request & { user?: AuthenticatedUser; file?: Express.Multer.File };

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

export const getStatus = async (
	req: RequestWithUser,
	res: Parameters<RequestHandler>[1],
	next: Parameters<RequestHandler>[2],
) => {
	if (!req.user || req.user.role !== "user") {
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
	if (!req.user || req.user.role !== "user") {
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
		const bmi = Math.round((weight / (heightInMeters * heightInMeters)) * 10) / 10;

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
	if (!req.user || req.user.role !== "user") {
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
	if (!req.user || req.user.role !== "user") {
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

	if (!parsedNew.success && (!parsedLegacy || !parsedLegacy.success)) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsedNew.error.issues),
		});
		return;
	}

	try {
		await validateStepAllowed(req.user.id, OnboardingStep.CONSENT);

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
			const legacyData = (parsedLegacy as { success: true; data: { accepted: true; signatureUrl?: string } }).data;
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
			{ userId: req.user.id },
			{
				userId: req.user.id,
				consents: consentsData,
				ipAddress,
			},
			{ upsert: true, returnDocument: "after", runValidators: true },
		);

		await advanceStep(req.user.id, OnboardingStep.CONSENT);

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
	next: Parameters<RequestHandler>[2],
) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({
			error: "Only users can access this endpoint",
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

	try {
		const status = await getOnboardingStatus(req.user.id);

		if (
			status.currentStep !== OnboardingStep.REPORT_UPLOAD &&
			!status.completedSteps.includes(OnboardingStep.REPORT_UPLOAD)
		) {
			await validateStepAllowed(req.user.id, OnboardingStep.REPORT_UPLOAD);
		}

		let s3Key: string | undefined;
		let fileUrl: string | undefined;
		let mimeType: string | undefined;
		let fileSize: number | undefined;

		if (req.file) {
			const ext = req.file.originalname.split(".").pop() ?? "bin";
			const key = `medical-reports/${req.user.id}/${Date.now()}-${new mongoose.Types.ObjectId().toString()}.${ext}`;
			const result = await uploadToS3(key, req.file.buffer, req.file.mimetype);
			s3Key = result.s3Key;
			fileUrl = result.fileUrl;
			mimeType = req.file.mimetype;
			fileSize = req.file.size;
		}

		const report = new MedicalReport({
			userId: req.user.id,
			reportName: parsedBody.data.reportName,
			reportType: parsedBody.data.reportType,
			reportUrl: fileUrl ?? parsedBody.data.reportUrl,
			s3Key,
			mimeType,
			fileSize,
		});
		await report.save();

		if (!status.completedSteps.includes(OnboardingStep.REPORT_UPLOAD)) {
			await advanceStep(req.user.id, OnboardingStep.REPORT_UPLOAD);
		}

		res.status(201).json({
			message: "Report uploaded",
			report,
		});
	} catch (error) {
		handleServiceError(error, res, next);
	}
};

const submitAppointmentInternal = async (
	req: RequestWithUser,
	res: Parameters<RequestHandler>[1],
	next: Parameters<RequestHandler>[2],
	expertTypeOverride?: ExpertType,
) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({
			error: "Only users can access this endpoint",
			code: "FORBIDDEN",
		});
		return;
	}

	const payload = expertTypeOverride
		? { ...req.body, expertType: expertTypeOverride }
		: req.body;
	const parsedBody = appointmentBodySchema.safeParse(payload);

	if (!parsedBody.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsedBody.error.issues),
		});
		return;
	}

	try {
		const { expertType, ...appointmentData } = parsedBody.data;

		if (expertType === ExpertType.Nutritionist) {
			await validateStepAllowed(
				req.user.id,
				OnboardingStep.NUTRITIONIST_BOOKING,
			);
		}

		const userObjectId = new mongoose.Types.ObjectId(req.user.id);

		const filter = { userId: userObjectId, expertType };
		const update = { userId: userObjectId, expertType, ...appointmentData };

		const appointment = await ExpertAppointment.findOneAndUpdate(
			filter as Record<string, unknown>,
			update as Record<string, unknown>,
			{ upsert: true, returnDocument: "after", runValidators: true },
		);

		if (expertType === ExpertType.Nutritionist) {
			await advanceStep(req.user.id, OnboardingStep.NUTRITIONIST_BOOKING);
		}

		res.status(201).json({
			message: `${expertType === ExpertType.SportsScientist ? "Sports scientist" : "Nutritionist"} appointment booked`,
			appointment,
		});
	} catch (error) {
		handleServiceError(error, res, next);
	}
};

export const submitAppointment: RequestHandler = (req, res, next) =>
	submitAppointmentInternal(req as RequestWithUser, res, next);

export const submitSportsScientistAppointment: RequestHandler = (
	req,
	res,
	next,
) =>
	submitAppointmentInternal(
		req as RequestWithUser,
		res,
		next,
		ExpertType.SportsScientist,
	);

export const submitNutritionistAppointment: RequestHandler = (
	req,
	res,
	next,
) =>
	submitAppointmentInternal(
		req as RequestWithUser,
		res,
		next,
		ExpertType.Nutritionist,
	);

export const deleteNutritionistAppointment = async (
	req: RequestWithUser,
	res: Parameters<RequestHandler>[1],
	next: Parameters<RequestHandler>[2],
) => {
	if (!req.user || req.user.role !== "admin") {
		res.status(403).json({
			error: "Only admins can cancel nutritionist appointments",
			code: "FORBIDDEN",
		});
		return;
	}

	const { userId } = req.params;

	if (
		typeof userId !== "string" ||
		!mongoose.Types.ObjectId.isValid(userId)
	) {
		res.status(400).json({
			error: "Invalid user ID",
			code: "BAD_REQUEST",
		});
		return;
	}

	try {
		const onboardingStatus = await cancelExpertAppointment(
			userId,
			ExpertType.Nutritionist,
		);

		res.status(200).json({
			success: true,
			message: "Nutritionist appointment cancelled successfully",
			onboardingStatus,
		});
	} catch (error) {
		handleServiceError(error, res, next);
	}
};

export const submitComplete = async (
	req: RequestWithUser,
	res: Parameters<RequestHandler>[1],
	next: Parameters<RequestHandler>[2],
) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({
			error: "Only users can access this endpoint",
			code: "FORBIDDEN",
		});
		return;
	}

	try {
		const completedAt = await completeOnboarding(req.user.id);

		res.status(200).json({
			message: "Onboarding completed",
			completedAt,
		});
	} catch (error) {
		handleServiceError(error, res, next);
	}
};
