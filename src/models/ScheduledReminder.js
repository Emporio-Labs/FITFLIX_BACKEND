Object.defineProperty(exports, "__esModule", { value: true });
var mongoose_1 = require("mongoose");
var Enums_1 = require("./Enums");
var scheduledReminderSchema = new mongoose_1.default.Schema(
	{
		appointmentId: {
			type: mongoose_1.default.Schema.Types.ObjectId,
			ref: "ExpertAppointment",
			required: true,
		},
		userId: {
			type: mongoose_1.default.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		// UTC time at which this reminder should fire
		fireAt: { type: Date, required: true },
		kind: {
			type: String,
			enum: Object.values(Enums_1.ReminderKind),
			required: true,
		},
		status: {
			type: String,
			enum: Object.values(Enums_1.ReminderStatus),
			default: Enums_1.ReminderStatus.Scheduled,
		},
		attempts: { type: Number, default: 0 },
		lastError: { type: String, default: undefined },
	},
	{ timestamps: true },
);
// Poller queries: status=SCHEDULED & fireAt <= now
scheduledReminderSchema.index({ status: 1, fireAt: 1 });
scheduledReminderSchema.index({ appointmentId: 1, kind: 1 }, { unique: true });
exports.default =
	mongoose_1.default.models.ScheduledReminder ||
	mongoose_1.default.model("ScheduledReminder", scheduledReminderSchema);
