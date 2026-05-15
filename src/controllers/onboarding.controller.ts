import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { ExpertType, OnboardingStep } from "../models/Enums";
import ConsentForm from "../models/ConsentForm";
import ExpertAppointment from "../models/ExpertAppointment";
import HealthGoals from "../models/HealthGoals";
import HealthMarkers from "../models/HealthMarkers";
import MedicalReport from "../models/MedicalReport";
import {
	OnboardingServiceError,
	advanceStep,
	completeOnboarding,
	getOnboardingStatus,
	validateStepAllowed,
} from "../utils/onboarding.service";
import {
	appointmentBodySchema,
	consentBodySchema,
	healthGoalsBodySchema,
	healthMarkersBodySchema,
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

export const getStatus: RequestHandler = async (req, res, next) => {
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

export const submitHealthMarkers: RequestHandler = async (req, res, next) => {
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

export const submitHealthGoals: RequestHandler = async (req, res, next) => {
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

export const submitConsent: RequestHandler = async (req, res, next) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({
			error: "Only users can access this endpoint",
			code: "FORBIDDEN",
		});
		return;
	}

	const parsedBody = consentBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsedBody.error.issues),
		});
		return;
	}

	try {
		await validateStepAllowed(req.user.id, OnboardingStep.CONSENT);

		const ipAddress =
			(req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
			req.ip ??
			undefined;

		const consentForm = await ConsentForm.findOneAndUpdate(
			{ userId: req.user.id },
			{
				userId: req.user.id,
				accepted: parsedBody.data.accepted,
				acceptedAt: new Date(),
				signatureUrl: parsedBody.data.signatureUrl,
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

export const submitReport: RequestHandler = async (req, res, next) => {
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

		const report = new MedicalReport({
			userId: req.user.id,
			...parsedBody.data,
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

export const submitAppointment: RequestHandler = async (req, res, next) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({
			error: "Only users can access this endpoint",
			code: "FORBIDDEN",
		});
		return;
	}

	const parsedBody = appointmentBodySchema.safeParse(req.body);

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

		if (expertType === ExpertType.SportsScientist) {
			await validateStepAllowed(
				req.user.id,
				OnboardingStep.SPORTS_SCIENTIST_BOOKING,
			);
		} else if (expertType === ExpertType.Nutritionist) {
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

		const stepToAdvance =
			expertType === ExpertType.SportsScientist
				? OnboardingStep.SPORTS_SCIENTIST_BOOKING
				: OnboardingStep.NUTRITIONIST_BOOKING;

		await advanceStep(req.user.id, stepToAdvance);

		res.status(201).json({
			message: `${expertType === ExpertType.SportsScientist ? "Sports scientist" : "Nutritionist"} appointment booked`,
			appointment,
		});
	} catch (error) {
		handleServiceError(error, res, next);
	}
};

export const submitComplete: RequestHandler = async (req, res, next) => {
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
