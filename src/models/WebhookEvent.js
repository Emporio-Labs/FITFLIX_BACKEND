Object.defineProperty(exports, "__esModule", { value: true });
var mongoose_1 = require("mongoose");
var Enums_1 = require("./Enums");
var webhookEventSchema = new mongoose_1.default.Schema(
	{
		// Provider identifier (e.g. external integrations)
		provider: { type: String, required: true },
		// Unique event identifier per webhook delivery — used for idempotency
		eventId: { type: String, required: true },
		triggerEvent: { type: String, required: true },
		// Raw deserialized webhook body
		payload: { type: mongoose_1.default.Schema.Types.Mixed, required: true },
		status: {
			type: String,
			enum: Object.values(Enums_1.WebhookEventStatus),
			default: Enums_1.WebhookEventStatus.Received,
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
exports.default =
	mongoose_1.default.models.WebhookEvent ||
	mongoose_1.default.model("WebhookEvent", webhookEventSchema);
