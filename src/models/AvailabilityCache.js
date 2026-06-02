Object.defineProperty(exports, "__esModule", { value: true });
var mongoose_1 = require("mongoose");
var Enums_1 = require("./Enums");
var slotSchema = new mongoose_1.default.Schema(
	{
		start: { type: String, required: true }, // ISO 8601
		end: { type: String, required: true },
	},
	{ _id: false },
);
var availabilityCacheSchema = new mongoose_1.default.Schema(
	{
		expertType: {
			type: String,
			enum: Object.values(Enums_1.ExpertType),
			required: true,
		},
		eventTypeId: { type: String, required: true },
		// YYYY-MM-DD in the requested timezone
		dateKey: { type: String, required: true },
		timezone: { type: String, required: true },
		slots: { type: [slotSchema], default: [] },
		fetchedAt: { type: Date, required: true },
		// TTL index on this field — MongoDB removes the doc when expiresAt <= now
		expiresAt: { type: Date, required: true },
	},
	{ timestamps: false },
);
availabilityCacheSchema.index(
	{ expertType: 1, dateKey: 1, timezone: 1 },
	{ unique: true },
);
// TTL index — entries expire 60 seconds after expiresAt
availabilityCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
exports.default =
	mongoose_1.default.models.AvailabilityCache ||
	mongoose_1.default.model("AvailabilityCache", availabilityCacheSchema);
