import mongoose from "mongoose";
import { WebhookEventStatus } from "./Enums";

const webhookEventSchema = new mongoose.Schema(
	{
		// Provider identifier (e.g. external integrations)
		provider: { type: String, required: true },
		// Unique event identifier per webhook delivery — used for idempotency
		eventId: { type: String, required: true },
		triggerEvent: { type: String, required: true },
		// Raw deserialized webhook body
		payload: { type: mongoose.Schema.Types.Mixed, required: true },
		status: {
			type: String,
			enum: Object.values(WebhookEventStatus),
			default: WebhookEventStatus.Received,
		},
		attempts: { type: Number, default: 0 },
		lastError: { type: String, default: undefined },
		receivedAt: { type: Date, required: true },
		processedAt: { type: Date, default: undefined },
	},
	{ timestamps: false },
);

// Primary idempotency guard
webhookEventSchema.index({ eventId: 1 }, { unique: true });
// Poller / retry queries
webhookEventSchema.index({ status: 1, receivedAt: -1 });
// Dead-letter admin view
webhookEventSchema.index({ status: 1, provider: 1 });

type WebhookEventDocument = mongoose.InferSchemaType<typeof webhookEventSchema>;

export default (mongoose.models
	.WebhookEvent as mongoose.Model<WebhookEventDocument>) ||
	mongoose.model<WebhookEventDocument>("WebhookEvent", webhookEventSchema);
