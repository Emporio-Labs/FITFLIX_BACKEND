import mongoose from "mongoose";
import { CreditTransactionSource, CreditTransactionType } from "./Enums";

const creditTransactionSchema = new mongoose.Schema(
	{
		user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
		membership: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Membership",
			required: true,
		},
		amount: {
			type: Number,
			required: true,
			validate: {
				validator: (value: number) => value !== 0,
				message: "amount must be non-zero",
			},
		},
		type: {
			type: String,
			enum: Object.values(CreditTransactionType),
			required: true,
		},
		sourceType: {
			type: String,
			enum: Object.values(CreditTransactionSource),
			required: true,
		},
		sourceId: {
			type: mongoose.Schema.Types.ObjectId,
			default: undefined,
		},
		reason: { type: String, default: "" },
		actorId: {
			type: mongoose.Schema.Types.ObjectId,
			default: undefined,
		},
		actorRole: {
			type: String,
			enum: ["admin", "user", "doctor", "trainer", "nutritionist"],
			default: undefined,
		},
		metadata: {
			type: mongoose.Schema.Types.Mixed,
			default: undefined,
		},
	},
	{ timestamps: true },
);

creditTransactionSchema.index({ user: 1, createdAt: -1 });
creditTransactionSchema.index({ sourceType: 1, sourceId: 1, type: 1 });
creditTransactionSchema.index({ membership: 1, createdAt: -1 });

type CreditTransactionDocument = mongoose.InferSchemaType<
	typeof creditTransactionSchema
>;

export default (mongoose.models
	.CreditTransaction as mongoose.Model<CreditTransactionDocument>) ||
	mongoose.model<CreditTransactionDocument>(
		"CreditTransaction",
		creditTransactionSchema,
	);
