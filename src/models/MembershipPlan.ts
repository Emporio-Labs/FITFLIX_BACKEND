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
		// Optional day-level duration. `null` means the plan is measured in months —
		// consumers fall back to durationMonths. A non-null default here would make
		// durationMonths permanently unreachable.
		durationDays: { type: Number, default: null },
		benefits: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
		// The branch this plan is sold at. null = every branch, so a plan is
		// deliberately NOT given locationStampPlugin: stamping the default
		// branch would quietly turn an all-branch plan into a one-branch plan.
		locationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Location",
			default: null,
		},
		// Founding-member (presale) pricing, e.g. a branch that hasn't opened.
		isFounding: { type: Boolean, default: false },
		// Last moment the plan can be sold. null = no cut-off. The list hides
		// plans past this unless asked for them (`includeExpired=true`).
		availableUntil: { type: Date, default: null },
	},
	{ timestamps: true },
);

membershipPlanSchema.index({ name: 1 });
membershipPlanSchema.index({ locationId: 1, active: 1 });

type MembershipPlanDocument = mongoose.InferSchemaType<
	typeof membershipPlanSchema
>;

export default (mongoose.models
	.MembershipPlan as mongoose.Model<MembershipPlanDocument>) ||
	mongoose.model<MembershipPlanDocument>(
		"MembershipPlan",
		membershipPlanSchema,
	);
