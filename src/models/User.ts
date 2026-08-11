import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";
import { CommunityRole, Gender, OnboardingStep, UserStatus } from "./Enums";

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
		// Community account gate. Insider/outsider is DERIVED from membership;
		// this only governs suspend/ban. Legacy users without the field read as
		// active (default applied on hydration; treat undefined as active in code).
		status: {
			type: String,
			enum: Object.values(UserStatus),
			default: UserStatus.Active,
		},
		// Suspension end date (set alongside status = suspended).
		suspendedUntil: { type: Date, default: null },
		// Admin-granted community elevation ("trainer") — overrides the derived
		// insider/outsider role in the community feed. NULL for regular members.
		communityRole: {
			type: String,
			enum: [...Object.values(CommunityRole), null],
			default: null,
		},
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
			completedSteps: [{ type: String, enum: Object.values(OnboardingStep) }],
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
		// One primary trainer per member, mirroring how nutrition tracks
		// createdByNutritionist on NutritionProfile rather than a join table.
		assignedTrainer: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Trainer",
			default: null,
		},
		assignedTrainerAt: { type: Date, default: null },
	},
	{ timestamps: true },
);

userSchema.index({ assignedTrainer: 1 });

// Enforce one account per phone number for phone-auth (user app) accounts only.
// Partial filter keeps legacy email users with blank/duplicate phones unaffected.
userSchema.index(
	{ phone: 1 },
	{ unique: true, partialFilterExpression: { firebaseUid: { $exists: true } } },
);

// Community people-search looks up members by name. Index only — NO new field,
// because `GET /users/me` and `/users/:id` serialize the whole document, so
// anything added to this schema leaks into every existing response.
userSchema.index({ username: 1 });

applyIdTransform(userSchema);

type UserDocument = mongoose.InferSchemaType<typeof userSchema>;

export default (mongoose.models.User as mongoose.Model<UserDocument>) ||
	mongoose.model<UserDocument>("User", userSchema);
