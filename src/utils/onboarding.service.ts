import mongoose from "mongoose";
import { OnboardingStep, UnifiedBookingStatus } from "../models/Enums";
import UnifiedBooking from "../models/UnifiedBooking";
import User from "../models/User";
import {
	NUTRITIONIST_BOOKING_FILTER,
	serializeNutritionistBooking,
} from "./nutritionist-booking.dto";
import {
	serializeSportsScientistBooking,
	SPORTS_SCIENTIST_BOOKING_FILTER,
} from "./sports-scientist-booking.dto";

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

// Sports scientist was reinserted here 2026-08-26, between REPORT_UPLOAD and
// NUTRITIONIST_BOOKING, matching where it sits in the member app's wizard
// (lib/screens/onboarding/onboarding_screen.dart). Before this it had no
// slot in the app-owned sequence at all: bookSportsScientist only flipped
// the shared `sportsScientistBooked` flag via updateSharedOnboardingStep,
// never advanced `currentStep` — so a client wizard page for it would have
// been unreachable through the normal advanceStep-driven page gate.
const STEP_ORDER: OnboardingStep[] = [
	OnboardingStep.HEALTH_MARKERS,
	OnboardingStep.HEALTH_GOALS,
	OnboardingStep.CONSENT,
	OnboardingStep.REPORT_UPLOAD,
	OnboardingStep.SPORT_SCIENTIST_APPOINTMENT,
	OnboardingStep.NUTRITIONIST_BOOKING,
	OnboardingStep.COMPLETED,
];

const STEP_FLAG_MAP: Record<string, string> = {
	[OnboardingStep.HEALTH_MARKERS]: "healthMarkersCompleted",
	[OnboardingStep.HEALTH_GOALS]: "healthGoalsCompleted",
	[OnboardingStep.CONSENT]: "consentCompleted",
	[OnboardingStep.REPORT_UPLOAD]: "reportsUploaded",
	[OnboardingStep.SPORT_SCIENTIST_APPOINTMENT]: "sportsScientistBooked",
	[OnboardingStep.NUTRITIONIST_BOOKING]: "nutritionistBooked",
};

const APP_OWNED_STEPS = STEP_ORDER.filter(
	(step) => step !== OnboardingStep.COMPLETED,
);

// Steps a member may defer via POST /onboarding/steps/:step/skip, or all at
// once via /onboarding/steps/skip-all. Every app-owned step is here,
// CONSENT included: the business decided the wizard must never be able to
// trap a paying member, so nothing in it is mandatory up front. CONSENT is
// still a signed liability/gym-fitness waiver captured with an IP address
// (ConsentForm) — skipping only defers it. It stays on `pendingSteps`, the
// front desk still sees it outstanding, the member app keeps showing its
// permanent "Setup pending" warning, and `completeOnboarding` below still
// refuses to finish until it is genuinely signed.
const SKIPPABLE_STEPS = new Set<OnboardingStep>([
	OnboardingStep.HEALTH_MARKERS,
	OnboardingStep.HEALTH_GOALS,
	OnboardingStep.CONSENT,
	OnboardingStep.REPORT_UPLOAD,
	OnboardingStep.SPORT_SCIENTIST_APPOINTMENT,
	OnboardingStep.NUTRITIONIST_BOOKING,
]);

const SHARED_STEP_FLAG_MAP: Record<string, string> = {
	[OnboardingStep.ACTIVE_X_TEST]: "activeXTestCompleted",
	[OnboardingStep.DNA_SAMPLE]: "dnaSampleCompleted",
	[OnboardingStep.VALD_TEST]: "valdTestCompleted",
	[OnboardingStep.NUTRITION_APPOINTMENT]: "nutritionistBooked",
	[OnboardingStep.SPORT_SCIENTIST_APPOINTMENT]: "sportsScientistBooked",
	[OnboardingStep.PLAN_TRAINER_ASSIGNMENT]: "planTrainerAssignmentCompleted",
};

const SHARED_ONBOARDING_STEPS = Object.keys(
	SHARED_STEP_FLAG_MAP,
) as OnboardingStep[];

