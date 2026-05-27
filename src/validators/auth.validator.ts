import z from "zod";
import { Gender } from "../models/Enums";

const genderValues = Object.values(Gender).filter(
	(value): value is string => typeof value === "string",
) as [string, ...string[]];

const normalizeGender = (value: unknown): unknown => {
	if (typeof value === "number" && Number.isInteger(value)) {
		const enumValue = Gender[value];
		if (typeof enumValue === "string") {
			return enumValue;
		}
	}

	if (typeof value !== "string") {
		return value;
	}

	const normalized = value.trim();
	if (!normalized) {
		return value;
	}

	if (normalized.toLowerCase() === "other") {
		return "Others";
	}

	const enumMatch = genderValues.find(
		(genderValue) => genderValue.toLowerCase() === normalized.toLowerCase(),
	);
	if (enumMatch) {
		return enumMatch;
	}

	if (/^\d+$/.test(normalized)) {
		const enumValue = Gender[Number(normalized)];
		if (typeof enumValue === "string") {
			return enumValue;
		}
	}

	return normalized;
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
	email: z.string().email(),
	age: signupAgeSchema,
	gender: signupGenderSchema,
	healthGoals: z.array(z.string().trim().min(1)).default([]),
	password: strongPassword,
});

export const loginBodySchema = z.object({
	email: z.string().email(),
	password: z.string().min(1),
});

export const refreshTokenBodySchema = z.object({
	refreshToken: z.string().min(1),
});

export type SignupBody = z.infer<typeof signupBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type RefreshTokenBody = z.infer<typeof refreshTokenBodySchema>;
