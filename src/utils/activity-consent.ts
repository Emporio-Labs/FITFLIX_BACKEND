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

/** Replacement token required by FX-11 whenever personal details appear in an event field. */
export const REDACTED_VALUE = "[redacted]";

export type PiiSubject = {
	username?: string | null;
	email?: string | null;
	phone?: string | null;
};

const PII_FIELD_KEYS = new Set([
	"name",
	"username",
	"fullname",
	"firstname",
	"lastname",
	"middlename",
	"displayname",
	"membername",
	"personname",
	"clientname",
	"customername",
	"leadname",
	"callername",
	"profilename",
	"email",
	"emailaddress",
	"useremail",
	"memberemail",
	"contactemail",
	"mail",
	"phone",
	"phonenumber",
	"mobile",
	"mobilenumber",
	"telephone",
	"tel",
	"cell",
	"cellphone",
	"whatsapp",
	"whatsappnumber",
	"contact",
	"contactnumber",
	"emergencycontact",
]);

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;
const UUID_REGEX =
	/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const WHOLE_PHONE_REGEX = /^\+?[\d()\s.-]{7,20}$/;
const EMBEDDED_PHONE_REGEX = /(?:^|[^\w])(\+?\d[\d\s().-]{8,18}\d)(?:$|[^\w])/;
const PERSONAL_NAME_REGEX = /^[A-Z][a-z]{1,30}(?:\s+[A-Z][a-z]{1,30}){1,3}$/;

const normalizeKey = (key: string): string =>
	key.trim().toLowerCase().replace(/[\s_-]+/g, "");

const digitsOnly = (input: string): string => input.replace(/\D/g, "");

const isLikelyPhoneString = (trimmed: string): boolean => {
	if ( WHOLE_PHONE_REGEX.test(trimmed) ) {
		const digits = digitsOnly(trimmed).length;
		if (digits >= 7 && digits <= 15) return true;
	}
	const embedded = trimmed.match(EMBEDDED_PHONE_REGEX);
	if (embedded?.[1]) {
		const digits = digitsOnly(embedded[1]).length;
		if (digits >= 10 && digits <= 15) return true;
	}
	return false;
};

const matchesSubjectPii = (trimmed: string, subject?: PiiSubject): boolean => {
	if (!subject) return false;
	const lower = trimmed.toLowerCase();

	if (subject.email && subject.email.trim().length > 0) {
		if (lower.includes(subject.email.trim().toLowerCase())) return true;
	}

	if (subject.phone && subject.phone.trim().length > 0) {
		const subjectDigits = digitsOnly(subject.phone);
		const valueDigits = digitsOnly(trimmed);
		if (subjectDigits.length >= 7 && valueDigits.length >= 7) {
			if (valueDigits.includes(subjectDigits)) return true;
			if (
				subjectDigits.length >= 10 &&
				valueDigits.includes(subjectDigits.slice(-10))
			) {
				return true;
			}
		}
	}

	if (subject.username && subject.username.trim().length >= 2) {
		const cleanName = subject.username.trim().toLowerCase();
		if (lower.includes(cleanName)) return true;
		const tokens = cleanName.split(/\s+/).filter((t) => t.length >= 3);
		if (tokens.some((token) => lower === token)) return true;
	}

	return false;
};

/**
 * Scrubs a single parameter key/value pair so phone numbers, email addresses,
 * and personal names are replaced by `'[redacted]'` regardless of which field
 * they were sent in, while preserving safe identifiers (route names, catalog
 * ObjectIds, CTA ids, surfaces).
 */
export const redactPiiValue = (
	key: string,
	value: string | number | boolean,
	subject?: PiiSubject,
): string | number | boolean => {
	if (PII_FIELD_KEYS.has(normalizeKey(key))) {
		return REDACTED_VALUE;
	}

	if (typeof value === "boolean") return value;

	if (typeof value === "number") {
		const abs = Math.abs(value);
		if (
			Number.isInteger(abs) &&
			abs >= 1_000_000_000 &&
			abs <= 999_999_999_999_999
		) {
			return REDACTED_VALUE;
		}
		return value;
	}

	const trimmed = value.trim();
	if (trimmed.length === 0) return value;

	// Never mistake a 24-char Mongo ObjectId or UUID for a phone number.
	if (OBJECT_ID_REGEX.test(trimmed) || UUID_REGEX.test(trimmed)) {
		return value;
	}

	if (EMAIL_REGEX.test(trimmed)) return REDACTED_VALUE;
	if (isLikelyPhoneString(trimmed)) return REDACTED_VALUE;
	if (matchesSubjectPii(trimmed, subject)) return REDACTED_VALUE;
	if (PERSONAL_NAME_REGEX.test(trimmed)) return REDACTED_VALUE;

	return value;
};

export const redactActivityParams = (
	params: Record<string, string | number | boolean> | undefined,
	subject?: PiiSubject,
): Record<string, string | number | boolean> => {
	if (!params) return {};
	const out: Record<string, string | number | boolean> = {};
	for (const [key, value] of Object.entries(params)) {
		out[key] = redactPiiValue(key, value, subject);
	}
	return out;
};

