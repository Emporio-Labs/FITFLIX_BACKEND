import mongoose from "mongoose";
import { AlertSeverity, AlertStatus, AlertType } from "./Enums";

/**
 * OperationalAlert Model — FX-35
 *
 * Urgent operational alerts for branch staff (Frontdesk & Managers).
 * State lifecycle: open -> acknowledged -> resolved.
 * Survived across page reloads and socket reconnects.
 * Filtered by branchId and target roles.
 */
const operationalAlertSchema = new mongoose.Schema(
	{
		type: {
			type: String,
			enum: Object.values(AlertType),
			required: true,
		},
		severity: {
			type: String,
			enum: Object.values(AlertSeverity),
			default: AlertSeverity.Warning,
			required: true,
		},
		status: {
			type: String,
			enum: Object.values(AlertStatus),
			default: AlertStatus.Open,
			required: true,
		},
		title: {
			type: String,
			required: true,
			trim: true,
		},
		message: {
			type: String,
			required: true,
			trim: true,
		},
		branchId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Location",
			required: true,
			index: true,
		},
		targetRoles: {
			type: [String],
			default: ["admin", "frontdesk"],
		},
		sound: {
			type: String,
			enum: ["chime", "siren", "pulse", "bell"],
			default: "chime",
		},
		escalationLadder: {
			type: [
				{
					role: { type: String, required: true },
					afterMinutes: { type: Number, required: true },
				},
			],
			default: [],
		},
		targetUserId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: undefined,
		},
		relatedEntity: {
			entityType: {
				type: String,
				enum: ["lead", "session", "booking", "other"],
				required: true,
			},
			entityId: {
				type: String,
				required: true,
			},
			summary: {
				type: String,
				default: undefined,
			},
		},
		acknowledgedBy: {
			userId: {
				type: mongoose.Schema.Types.ObjectId,
				ref: "User",
				default: undefined,
			},
			name: {
				type: String,
				default: undefined,
			},
			role: {
				type: String,
				default: undefined,
			},
		},
		acknowledgedAt: {
			type: Date,
			default: undefined,
		},
		resolvedBy: {
			userId: {
				type: mongoose.Schema.Types.ObjectId,
				ref: "User",
				default: undefined,
			},
			name: {
				type: String,
				default: undefined,
			},
			role: {
				type: String,
				default: undefined,
			},
		},
		resolvedAt: {
			type: Date,
			default: undefined,
		},
		resolutionReason: {
			type: String,
			default: undefined,
		},
		// For idempotent and rapid auto-resolution queries (e.g. "lead:65f...")
		autoResolveKey: {
			type: String,
			default: undefined,
			index: true,
		},
	},
	{
		timestamps: true,
	},
);

operationalAlertSchema.index({ branchId: 1, status: 1, createdAt: -1 });
operationalAlertSchema.index({ "relatedEntity.entityType": 1, "relatedEntity.entityId": 1, status: 1 });

export type OperationalAlertDocument = mongoose.InferSchemaType<typeof operationalAlertSchema>;

export default (mongoose.models
	.OperationalAlert as mongoose.Model<OperationalAlertDocument>) ||
	mongoose.model<OperationalAlertDocument>("OperationalAlert", operationalAlertSchema);
