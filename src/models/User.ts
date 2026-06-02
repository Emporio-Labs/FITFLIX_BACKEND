import mongoose from "mongoose";
import { Gender, OnboardingStep } from "./Enums";
import { applyIdTransform } from "../utils/mongoose-serialization";

const userSchema = new mongoose.Schema(
	{
		username: { type: String, required: true },
		phone: { type: String, required: true },
		// Firebase phone-auth identity (user app). Sparse-unique so legacy
		// email/password users without a firebaseUid are unaffected.
		firebaseUid: { type: String, unique: true, sparse: true, default: undefined },
		phoneVerified: { type: Boolean, default: false },
		// Email/password are no longer required for user-app (phone-auth) accounts.
		email: { type: String, unique: true, sparse: true, default: undefined },
		age: { type: Number, required: true, min: 0 },
		gender: { type: String, enum: Object.values(Gender), required: true },
		// Basic-profile goal collected at phone signup (distinct from onboarding healthGoals[]).
		goal: { type: String, default: undefined },
		healthGoals: { type: [String], default: [] },
		dateOfBirth: { type: Date, default: undefined },
		emergencyContact: { type: String, default: undefined },
		address: { type: String, default: undefined },
		passwordHash: { type: String, select: false },
		onboarded: { type: Boolean, default: false },
		fcmTokens: {
			type: [
				{
					token: { type: String, required: true },
					platform: { type: String, enum: ["ios", "android"], required: true },
					lastSeenAt: { type: Date, default: Date.now },
				},
			],
			default: [],
			select: false,
		},
		onboardingStatus: {
			currentStep: {
				type: String,
				enum: Object.values(OnboardingStep),
				default: OnboardingStep.HEALTH_MARKERS,
			},
			completedSteps: [
				{ type: String, enum: Object.values(OnboardingStep) },
			],
			healthMarkersCompleted: { type: Boolean, default: false },
			healthGoalsCompleted: { type: Boolean, default: false },
			consentCompleted: { type: Boolean, default: false },
			reportsUploaded: { type: Boolean, default: false },
			sportsScientistBooked: { type: Boolean, default: false },
			nutritionistBooked: { type: Boolean, default: false },
			onboardingCompleted: { type: Boolean, default: false },
			startedAt: { type: Date, default: undefined },
			completedAt: { type: Date, default: undefined },
		},
	},
	{ timestamps: true },
);

// Enforce one account per phone number for phone-auth (user app) accounts only.
// Partial filter keeps legacy email users with blank/duplicate phones unaffected.
userSchema.index(
	{ phone: 1 },
	{ unique: true, partialFilterExpression: { firebaseUid: { $exists: true } } },
);

applyIdTransform(userSchema);

type UserDocument = mongoose.InferSchemaType<typeof userSchema>;

export default (mongoose.models.User as mongoose.Model<UserDocument>) ||
	mongoose.model<UserDocument>("User", userSchema);
