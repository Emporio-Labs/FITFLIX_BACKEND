import mongoose from "mongoose";
import { OnboardingStep } from "../models/Enums";
import User from "../models/User";

export type OnboardingServiceErrorCode =
	| "STEP_NOT_ALLOWED"
	| "ALREADY_COMPLETED"
	| "MISSING_STEPS"
	| "NOT_FOUND";

export class OnboardingServiceError extends Error {
	public readonly code: OnboardingServiceErrorCode;

	constructor(code: OnboardingServiceErrorCode, message: string) {
		super(message);
		this.name = "OnboardingServiceError";
		this.code = code;
	}
}

const STEP_ORDER: OnboardingStep[] = [
	OnboardingStep.HEALTH_MARKERS,
	OnboardingStep.HEALTH_GOALS,
	OnboardingStep.CONSENT,
	OnboardingStep.REPORT_UPLOAD,
	OnboardingStep.SPORTS_SCIENTIST_BOOKING,
	OnboardingStep.NUTRITIONIST_BOOKING,
	OnboardingStep.COMPLETED,
];

const STEP_FLAG_MAP: Record<string, string> = {
	[OnboardingStep.HEALTH_MARKERS]: "healthMarkersCompleted",
	[OnboardingStep.HEALTH_GOALS]: "healthGoalsCompleted",
	[OnboardingStep.CONSENT]: "consentCompleted",
	[OnboardingStep.REPORT_UPLOAD]: "reportsUploaded",
	[OnboardingStep.SPORTS_SCIENTIST_BOOKING]: "sportsScientistBooked",
	[OnboardingStep.NUTRITIONIST_BOOKING]: "nutritionistBooked",
};

const getNextStep = (currentStep: OnboardingStep): OnboardingStep | null => {
	const currentIndex = STEP_ORDER.indexOf(currentStep);
	if (currentIndex === -1 || currentIndex >= STEP_ORDER.length - 1) {
		return null;
	}

	return STEP_ORDER[currentIndex + 1] ?? null;
};

const toObjectId = (
	value: string,
	code: OnboardingServiceErrorCode,
	message: string,
): mongoose.Types.ObjectId => {
	if (!mongoose.Types.ObjectId.isValid(value)) {
		throw new OnboardingServiceError(code, message);
	}

	return new mongoose.Types.ObjectId(value);
};

export type OnboardingStatusResponse = {
	currentStep: string;
	completedSteps: string[];
	onboardingCompleted: boolean;
	allowedNextStep: string | null;
};

export const getOnboardingStatus = async (
	userId: string,
): Promise<OnboardingStatusResponse> => {
	const userObjectId = toObjectId(userId, "NOT_FOUND", "Invalid user ID");

	const user = await User.findById(userObjectId).select("onboardingStatus");

	if (!user) {
		throw new OnboardingServiceError("NOT_FOUND", "User not found");
	}

	const status = user.onboardingStatus;
	const currentStep =
		status?.currentStep ?? OnboardingStep.HEALTH_MARKERS;
	const completedSteps = status?.completedSteps ?? [];
	const onboardingCompleted = status?.onboardingCompleted ?? false;

	return {
		currentStep,
		completedSteps: completedSteps as string[],
		onboardingCompleted,
		allowedNextStep: onboardingCompleted ? null : currentStep,
	};
};

export const validateStepAllowed = async (
	userId: string,
	requiredStep: OnboardingStep,
): Promise<void> => {
	const status = await getOnboardingStatus(userId);

	if (status.onboardingCompleted) {
		throw new OnboardingServiceError(
			"ALREADY_COMPLETED",
			"Onboarding has already been completed",
		);
	}

	if (status.currentStep !== requiredStep) {
		throw new OnboardingServiceError(
			"STEP_NOT_ALLOWED",
			`Step ${requiredStep} is not allowed. Current step is ${status.currentStep}`,
		);
	}
};

export const advanceStep = async (
	userId: string,
	completedStep: OnboardingStep,
): Promise<void> => {
	const userObjectId = toObjectId(userId, "NOT_FOUND", "Invalid user ID");
	const nextStep = getNextStep(completedStep);
	const flagField = STEP_FLAG_MAP[completedStep];

	const update: Record<string, unknown> = {
		$addToSet: { "onboardingStatus.completedSteps": completedStep },
	};

	const setFields: Record<string, unknown> = {};

	if (flagField) {
		setFields[`onboardingStatus.${flagField}`] = true;
	}

	if (nextStep) {
		setFields["onboardingStatus.currentStep"] = nextStep;
	}

	setFields["onboardingStatus.startedAt"] = new Date();
	update.$set = setFields;

	const user = await User.findById(userObjectId).select(
		"onboardingStatus.startedAt",
	);

	if (user?.onboardingStatus?.startedAt) {
		delete (update.$set as Record<string, unknown>)[
			"onboardingStatus.startedAt"
		];
	}

	await User.findByIdAndUpdate(userObjectId, update);
};

export const completeOnboarding = async (userId: string): Promise<Date> => {
	const userObjectId = toObjectId(userId, "NOT_FOUND", "Invalid user ID");

	const user = await User.findById(userObjectId).select("onboardingStatus");

	if (!user) {
		throw new OnboardingServiceError("NOT_FOUND", "User not found");
	}

	if (user.onboardingStatus?.onboardingCompleted) {
		throw new OnboardingServiceError(
			"ALREADY_COMPLETED",
			"Onboarding has already been completed",
		);
	}

	const requiredFlags = [
		"healthMarkersCompleted",
		"healthGoalsCompleted",
		"consentCompleted",
		"reportsUploaded",
		"sportsScientistBooked",
		"nutritionistBooked",
	] as const;

	const status = user.onboardingStatus;
	const missingSteps: string[] = [];

	for (const flag of requiredFlags) {
		if (!status?.[flag]) {
			missingSteps.push(flag);
		}
	}

	if (missingSteps.length > 0) {
		throw new OnboardingServiceError(
			"MISSING_STEPS",
			`Cannot complete onboarding. Missing steps: ${missingSteps.join(", ")}`,
		);
	}

	const completedAt = new Date();

	await User.findByIdAndUpdate(userObjectId, {
		$set: {
			onboarded: true,
			"onboardingStatus.onboardingCompleted": true,
			"onboardingStatus.completedAt": completedAt,
			"onboardingStatus.currentStep": OnboardingStep.COMPLETED,
		},
		$addToSet: {
			"onboardingStatus.completedSteps": OnboardingStep.COMPLETED,
		},
	});

	return completedAt;
};
