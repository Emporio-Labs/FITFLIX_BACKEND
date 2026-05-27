import z from "zod";
import { Gender, LeadStatus } from "../models/Enums";
import {
	assessmentQuestionIdsByVersion,
	assessmentVersions,
} from "../utils/health-score";

const leadStatusValues = Object.values(LeadStatus) as [string, ...string[]];
const genderValues = Object.values(Gender).map(String);

const fitflixGenderOptions = [
	"Prefer not to say",
	"Male",
	"Female",
	"Non-binary",
	"Other",
] as const;

const fitflixHealthGoalOptions = [
	"Weight Management",
	"Build Strength & Muscle",
	"Improve Cardiovascular Health",
	"Stress & Mental Wellness",
	"Longevity & Disease Prevention",
	"Better Sleep & Recovery",
	"Hormone & Metabolic Balance",
	"General Fitness & Energy",
] as const;

const fitflixFitnessLevelOptions = [
	"Beginner (0-6 months)",
	"Intermediate (6mo - 2yrs)",
	"Active (2-5 years)",
	"Advanced (5+ years)",
] as const;

const fitflixWellnessInterestOptions = [
	"Yoga & Mindfulness",
	"Strength Training",
	"Nutrition & Diet",
	"Sleep Optimisation",
	"Biohacking & Longevity",
	"Cardio & Endurance",
	"Detox & Cleansing",
	"Mental Health & Therapy",
	"Spa & Recovery",
] as const;

const publicFormTypeOptions = ["healthscore", "callback"] as const;

const fitflixAgeSchema = z.preprocess((value) => {
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
}, z.number().int().min(16).max(99));

const fitflixPersonalDetailsSchema = z.object({
	fullName: z.string().trim().min(1),
	phoneNumber: z.string().trim().min(1),
	emailAddress: z.string().trim().email(),
	age: fitflixAgeSchema.optional(),
	gender: z.enum(fitflixGenderOptions).optional(),
	city: z.string().trim().min(1).optional(),
	primaryHealthGoal: z.enum(fitflixHealthGoalOptions).optional(),
	fitnessLevel: z.enum(fitflixFitnessLevelOptions).optional(),
	wellnessInterests: z
		.array(z.enum(fitflixWellnessInterestOptions))
		.default([]),
	notes: z.string().trim().optional(),
});

const fitflixAssessmentSchema = z
	.object({
		version: z.enum(assessmentVersions),
		answers: z.record(z.string().trim().min(1), z.number().int().min(1).max(4)),
	})
	.superRefine((payload, ctx) => {
		const expectedQuestionIds = assessmentQuestionIdsByVersion[payload.version];
		const providedQuestionIds = Object.keys(payload.answers);

		if (providedQuestionIds.length !== expectedQuestionIds.length) {
			ctx.addIssue({
				code: "custom",
				path: ["answers"],
				message: `${payload.version} requires ${expectedQuestionIds.length} answers`,
			});
		}

		for (const questionId of providedQuestionIds) {
			if (!expectedQuestionIds.includes(questionId)) {
				ctx.addIssue({
					code: "custom",
					path: ["answers", questionId],
					message: `Unexpected question id for ${payload.version}`,
				});
			}
		}

		for (const questionId of expectedQuestionIds) {
			if (payload.answers[questionId] === undefined) {
				ctx.addIssue({
					code: "custom",
					path: ["answers", questionId],
					message: "Missing score for required question",
				});
			}
		}
	});

export const createLeadBodySchema = z.object({
	leadName: z.string().trim().min(1),
	email: z.string().trim().email(),
	phone: z.string().trim().min(1).optional(),
	source: z.string().trim().min(1).optional(),
	interestedIn: z.string().trim().min(1).optional(),
	notes: z.string().trim().optional(),
	tags: z.array(z.string().trim().min(1)).default([]),
	followUpDate: z.string().trim().min(1).optional(),
	ownerId: z.string().trim().min(1).optional(),
	status: z.enum(leadStatusValues).optional(),
});

export const publicLeadCaptureBodySchema = z
	.object({
		formType: z.enum(publicFormTypeOptions).optional(),
		name: z.string().trim().min(1).optional(),
		leadName: z.string().trim().min(1).optional(),
		email: z.string().trim().email().optional(),
		phone: z.string().trim().min(1).optional(),
		interests: z.array(z.string().trim().min(1)).default([]),
		intrests: z.array(z.string().trim().min(1)).optional(),
		source: z.string().trim().min(1).optional(),
		interestedIn: z.string().trim().min(1).optional(),
		notes: z.string().trim().optional(),
		tags: z.array(z.string().trim().min(1)).default([]),
		followUpDate: z.string().trim().min(1).optional(),
		personalDetails: fitflixPersonalDetailsSchema.optional(),
		assessment: fitflixAssessmentSchema.optional(),
		captchaToken: z.string().trim().min(1).optional(),
		website: z.string().trim().optional(),
	})
	.superRefine((payload, ctx) => {
		const hasLegacyIdentity = Boolean(payload.leadName && payload.email);
		const hasFitflixIdentity = Boolean(
			payload.personalDetails?.fullName &&
				payload.personalDetails?.emailAddress,
		);
		const hasCallbackIdentity = Boolean(
			payload.name && payload.phone && payload.email,
		);

		if (!hasLegacyIdentity && !hasFitflixIdentity && !hasCallbackIdentity) {
			ctx.addIssue({
				code: "custom",
				path: ["leadName"],
				message:
					"Provide either callback name/phone/email, leadName/email, or personalDetails.fullName/emailAddress",
			});
		}
	});

export const updateLeadBodySchema = createLeadBodySchema
	.partial()
	.refine((payload) => Object.keys(payload).length > 0, {
		message: "At least one field is required",
	});

export const convertLeadBodySchema = z.object({
	username: z.string().trim().min(1).optional(),
	phone: z.string().trim().min(1),
	age: z.string().trim().min(1),
	gender: z.enum(genderValues as [string, ...string[]]),
	healthGoals: z.array(z.string().trim().min(1)).default([]),
	password: z.string().min(1),
});

export type CreateLeadBody = z.infer<typeof createLeadBodySchema>;
export type PublicLeadCaptureBody = z.infer<typeof publicLeadCaptureBodySchema>;
export type UpdateLeadBody = z.infer<typeof updateLeadBodySchema>;
export type ConvertLeadBody = z.infer<typeof convertLeadBodySchema>;
