import mongoose from "mongoose";
import {
	branchOf,
	homeBranchOf,
	locationStampPlugin,
} from "../utils/location-stamp.plugin";
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
		// Branch this record belongs to (FX-01). Filled on create by
		// locationStampPlugin when the caller doesn't pass one.
		locationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Location",
			default: null,
			index: true,
		},
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

invoiceSchema.plugin(locationStampPlugin, {
	model: "Invoice",
	// The member's home branch; for an invoice raised to a lead before they
	// became a member, the lead's branch (FX-01.2).
	derive: async (doc) =>
		(await homeBranchOf(doc.get("userId"))) ??
		(await branchOf("Lead", doc.get("leadId"))),
});

export default (mongoose.models.Invoice as mongoose.Model<InvoiceDocument>) ||
	mongoose.model<InvoiceDocument>("Invoice", invoiceSchema);
