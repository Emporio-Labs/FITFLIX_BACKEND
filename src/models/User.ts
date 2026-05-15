import mongoose from "mongoose";
import { Gender, OnboardingStep } from "./Enums";

const userSchema = new mongoose.Schema(
	{
		username: { type: String, required: true },
		phone: { type: String, required: true },
		email: { type: String, required: true },
		age: { type: Number, required: true, min: 0 },
		gender: { type: String, enum: Object.values(Gender), required: true },
		healthGoals: { type: [String], default: [] },
		dateOfBirth: { type: Date, default: undefined },
		emergencyContact: { type: String, default: undefined },
		address: { type: String, default: undefined },
		passwordHash: { type: String, required: true, select: false },
		onboarded: { type: Boolean, default: false },
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

type UserDocument = mongoose.InferSchemaType<typeof userSchema>;

export default (mongoose.models.User as mongoose.Model<UserDocument>) ||
	mongoose.model<UserDocument>("User", userSchema);
