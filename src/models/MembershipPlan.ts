import mongoose from "mongoose";

const membershipPlanSchema = new mongoose.Schema(
	{
		name: { type: String, required: true },
		description: { type: String, default: "" },
		price: { type: Number, required: true, min: 0 },
		currency: { type: String, default: "INR" },
		creditsIncluded: { type: Number, required: true, min: 0, default: 0 },
		category: {
			type: String,
			enum: ["PERSONAL_TRAINING", "GENERAL_MEMBERSHIP", "THERAPY_PACK", "CREDIT_PACK"],
			default: "GENERAL_MEMBERSHIP",
		},
		ptSessionsIncluded: { type: Number, default: 0, min: 0 },
		taxRatePercent: { type: Number, default: 18, min: 0 },
		sacCode: { type: String, default: "999723" },
		allowEarlyRenewal: { type: Boolean, default: true },
		features: { type: [String], default: [] },
		active: { type: Boolean, default: true },
		gymId: { type: String, required: false },
		durationMonths: { type: Number, required: true, min: 1, default: 1 },
		durationDays: { type: Number, default: 30 },
		benefits: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
	},
	{ timestamps: true },
);

membershipPlanSchema.index({ name: 1 });

type MembershipPlanDocument = mongoose.InferSchemaType<
	typeof membershipPlanSchema
>;

export default (mongoose.models
	.MembershipPlan as mongoose.Model<MembershipPlanDocument>) ||
	mongoose.model<MembershipPlanDocument>(
		"MembershipPlan",
		membershipPlanSchema,
	);
