import z from "zod";
import { ConsentType, ExpertType } from "../models/Enums";
import { ActivityLevel } from "../models/HealthMarkers";
import { WorkoutExperience } from "../models/HealthGoals";

const positiveNumber = z.preprocess((value) => {
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
}, z.number().positive());

const optionalPositiveNumber = z.preprocess((value) => {
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
}, z.number().positive().optional());

const optionalString = z.preprocess((value) => {
	if (typeof value === "string" && value.trim() === "") {
		return undefined;
	}

	return value;
}, z.string().trim().min(1).optional());

const stringArray = z.array(z.string().trim().min(1)).default([]);

const activityLevelValues = Object.values(ActivityLevel) as [
	string,
	...string[],
];

const workoutExperienceValues = Object.values(WorkoutExperience) as [
	string,
	...string[],
];

const expertTypeValues = Object.values(ExpertType) as [string, ...string[]];

export const healthMarkersBodySchema = z.object({
	weight: positiveNumber,
	height: positiveNumber,
	allergies: stringArray,
	medications: stringArray,
	diseaseHistory: stringArray,
	sleepHours: z.preprocess((value) => {
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
	}, z.number().min(0).max(24).optional()),
	activityLevel: z.preprocess((value) => {
		if (value === undefined || value === null) {
			return undefined;
		}

		if (typeof value === "string" && value.trim() === "") {
			return undefined;
		}

		return value;
	}, z.enum(activityLevelValues).optional()),
});

export const healthGoalsBodySchema = z.object({
	goals: z.array(z.string().trim().min(1)).min(1, "At least one goal is required"),
	targetWeight: optionalPositiveNumber,
	timeline: optionalString,
	workoutExperience: z.preprocess((value) => {
		if (value === undefined || value === null) {
			return undefined;
		}

		if (typeof value === "string" && value.trim() === "") {
			return undefined;
		}

		return value;
	}, z.enum(workoutExperienceValues).optional()),
	foodPreferences: stringArray,
});

const consentTypeValues = Object.values(ConsentType) as [string, ...string[]];

const consentEntryValidation = z.object({
	type: z.enum(consentTypeValues, {
		message: `Consent type must be one of: ${consentTypeValues.join(", ")}`,
	}),
	accepted: z.literal(true, {
		message: "Consent must be accepted",
	}),
	signatureName: optionalString,
	dateSigned: z.preprocess(
		(v) => {
			if (v === undefined || v === null) return undefined;
			if (v instanceof Date) return v;
			if (typeof v === "string" || typeof v === "number") {
				const parsed = new Date(v);
				if (!Number.isNaN(parsed.getTime())) return parsed;
			}
			return v;
		},
		z.date().optional(),
	),
});

export const consentBodySchema = z
	.object({
		consents: z
			.array(consentEntryValidation)
			.min(2, "Both consent forms are required")
			.max(2, "Only two consent forms are allowed"),
	})
	.refine(
		(data) => {
			const types = data.consents.map((c) => c.type);
			return (
				types.includes(ConsentType.WELLNESS_SERVICES) &&
				types.includes(ConsentType.GYM_FITNESS)
			);
		},
		{
			message:
				"Both WELLNESS_SERVICES and GYM_FITNESS consents are required",
		},
	);

/** @deprecated Use consentBodySchema with consents array instead */
export const legacyConsentBodySchema = z.object({
	accepted: z.literal(true, {
		message: "Consent must be accepted",
	}),
	signatureUrl: optionalString,
});

export const reportBodySchema = z.object({
	reportName: z.string().trim().min(1, "Report name is required"),
	reportType: z.string().trim().min(1, "Report type is required"),
	reportUrl: optionalString,
});

export const appointmentBodySchema = z.object({
	expertType: z.enum(expertTypeValues, {
		message: `Expert type must be one of: ${expertTypeValues.join(", ")}`,
	}),
	appointmentDate: z.preprocess((value) => {
		if (value === undefined || value === null) {
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
	}, z.date().optional()),
	meetingLink: optionalString,
	calComBookingId: optionalString,
});

export type HealthMarkersBody = z.infer<typeof healthMarkersBodySchema>;
export type HealthGoalsBody = z.infer<typeof healthGoalsBodySchema>;
export type ConsentBody = z.infer<typeof consentBodySchema>;
export type LegacyConsentBody = z.infer<typeof legacyConsentBodySchema>;
export type ReportBody = z.infer<typeof reportBodySchema>;
export type AppointmentBody = z.infer<typeof appointmentBodySchema>;
