import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";
import { InvoicePaymentMethod, InvoicePaymentStatus } from "./Enums";

const invoiceItemSchema = new mongoose.Schema(
	{
		name: { type: String, required: true },
		price: { type: Number, required: true, min: 0 },
		quantity: { type: Number, required: true, min: 1 },
	},
	{ _id: false },
);

const planSnapshotSchema = new mongoose.Schema(
	{
		name: { type: String, required: true },
		durationInDays: { type: Number, required: true, min: 1 },
		price: { type: Number, required: true, min: 0 },
		includedCredits: { type: Number, required: true, min: 0 },
	},
	{ _id: false },
);

const invoiceSchema = new mongoose.Schema(
	{
		invoiceNumber: { type: String, required: true, unique: true },
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: undefined,
		},
		leadId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Lead",
			default: undefined,
		},
		items: { type: [invoiceItemSchema], required: true },
		subtotal: { type: Number, required: true, min: 0 },
		tax: { type: Number, default: 0, min: 0 },
		discount: { type: Number, default: 0, min: 0 },
		total: { type: Number, required: true, min: 0 },
		planSnapshot: { type: planSnapshotSchema, required: true },
		paymentStatus: {
			type: String,
			enum: Object.values(InvoicePaymentStatus),
			default: InvoicePaymentStatus.DRAFT,
			required: true,
		},
		paymentMethod: {
			type: String,
			enum: Object.values(InvoicePaymentMethod),
			default: InvoicePaymentMethod.NONE,
		},
		issuedAt: { type: Date, default: undefined },
		paidAt: { type: Date, default: undefined },
		createdBy: { type: mongoose.Schema.Types.ObjectId, default: undefined },
	},
	{ timestamps: true },
);

invoiceSchema.index({ userId: 1 });
invoiceSchema.index({ leadId: 1 });
invoiceSchema.index({ paymentStatus: 1 });
invoiceSchema.index({ createdAt: -1 });

applyIdTransform(invoiceSchema);

type InvoiceDocument = mongoose.InferSchemaType<typeof invoiceSchema>;

export default (mongoose.models.Invoice as mongoose.Model<InvoiceDocument>) ||
	mongoose.model<InvoiceDocument>("Invoice", invoiceSchema);