// noUncheckedIndexedAccess makes `map[step]` read as `string | undefined`,
// which can't itself be used to index `status`. Every step here is guaranteed
// present in its map (both maps are built from the same step lists elsewhere
// in this file), so the `?? ""` is unreachable in practice — it only exists to
// satisfy the type checker without an unsafe cast.
const getFlag = (
	status: any,
	map: Record<string, string>,
	step: OnboardingStep,
): boolean => Boolean(status?.[map[step] ?? ""]);

const getSharedCompletedSteps = (status: any): OnboardingStep[] =>
	SHARED_ONBOARDING_STEPS.filter((step) =>
		getFlag(status, SHARED_STEP_FLAG_MAP, step),
	);

const isSharedOnboardingComplete = (status: any): boolean =>
	SHARED_ONBOARDING_STEPS.every((step) =>
		getFlag(status, SHARED_STEP_FLAG_MAP, step),
	);

const isStepDoneOrSkipped = (status: any, step: OnboardingStep): boolean => {
	if (getFlag(status, STEP_FLAG_MAP, step)) return true;
	const skipped: OnboardingStep[] = status?.skippedSteps ?? [];
	return SKIPPABLE_STEPS.has(step) && skipped.includes(step);
};

// "App-owned setup is done" means every app-owned step is either completed or
// explicitly skipped. This is what lets a member who skips their way through
// the wizard reach the dashboard while the steps they deferred — and the
// centre-owned ones — remain outstanding on `pendingSteps`.
const isAppOnboardingComplete = (status: any): boolean =>
	Boolean(
		status?.appOnboardingCompleted === true ||
			APP_OWNED_STEPS.every((step) => isStepDoneOrSkipped(status, step)),
	);

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
	sharedCompletedSteps: string[];
	// Steps the member has deferred but not completed. A step leaves this list
	// the moment it is actually submitted.
	skippedSteps: string[];
	// The full ordered step sequence (minus COMPLETED), so the client no
	// longer has to hardcode the wizard's page count or order.
	stepOrder: string[];
	// Every outstanding step — app-owned or centre-owned, skipped or never
	// started — for the dashboard's pending-setup warning to render directly.
	pendingSteps: string[];
	appOnboardingCompleted: boolean;
	onboardingCompleted: boolean;
	allowedNextStep: string | null;
	bookingDetails?: {
		_id: string;
		bookingStatus: string;
		appointmentMode: string;
		clinicLocation: string | null;
		zegoRoomId: string | null;
		assignedNutritionistId: string | null;
		assignedNutritionistName: string | null;
		meetingStatus: string;
		bookingDate?: Date | null;
		startTime?: string | null;
		endTime?: string | null;
		acceptedAt?: Date | null;
	} | null;
	sportsScientistBookingDetails?: {
		_id: string;
		bookingStatus: string;
		appointmentDate: Date | null;
		appointmentMode: string;
		clinicLocation: string | null;
		zegoRoomId: string | null;
		assignedExpertId: string | null;
		assignedExpertName: string | null;
		meetingStatus: string | null;
		startTime?: string | null;
		endTime?: string | null;
		acceptedAt?: Date | null;
	} | null;
};

