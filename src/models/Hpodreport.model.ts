import mongoose, { type Document, Schema, type Types } from "mongoose";

export interface IHpodReport extends Document {
	userId: Types.ObjectId | null;
	userEmail: string;
	gmailMessageId: string;
	subject: string;
	sender: string;
	rawBody: string;
	hasPdf: boolean;
	aiSummary: Record<string, any> | null;
	summaryGeneratedAt: Date | null;
	receivedAt: Date;
	createdAt: Date;
	updatedAt: Date;
}

const HpodReportSchema = new Schema<IHpodReport>(
	{
		userId: {
			type: Schema.Types.ObjectId,
			ref: "User",
			default: null,
		},
		userEmail: {
			type: String,
			required: true,
		},

		gmailMessageId: {
			type: String,
			required: true,
			unique: true,
		},
		subject: {
			type: String,
			default: "(no subject)",
		},
		sender: {
			type: String,
			required: true,
		},

		rawBody: {
			type: String,
			required: true,
		},
		hasPdf: {
			type: Boolean,
			default: false,
		},
		aiSummary: {
			type: Schema.Types.Mixed,
			default: null,
		},
		summaryGeneratedAt: {
			type: Date,
			default: null,
		},

		receivedAt: {
			type: Date,
			default: Date.now,
		},
	},
	{ timestamps: true, collection: "hpod_reports" },
);

export const HpodReport =
	(mongoose.models.HpodReport as mongoose.Model<IHpodReport>) ||
	mongoose.model<IHpodReport>("HpodReport", HpodReportSchema);
