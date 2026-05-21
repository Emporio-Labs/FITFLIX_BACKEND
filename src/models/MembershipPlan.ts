import mongoose from "mongoose";

const membershipPlanSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        description: { type: String, default: "" },
        price: { type: Number, required: true, min: 0 },
        currency: { type: String, default: "USD" },
        creditsIncluded: { type: Number, required: true, min: 0, default: 0 },
        features: { type: [String], default: [] },
        active: { type: Boolean, default: true },
        gymId: { type: String, required: false },
    },
    { timestamps: true },
);

membershipPlanSchema.index({ name: 1 });

type MembershipPlanDocument = mongoose.InferSchemaType<typeof membershipPlanSchema>;

export default (mongoose.models.MembershipPlan as mongoose.Model<MembershipPlanDocument>) ||
    mongoose.model<MembershipPlanDocument>("MembershipPlan", membershipPlanSchema);
