import mongoose from "mongoose";
import { AlertSeverity, AlertType } from "./Enums";

export interface EscalationStep {
	role: string;
	afterMinutes: number;
}

const escalationStepSchema = new mongoose.Schema(
	{
		role: {
			type: String,
			required: true,
			trim: true,
		},
		afterMinutes: {
			type: Number,
			required: true,
			min: 1,
			max: 1440,
		},
	},
	{ _id: false },
);

/**
 * AlertRule Model — FX-36
 *
 * Defines severity, first responder, escalation ladder, and sound per alert type.
 * Managed by club owner / admins in Settings.
 */
const alertRuleSchema = new mongoose.Schema(
	{
		alertType: {
			type: String,
			enum: Object.values(AlertType),
			required: true,
			unique: true,
			index: true,
		},
		title: {
			type: String,
			required: true,
			trim: true,
		},
		description: {
			type: String,
			required: true,
			trim: true,
		},
		severity: {
			type: String,
			enum: Object.values(AlertSeverity),
			required: true,
			default: AlertSeverity.Warning,
		},
		firstResponderRole: {
			type: String,
			required: true,
			default: "frontdesk",
			trim: true,
		},
		escalationLadder: {
			type: [escalationStepSchema],
			default: [],
		},
		sound: {
			type: String,
			enum: ["chime", "siren", "pulse", "bell"],
			default: "chime",
		},
		updatedBy: {
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
			updatedAt: {
				type: Date,
				default: Date.now,
			},
		},
	},
	{
		timestamps: true,
	},
);

export type AlertRuleDocument = mongoose.InferSchemaType<typeof alertRuleSchema>;

export default (mongoose.models.AlertRule as mongoose.Model<AlertRuleDocument>) ||
	mongoose.model<AlertRuleDocument>("AlertRule", alertRuleSchema);
