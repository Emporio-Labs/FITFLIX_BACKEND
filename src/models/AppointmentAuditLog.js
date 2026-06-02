Object.defineProperty(exports, "__esModule", { value: true });
var mongoose_1 = require("mongoose");
var Enums_1 = require("./Enums");
var appointmentAuditLogSchema = new mongoose_1.default.Schema(
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
		action: {
			type: String,
			enum: Object.values(Enums_1.AuditAction),
			required: true,
		},
		// Who triggered this — "user", "admin", "webhook", "system"
		actor: { type: String, required: true },
		actorId: {
			type: mongoose_1.default.Schema.Types.ObjectId,
			ref: "User",
			default: undefined,
		},
		calBookingId: { type: String, default: undefined },
		before: { type: mongoose_1.default.Schema.Types.Mixed, default: undefined },
		after: { type: mongoose_1.default.Schema.Types.Mixed, default: undefined },
		// Raw payload (e.g. webhook body) for debugging
		payload: {
			type: mongoose_1.default.Schema.Types.Mixed,
			default: undefined,
		},
	},
	{ timestamps: true },
);
appointmentAuditLogSchema.index({ appointmentId: 1, createdAt: -1 });
appointmentAuditLogSchema.index({ userId: 1, createdAt: -1 });
exports.default =
	mongoose_1.default.models.AppointmentAuditLog ||
	mongoose_1.default.model("AppointmentAuditLog", appointmentAuditLogSchema);
