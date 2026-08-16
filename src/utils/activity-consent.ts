/**
 * Whether we are allowed to record behaviour for a given person.
 *
 * India's DPDP Act 2023 draws two separate lines and this module enforces
 * both, in one place, so no caller can accidentally observe only one:
 *
 *  1. **Children.** Behavioural tracking, monitoring and targeted advertising
 *     aimed at under-18s is prohibited outright. Consent does not unlock it —
 *     not the child's, not a parent's, as far as this feature is concerned.
 *     So the age check runs first and is not overridable.
 *
 *  2. **Everyone else.** Tracking that feeds sales follow-up needs granular,
 *     specific consent. A blanket privacy-policy acceptance is not valid, so
 *     `onboardingStatus.consentCompleted` deliberately does NOT count here —
 *     that is health-onboarding consent for a different purpose.
 *
 * Absence is refusal. A user record with no `privacyConsent` block has not
 * agreed to anything, which is why every unknown shape below resolves to
 * false rather than to a permissive default.
 *
 * This is enforced server-side because a client-side gate is not a gate: the
 * endpoint is reachable regardless of what the app decides to send.
 */

/** DPDP's threshold. Named rather than inlined so the rule is greppable. */
export const MINOR_AGE_THRESHOLD = 18;

export type ConsentSubject = {
	age?: number | null;
	dateOfBirth?: Date | null;
	privacyConsent?: {
		behaviouralTracking?: boolean | null;
	} | null;
};

export type ConsentDecision =
	| { allowed: true }
	| { allowed: false; reason: "minor" | "no_consent" | "unknown_age" };

/**
 * Prefer date of birth when we have it: `age` is captured once at signup and
 * then silently rots, so a 17-year-old who signed up last year still reads as
 * 17 forever. Getting this backwards would keep someone in the prohibited
 * class after they aged out — or worse, out of it before they aged in.
 */
export const resolveAge = (subject: ConsentSubject, now = new Date()): number | null => {
	if (subject.dateOfBirth instanceof Date && !Number.isNaN(subject.dateOfBirth.getTime())) {
		const dob = subject.dateOfBirth;
		let age = now.getFullYear() - dob.getFullYear();
		const beforeBirthdayThisYear =
			now.getMonth() < dob.getMonth() ||
			(now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());
		if (beforeBirthdayThisYear) age -= 1;
		return age;
	}
	if (typeof subject.age === "number" && Number.isFinite(subject.age)) {
		return subject.age;
	}
	return null;
};

export const mayRecordBehaviour = (
	subject: ConsentSubject,
	now = new Date(),
): ConsentDecision => {
	const age = resolveAge(subject, now);

	// Not knowing someone's age is not permission to profile them.
	if (age === null) return { allowed: false, reason: "unknown_age" };
	if (age < MINOR_AGE_THRESHOLD) return { allowed: false, reason: "minor" };

	if (subject.privacyConsent?.behaviouralTracking !== true) {
		return { allowed: false, reason: "no_consent" };
	}

	return { allowed: true };
};
