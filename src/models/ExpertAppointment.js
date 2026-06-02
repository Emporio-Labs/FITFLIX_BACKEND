Object.defineProperty(exports, "__esModule", { value: true });
var mongoose_1 = require("mongoose");
var Enums_1 = require("./Enums");
var expertAppointmentSchema = new mongoose_1.default.Schema(
	{
		userId: {
			type: mongoose_1.default.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		expertType: {
			type: String,
			enum: Object.values(Enums_1.ExpertType),
			required: true,
		},
		bookingStatus: {
			type: String,
			enum: Object.values(Enums_1.AppointmentBookingStatus),
			default: Enums_1.AppointmentBookingStatus.Pending,
		},
		// Legacy field — kept for backward compat; new code uses meetingUrl
		meetingLink: { type: String, default: undefined },
		// Cal ID fields
		calIdBookingId: { type: String, default: undefined },
		calIdEventId: { type: String, default: undefined },
		calIdEventTypeId: { type: String, default: undefined },
		meetingUrl: { type: String, default: undefined },
		timezone: {
			type: String,
			default: () => {
				var _a;
				return (_a = process.env.CALID_DEFAULT_TIMEZONE) !== null &&
					_a !== void 0
					? _a
					: "Asia/Kolkata";
			},
		},
		appointmentStart: { type: Date, default: undefined },
		appointmentEnd: { type: Date, default: undefined },
		// Legacy date field — kept for backward compat
		appointmentDate: { type: Date, default: undefined },
		webhookSyncStatus: {
			type: String,
			enum: Object.values(Enums_1.WebhookSyncStatus),
			default: undefined,
		},
		appointmentSource: {
			type: String,
			enum: Object.values(Enums_1.AppointmentSource),
			default: Enums_1.AppointmentSource.UserApp,
		},
		cancelledAt: { type: Date, default: undefined },
		cancelReason: { type: String, default: undefined },
		cancelledBy: {
			type: mongoose_1.default.Schema.Types.ObjectId,
			ref: "User",
			default: undefined,
		},
		rescheduledFromId: {
			type: mongoose_1.default.Schema.Types.ObjectId,
			ref: "ExpertAppointment",
			default: undefined,
		},
		rescheduledToId: {
			type: mongoose_1.default.Schema.Types.ObjectId,
			ref: "ExpertAppointment",
			default: undefined,
		},
		lastSyncedAt: { type: Date, default: undefined },
		// Idempotency key to prevent double-booking from concurrent requests
		idempotencyKey: { type: String, default: undefined },
	},
	{ timestamps: true },
);
// Partial unique index: one active booking per user per expert type.
// Cancelled/Completed/NoShow records are excluded so users can re-book.
// NOTE: Before deploying, drop the old full unique index on { userId, expertType }
// via MongoDB shell: db.expertappointments.dropIndex("userId_1_expertType_1")
expertAppointmentSchema.index(
	{ userId: 1, expertType: 1 },
	{
		unique: true,
		partialFilterExpression: {
			bookingStatus: {
				$in: [
					Enums_1.AppointmentBookingStatus.Pending,
					Enums_1.AppointmentBookingStatus.Confirmed,
					Enums_1.AppointmentBookingStatus.Rescheduled,
				],
			},
		},
		name: "expert_appointment_active_unique",
	},
);
// Sparse unique on idempotency key — prevents duplicate concurrent booking requests
expertAppointmentSchema.index(
	{ idempotencyKey: 1 },
	{ unique: true, sparse: true, name: "expert_appointment_idempotency" },
);
expertAppointmentSchema.index({ calIdBookingId: 1 }, { sparse: true });
expertAppointmentSchema.index({ userId: 1, bookingStatus: 1 });
exports.default =
	mongoose_1.default.models.ExpertAppointment ||
	mongoose_1.default.model("ExpertAppointment", expertAppointmentSchema);
