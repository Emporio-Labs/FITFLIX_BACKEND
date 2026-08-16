import z from "zod";
import { Gender } from "../models/Enums";

const genderValues = Object.values(Gender) as [string, ...string[]];

const legacyNumericGender: Record<string, string> = {
	"0": Gender.Male,
	"1": Gender.Female,
	"2": Gender.Other,
};

const normalizeGender = (value: unknown): unknown => {
	if (typeof value === "number" && Number.isInteger(value)) {
		return legacyNumericGender[String(value)] ?? value;
	}

	if (typeof value !== "string") {
		return value;
	}

	const normalized = value.trim();
	if (!normalized) {
		return value;
	}

	if (/^\d+$/.test(normalized) && legacyNumericGender[normalized]) {
		return legacyNumericGender[normalized];
	}

	const lower = normalized.toLowerCase();
	if (lower === "others") {
		return Gender.Other;
	}

	const enumMatch = genderValues.find(
		(genderValue) => genderValue.toLowerCase() === lower,
	);
	return enumMatch ?? normalized;
};

const signupAgeSchema = z.preprocess((value) => {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === "string") {
		const normalized = value.trim();
		if (!normalized) {
			return value;
		}

		return Number(normalized);
	}

	return value;
}, z.number().int().min(0).max(130));

const signupGenderSchema = z.preprocess(normalizeGender, z.enum(genderValues));

const strongPassword = z
	.string()
	.min(8, "Password must be at least 8 characters")
	.regex(/[A-Za-z]/, "Password must include at least one letter")
	.regex(/\d/, "Password must include at least one number");

export const signupBodySchema = z.object({
	username: z.string().trim().min(1),
	phone: z.string().trim().min(1),
	email: z.string().email().toLowerCase(),
	age: signupAgeSchema,
	gender: signupGenderSchema,
	password: strongPassword,
});

export const loginBodySchema = z.object({
	email: z.string().email().toLowerCase(),
	password: z.string().min(1),
});

export const refreshTokenBodySchema = z.object({
	refreshToken: z.string().min(1),
});

export const phoneVerifyBodySchema = z.object({
	firebaseIdToken: z.string().trim().min(1),
});

export const phoneRegisterBodySchema = z.object({
	firebaseIdToken: z.string().trim().min(1),
	name: z.string().trim().min(1),
	goal: z.string().trim().min(1),
	age: signupAgeSchema,
	gender: signupGenderSchema,
	// Optional so an older app build still registers, and defaulting to false
	// because a client that says nothing has not obtained consent. The
	// controller additionally discards a `true` from anyone under 18.
	marketingConsent: z.boolean().optional().default(false),
});

export type SignupBody = z.infer<typeof signupBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type RefreshTokenBody = z.infer<typeof refreshTokenBodySchema>;
export type PhoneVerifyBody = z.infer<typeof phoneVerifyBodySchema>;
export type PhoneRegisterBody = z.infer<typeof phoneRegisterBodySchema>;
