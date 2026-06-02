Object.defineProperty(exports, "__esModule", { value: true });
var mongoose_1 = require("mongoose");
var Enums_1 = require("./Enums");
var userSchema = new mongoose_1.default.Schema(
	{
		username: { type: String, required: true },
		phone: { type: String, required: true },
		email: { type: String, required: true },
		age: { type: Number, required: true, min: 0 },
		gender: {
			type: String,
			enum: Object.values(Enums_1.Gender),
			required: true,
		},
		healthGoals: { type: [String], default: [] },
		dateOfBirth: { type: Date, default: undefined },
		emergencyContact: { type: String, default: undefined },
		address: { type: String, default: undefined },
		passwordHash: { type: String, required: true, select: false },
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
				enum: Object.values(Enums_1.OnboardingStep),
				default: Enums_1.OnboardingStep.HEALTH_MARKERS,
			},
			completedSteps: [
				{ type: String, enum: Object.values(Enums_1.OnboardingStep) },
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
exports.default =
	mongoose_1.default.models.User ||
	mongoose_1.default.model("User", userSchema);
