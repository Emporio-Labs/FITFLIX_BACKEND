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
		return undefined;
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

const requiredString = z.string().trim().min(1);

const optionalString = z.preprocess((value) => {
	if (typeof value === "string" && value.trim() === "") {
		return undefined;
	}

	return value;
}, z.string().trim().min(1).optional());

const requiredAgeNumber = z.preprocess((value) => {
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

const optionalAgeNumber = z.preprocess((value) => {
	if (value === undefined || value === null) {
		return undefined;
	}

	if (typeof value === "string" && value.trim() === "") {
		return undefined;
	}

	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === "string") {
		return Number(value.trim());
	}

	return value;
}, z.number().int().min(0).max(130).optional());

const requiredGenderString = z.preprocess(
	normalizeGender,
	z.enum(genderValues),
);

const optionalGenderString = z.preprocess((value) => {
	if (value === undefined || value === null) {
		return undefined;
	}

	return normalizeGender(value);
}, z.enum(genderValues).optional());

const optionalDate = z.preprocess((value) => {
	if (value === undefined || value === null) {
		return undefined;
	}

	if (typeof value === "string" && value.trim() === "") {
		return undefined;
	}

	if (value instanceof Date) {
		return value;
	}

	if (typeof value === "string" || typeof value === "number") {
		const parsedDate = new Date(value);
		if (!Number.isNaN(parsedDate.getTime())) {
			return parsedDate;
		}
	}

	return value;
}, z.date().optional());

const strongPassword = z
	.string()
	.min(8, "Password must be at least 8 characters")
	.regex(/[A-Za-z]/, "Password must include at least one letter")
	.regex(/\d/, "Password must include at least one number");

export const createUserBodySchema = z.object({
	username: requiredString,
	phone: requiredString,
	email: z.string().email(),
	age: requiredAgeNumber,
	gender: requiredGenderString,
	password: strongPassword,
	dateOfBirth: optionalDate,
	emergencyContact: optionalString,
	address: optionalString,
	onboarded: z.boolean().optional().default(false),
});

export const updateUserBodySchema = z
	.object({
		username: optionalString,
		phone: optionalString,
		email: z.preprocess((value) => {
			if (typeof value === "string" && value.trim() === "") {
				return undefined;
			}

			return value;
		}, z.string().email().optional()),
		age: optionalAgeNumber,
		gender: optionalGenderString,
		dateOfBirth: optionalDate,
		emergencyContact: optionalString,
		address: optionalString,
		password: strongPassword.optional(),
		onboarded: z.boolean().optional(),
	})
	.refine((payload) => Object.keys(payload).length > 0, {
		message: "At least one field is required",
	});

export const updateMyPasswordBodySchema = z
	.object({
		currentPassword: z.string().min(1, "Current password is required"),
		newPassword: strongPassword,
	})
	.refine((payload) => payload.currentPassword !== payload.newPassword, {
		message: "New password must be different from current password",
		path: ["newPassword"],
	});

export type CreateUserBody = z.infer<typeof createUserBodySchema>;
export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;
export type UpdateMyPasswordBody = z.infer<typeof updateMyPasswordBodySchema>;

export const listUsersQuerySchema = z.object({
	search: z.string().trim().optional(),
	status: z
		.enum(["all", "pending", "booked"])
		.optional()
		.default("all")
		.transform((v) => (v === "all" ? undefined : v)),
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(20),
	sort: z
		.enum(["username", "email", "phone", "createdAt"])
		.default("createdAt"),
	order: z.enum(["asc", "desc"]).default("desc"),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
