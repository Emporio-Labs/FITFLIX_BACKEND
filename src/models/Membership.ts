import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";
import { MembershipStatus } from "./Enums";

const membershipSchema = new mongoose.Schema(
	{
		user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
		planName: { type: String, required: true },
		creditsIncluded: { type: Number, required: true, min: 0, default: 0 },
		creditsRemaining: { type: Number, required: true, min: 0, default: 0 },
		status: {
			type: String,
			enum: Object.values(MembershipStatus),
			default: MembershipStatus.Active,
			required: true,
		},
		price: { type: Number, required: true, min: 0 },
		currency: { type: String, default: "USD" },
		startDate: { type: Date, required: true },
		endDate: { type: Date },
		features: { type: [String], default: [] },
		notes: { type: String, default: "" },
	},
	{ timestamps: true },
);

membershipSchema.index({ user: 1, status: 1, endDate: 1, startDate: 1 });
membershipSchema.index({ user: 1, endDate: 1 });

applyIdTransform(membershipSchema);

type MembershipDocument = mongoose.InferSchemaType<typeof membershipSchema>;

export default (mongoose.models
	.Membership as mongoose.Model<MembershipDocument>) ||
	mongoose.model<MembershipDocument>("Membership", membershipSchema);
