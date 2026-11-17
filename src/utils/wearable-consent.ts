/**
 * Whether we may store, and whether staff may see, a member's wearable data.
 *
 * Health data under India's DPDP Act 2023 needs specific, granular consent for
 * each purpose, and Apple (App Review 5.1.3) and Google (Health Connect
 * policy) both require that it be used only for the feature the user turned
 * on. So there are two independent switches:
 *
 *  1. `wearableSync` — syncing into Fitflix at all.
 *  2. `coachSharing` — the member's assigned coach seeing it.
 *
 * Under-18s are refused outright, and an unknown age is refused too, using
 * the same age rule as behaviour tracking (activity-consent.ts) so the two
 * can never disagree about who is a minor.
 *
 * Absence is refusal: a user with no `healthDataConsent` block has agreed to
 * nothing.
 */
import { MINOR_AGE_THRESHOLD, resolveAge } from "./activity-consent";

export type WearableConsentSubject = {
	age?: number | null;
	dateOfBirth?: Date | null;
	healthDataConsent?: {
		wearableSync?: boolean | null;
		coachSharing?: boolean | null;
	} | null;
};

export type WearableConsentDecision =
	| { allowed: true }
	| { allowed: false; reason: "minor" | "no_consent" | "unknown_age" };

const ageGate = (
	subject: WearableConsentSubject,
	now: Date,
): WearableConsentDecision | null => {
	const age = resolveAge(subject, now);
	if (age === null) return { allowed: false, reason: "unknown_age" };
	if (age < MINOR_AGE_THRESHOLD) return { allowed: false, reason: "minor" };
	return null;
};

/** May we accept and store wearable data for this person? */
export const mayStoreWearableData = (
	subject: WearableConsentSubject,
	now = new Date(),
): WearableConsentDecision => {
	const refused = ageGate(subject, now);
	if (refused) return refused;
	if (subject.healthDataConsent?.wearableSync !== true) {
		return { allowed: false, reason: "no_consent" };
	}
	return { allowed: true };
};

/**
 * May staff see this person's wearable data? Requires both switches: sharing
 * without syncing is meaningless, and syncing alone is not permission to share.
 * Roster ownership (is this *their* coach?) is checked separately by the caller.
 */
export const mayStaffViewWearableData = (
	subject: WearableConsentSubject,
	now = new Date(),
): WearableConsentDecision => {
	const stored = mayStoreWearableData(subject, now);
	if (!stored.allowed) return stored;
	if (subject.healthDataConsent?.coachSharing !== true) {
		return { allowed: false, reason: "no_consent" };
	}
	return { allowed: true };
};

/** Whether this person can turn wearable sync on at all (for the app's UI). */
export const isEligibleForWearables = (
	subject: WearableConsentSubject,
	now = new Date(),
): boolean => ageGate(subject, now) === null;
