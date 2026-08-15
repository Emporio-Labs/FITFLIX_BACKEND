import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";
import { MembershipStatus } from "./Enums";

const membershipSchema = new mongoose.Schema(
	{
		user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
		planName: { type: String, required: true },
		category: {
			type: String,
			enum: ["PERSONAL_TRAINING", "GENERAL_MEMBERSHIP", "THERAPY_PACK", "CREDIT_PACK"],
			default: "GENERAL_MEMBERSHIP",
		},
		creditsIncluded: { type: Number, required: true, min: 0, default: 0 },
		creditsRemaining: { type: Number, required: true, min: 0, default: 0 },
		ptSessionsIncluded: { type: Number, default: 0, min: 0 },
		ptSessionsRemaining: { type: Number, default: 0, min: 0 },
		ptSessionsUsed: { type: Number, default: 0, min: 0 },
		assignedTrainerId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Trainer",
			default: null,
		},
		assignedTrainerName: { type: String, default: "" },
		allowEarlyRenewal: { type: Boolean, default: true },
		// How this membership came to exist. Comped value must stay separable
		// from paid value for revenue reporting, so a grace grant is its own
		// zero-price membership rather than an increment on a purchased one.
		source: {
			type: String,
			enum: ["PURCHASE", "GRANT", "MIGRATION"],
			default: "PURCHASE",
		},
		grantedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
		grantReason: { type: String, default: "" },
		// Branch that sold this membership. Consumption location is recorded
		// separately on each CreditTransaction, since a member may train at a
		// branch other than the one that sold them the package.
		locationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Location",
			default: null,
			index: true,
		},
		// Freeze history. Pausing stops access, and on resume the unused days
		// are added back to endDate (capped by the location's
		// pauseMaxDaysPerTerm) so a freeze doesn't silently burn paid days.
		pauseIntervals: {
			type: [
				new mongoose.Schema(
					{
						pausedAt: { type: Date, required: true },
						resumedAt: { type: Date, default: null },
						days: { type: Number, default: 0, min: 0 },
						pausedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
						reason: { type: String, default: "" },
					},
					{ _id: false },
				),
			],
			default: [],
		},
		// Running total of days already credited back, enforced against the cap.
		totalPausedDays: { type: Number, default: 0, min: 0 },
		status: {
			type: String,
			enum: Object.values(MembershipStatus),
			default: MembershipStatus.Active,
			required: true,
		},
		price: { type: Number, required: true, min: 0 },
		currency: { type: String, default: "INR" },
		startDate: { type: Date, required: true },
		endDate: { type: Date },
		features: { type: [String], default: [] },
		notes: { type: String, default: "" },
	},
	{ timestamps: true },
);

membershipSchema.index({ user: 1, status: 1, endDate: 1, startDate: 1 });
membershipSchema.index({ user: 1, endDate: 1 });
// Drives the expiry sweep, which scans by status + endDate across all users.
// Without a status-prefixed index that job is a collection scan every tick.
membershipSchema.index({ status: 1, endDate: 1 });

applyIdTransform(membershipSchema);

type MembershipDocument = mongoose.InferSchemaType<typeof membershipSchema>;

export default (mongoose.models
	.Membership as mongoose.Model<MembershipDocument>) ||
	mongoose.model<MembershipDocument>("Membership", membershipSchema);