export const getOnboardingStatus = async (
	userId: string,
): Promise<OnboardingStatusResponse> => {
	const userObjectId = toObjectId(userId, "NOT_FOUND", "Invalid user ID");

	const [user, booking, sportsScientistBooking] = await Promise.all([
		User.findById(userObjectId).select("onboardingStatus"),
		// Consultations live in UnifiedBooking now; REJECTED still means "staff
		// declined it", so it cannot satisfy the nutritionist step.
		UnifiedBooking.findOne({
			...NUTRITIONIST_BOOKING_FILTER,
			userId: userObjectId,
			status: { $ne: UnifiedBookingStatus.REJECTED },
		})
			.sort({ createdAt: -1 })
			.lean(),
		// Sports-scientist consultations now live in UnifiedBooking too — see
		// utils/sports-scientist-booking.dto.ts. Deliberately keeps only
		// CANCELLED excluded (not REJECTED, unlike the nutritionist query
		// above): a rejected sports-scientist booking is still surfaced here so
		// the member's status card can show "declined, please rebook" instead
		// of silently reverting to an empty booking state.
		UnifiedBooking.findOne({
			...SPORTS_SCIENTIST_BOOKING_FILTER,
			userId: userObjectId,
			status: { $ne: UnifiedBookingStatus.CANCELLED },
		})
			.sort({ createdAt: -1 })
			.lean(),
	]);

	if (!user) {
		throw new OnboardingServiceError("NOT_FOUND", "User not found");
	}

	const status = user.onboardingStatus;
	const currentStep = status?.currentStep ?? OnboardingStep.HEALTH_MARKERS;
	const completedSteps = status?.completedSteps ?? [];
	const sharedCompletedSteps = getSharedCompletedSteps(status);
	const skippedSteps = (status?.skippedSteps ?? []) as OnboardingStep[];
	const appOnboardingCompleted = isAppOnboardingComplete(status);
	const onboardingCompleted = isSharedOnboardingComplete(status);
	const pendingSteps = [
		...APP_OWNED_STEPS.filter((step) => !getFlag(status, STEP_FLAG_MAP, step)),
		...SHARED_ONBOARDING_STEPS.filter(
			(step) => !getFlag(status, SHARED_STEP_FLAG_MAP, step),
		),
	];

	// Serialised through the legacy adapter so `bookingStatus` stays in the
	// NutritionistBookingStatus vocabulary the member app already reads.
	const legacyBooking = booking ? serializeNutritionistBooking(booking) : null;
	const bookingDetails = legacyBooking
		? {
				_id: legacyBooking._id,
				bookingStatus: legacyBooking.status,
				appointmentMode: legacyBooking.appointmentMode ?? "",
				clinicLocation: legacyBooking.clinicLocation ?? null,
				zegoRoomId: legacyBooking.zegoRoomId ?? null,
				assignedNutritionistId: legacyBooking.assignedNutritionistId
					? String(legacyBooking.assignedNutritionistId)
					: null,
				assignedNutritionistName: legacyBooking.assignedNutritionistName ?? null,
				meetingStatus: legacyBooking.meetingStatus ?? "",
				bookingDate: legacyBooking.bookingDate ?? undefined,
				startTime: legacyBooking.startTime ?? undefined,
				endTime: legacyBooking.endTime ?? undefined,
				acceptedAt: legacyBooking.acceptedAt ?? null,
			}
		: null;

	// Same legacy-adapter treatment as the nutritionist booking above.
	const legacySsBooking = sportsScientistBooking
		? serializeSportsScientistBooking(sportsScientistBooking)
		: null;
	const sportsScientistBookingDetails = legacySsBooking
		? {
				_id: legacySsBooking._id,
				bookingStatus: legacySsBooking.bookingStatus,
				appointmentDate: legacySsBooking.appointmentDate,
				appointmentMode: legacySsBooking.appointmentMode ?? "",
				clinicLocation: legacySsBooking.clinicLocation ?? null,
				zegoRoomId: legacySsBooking.zegoRoomId ?? null,
				assignedExpertId: legacySsBooking.assignedExpertId
					? String(legacySsBooking.assignedExpertId)
					: null,
				assignedExpertName: legacySsBooking.assignedExpertName ?? null,
				meetingStatus: legacySsBooking.meetingStatus ?? null,
				startTime: legacySsBooking.startTime ?? null,
				endTime: legacySsBooking.endTime ?? null,
				acceptedAt: legacySsBooking.acceptedAt ?? null,
			}
		: null;

	return {
		currentStep,
		completedSteps: completedSteps as string[],
		sharedCompletedSteps: sharedCompletedSteps as string[],
		skippedSteps: skippedSteps as string[],
		stepOrder: APP_OWNED_STEPS as string[],
		pendingSteps: pendingSteps as string[],
		appOnboardingCompleted,
		onboardingCompleted,
		allowedNextStep: onboardingCompleted ? null : currentStep,
		bookingDetails,
		sportsScientistBookingDetails,
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

	// A step the member skipped earlier is still submittable later — e.g. from
	// the dashboard's pending-setup warning, well after currentStep has moved
	// on past it. Similarly, an already completed step submitted again (e.g.
	// user revising data, or a client network retry / duplicate tap) is allowed
	// idempotently rather than failing with STEP_NOT_ALLOWED.
	if (
		status.currentStep !== requiredStep &&
		!status.skippedSteps.includes(requiredStep) &&
		!status.completedSteps.includes(requiredStep)
	) {
		throw new OnboardingServiceError(
			"STEP_NOT_ALLOWED",
			`Step ${requiredStep} is not allowed. Current step is ${status.currentStep}`,
		);
	}
};

export const updateSharedOnboardingStep = async (
	userId: string,
	step: OnboardingStep,
	completed: boolean,
): Promise<OnboardingStatusResponse> => {
	const flagField = SHARED_STEP_FLAG_MAP[step];
	if (!flagField) {
		throw new OnboardingServiceError(
			"STEP_NOT_ALLOWED",
			`Step ${step} is not a shared onboarding step`,
		);
	}

	const userObjectId = toObjectId(userId, "NOT_FOUND", "Invalid user ID");
	const update: Record<string, unknown> = {
		$set: {
			[`onboardingStatus.${flagField}`]: completed,
			"onboardingStatus.startedAt": new Date(),
		},
	};

	const user = await User.findByIdAndUpdate(userObjectId, update, {
		new: true,
	}).select("onboardingStatus");
	if (!user) {
		throw new OnboardingServiceError("NOT_FOUND", "User not found");
	}

	const status = user.onboardingStatus;
	if (isSharedOnboardingComplete(status)) {
		await User.findByIdAndUpdate(userObjectId, {
			$set: {
				onboarded: true,
				"onboardingStatus.onboardingCompleted": true,
				"onboardingStatus.completedAt": new Date(),
				"onboardingStatus.currentStep": OnboardingStep.COMPLETED,
			},
		});
	} else if (status?.onboardingCompleted && !completed) {
		await User.findByIdAndUpdate(userObjectId, {
			$set: {
				onboarded: false,
				"onboardingStatus.onboardingCompleted": false,
				"onboardingStatus.completedAt": undefined,
				"onboardingStatus.currentStep": OnboardingStep.HEALTH_MARKERS,
			},
		});
	}

	return getOnboardingStatus(userId);
};

export const advanceStep = async (
	userId: string,
	completedStep: OnboardingStep,
	options: { markCompleted?: boolean } = {},
): Promise<void> => {
	const { markCompleted = true } = options;
	const userObjectId = toObjectId(userId, "NOT_FOUND", "Invalid user ID");
	const nextStep = getNextStep(completedStep);
	const flagField = STEP_FLAG_MAP[completedStep];

	const user = await User.findById(userObjectId).select(
		"onboardingStatus.startedAt onboardingStatus.currentStep",
	);
	if (!user) {
		throw new OnboardingServiceError("NOT_FOUND", "User not found");
	}

	const update: Record<string, unknown> = {};

	// A skip (markCompleted: false) moves currentStep forward without marking
	// the step done — it must not land in completedSteps or flip the step's
	// completion flag, since callers (the frontdesk queue, shared-onboarding
	// completion) treat that flag as "a human actually did this step".
	if (markCompleted) {
		update.$addToSet = { "onboardingStatus.completedSteps": completedStep };
	}

	const setFields: Record<string, unknown> = {};

	if (markCompleted && flagField) {
		setFields[`onboardingStatus.${flagField}`] = true;
	}
	if (markCompleted) {
		// Finishing a step for real un-skips it — it no longer belongs on the
		// pending-setup warning as "deferred".
		update.$pull = { "onboardingStatus.skippedSteps": completedStep };
	}

	// A step submitted out of order (e.g. resuming one that was skipped
	// earlier, after currentStep has already moved past it) must not drag
	// currentStep backwards — only advance, never rewind.
	const existingStep =
		user.onboardingStatus?.currentStep ?? OnboardingStep.HEALTH_MARKERS;
	const isForwardMove =
		nextStep &&
		STEP_ORDER.indexOf(nextStep) > STEP_ORDER.indexOf(existingStep);
	if (isForwardMove) {
		setFields["onboardingStatus.currentStep"] = nextStep;
	}

	if (!user.onboardingStatus?.startedAt) {
		setFields["onboardingStatus.startedAt"] = new Date();
	}

	if (Object.keys(setFields).length > 0) {
		update.$set = setFields;
	}

	await User.findByIdAndUpdate(userObjectId, update);
};

export const skipStep = async (
	userId: string,
	step: OnboardingStep,
): Promise<OnboardingStatusResponse> => {
	if (!SKIPPABLE_STEPS.has(step)) {
		throw new OnboardingServiceError(
			"STEP_NOT_ALLOWED",
			`Step ${step} cannot be skipped`,
		);
	}

	const status = await getOnboardingStatus(userId);

	if (status.onboardingCompleted) {
		throw new OnboardingServiceError(
			"ALREADY_COMPLETED",
			"Onboarding has already been completed",
		);
	}

	// Idempotent: a double tap, a retry after a dropped response, or a stale
	// client re-sending this must not error. Already completed or already
	// skipped both just return the current status. completedSteps (not the
	// per-flag field, which OnboardingStatusResponse doesn't expose) is the
	// proxy for "done": advanceStep adds a step to it exactly when it flips
	// that step's completion flag.
	const alreadyDone = status.completedSteps.includes(step);
	const alreadySkipped = status.skippedSteps.includes(step);

	if (!alreadyDone && !alreadySkipped) {
		const userObjectId = toObjectId(userId, "NOT_FOUND", "Invalid user ID");
		await User.findByIdAndUpdate(userObjectId, {
			$addToSet: { "onboardingStatus.skippedSteps": step },
		});
		await advanceStep(userId, step, { markCompleted: false });
	}

	return getOnboardingStatus(userId);
};

/**
 * Defer every remaining app-owned step in one write — what the wizard's
 * "Skip all" header button calls.
 *
 * Deliberately not a loop over `skipStep`: that would be one round trip per
 * step (six of them), each re-reading status, and a mid-way failure would
 * leave the member stranded on a half-skipped wizard. This is a single
 * `$addToSet` plus one `currentStep` write, so it either all lands or none
 * of it does.
 *
 * Completed steps are left alone — skipping is for work not yet done, and a
 * step the member already finished must never be recorded as deferred.
 */
export const skipAllSteps = async (
	userId: string,
): Promise<OnboardingStatusResponse> => {
	const status = await getOnboardingStatus(userId);

	if (status.onboardingCompleted) {
		throw new OnboardingServiceError(
			"ALREADY_COMPLETED",
			"Onboarding has already been completed",
		);
	}

	const toSkip = APP_OWNED_STEPS.filter(
		(step) =>
			SKIPPABLE_STEPS.has(step) &&
			!status.completedSteps.includes(step) &&
			!status.skippedSteps.includes(step),
	);

	if (toSkip.length === 0) {
		return status;
	}

	const skippedAfter = new Set<string>([...status.skippedSteps, ...toSkip]);
	// Where the wizard should sit afterwards: the first step still neither
	// done nor deferred. With every app-owned step skippable that is nothing,
	// so this lands on COMPLETED — but it stays correct if SKIPPABLE_STEPS
	// ever shrinks again.
	const nextStep =
		APP_OWNED_STEPS.find(
			(step) =>
				!status.completedSteps.includes(step) && !skippedAfter.has(step),
		) ?? OnboardingStep.COMPLETED;

	const userObjectId = toObjectId(userId, "NOT_FOUND", "Invalid user ID");
	const setFields: Record<string, unknown> = {
		"onboardingStatus.currentStep": nextStep,
	};
	if (!status.completedSteps.length && !status.skippedSteps.length) {
		setFields["onboardingStatus.startedAt"] = new Date();
	}

	await User.findByIdAndUpdate(userObjectId, {
		$addToSet: { "onboardingStatus.skippedSteps": { $each: toSkip } },
		$set: setFields,
	});

	return getOnboardingStatus(userId);
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
	] as const;

	const status = user.onboardingStatus;
	const missingSteps: string[] = [];

	for (const flag of requiredFlags) {
		if (!status?.[flag]) {
			missingSteps.push(flag);
		}
	}

	const hasBookingDoc = await UnifiedBooking.exists({
		...NUTRITIONIST_BOOKING_FILTER,
		userId: userObjectId,
		status: { $ne: UnifiedBookingStatus.REJECTED },
	});

	if (!hasBookingDoc && !status?.nutritionistBooked) {
		missingSteps.push("nutritionistBooked");
	}

	for (const sharedStep of SHARED_ONBOARDING_STEPS) {
		if (!status?.[SHARED_STEP_FLAG_MAP[sharedStep]]) {
			missingSteps.push(sharedStep);
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
			"onboardingStatus.appOnboardingCompleted": true,
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
