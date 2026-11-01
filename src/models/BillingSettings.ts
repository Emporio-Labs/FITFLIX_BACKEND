import mongoose from "mongoose";

const billingSettingsSchema = new mongoose.Schema(
	{
		taxRatePercent: {
			type: Number,
			default: 5,
			min: 0,
			max: 100,
			required: true,
		},
		gstin: {
			type: String,
			default: "",
			trim: true,
		},
		currency: {
			type: String,
			default: "INR",
			trim: true,
		},
		sacCode: {
			type: String,
			default: "999723",
			trim: true,
		},
	},
	{ timestamps: true },
);

type BillingSettingsDocument = mongoose.InferSchemaType<
	typeof billingSettingsSchema
>;

export default (mongoose.models.BillingSettings as mongoose.Model<BillingSettingsDocument>) ||
	mongoose.model<BillingSettingsDocument>(
		"BillingSettings",
		billingSettingsSchema,
	);
