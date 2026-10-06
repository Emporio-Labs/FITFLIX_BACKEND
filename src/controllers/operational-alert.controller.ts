import type { RequestHandler } from "express";
import mongoose from "mongoose";
import OperationalAlert from "../models/OperationalAlert";
import Location from "../models/Location";
import { AlertStatus } from "../models/Enums";
import {
	emitAlertAcknowledged,
	emitAlertResolved,
	emitOperationalAlert,
} from "../services/realtime.service";
import {
	createOperationalAlertSchema,
	queryOperationalAlertsSchema,
	resolveOperationalAlertSchema,
} from "../validators/operational-alert.validator";
import { getEffectiveAlertRule } from "../utils/default-alert-rules";

const getValidationDetails = (issues: any[]): Record<string, string> => {
	const details: Record<string, string> = {};
	for (const issue of issues) {
		const path = issue.path ? issue.path.map(String).join(".") : "field";
		details[path] = issue.message;
	}
	return details;
};

/**
 * GET /api/v1/alerts
 * FX-35.3 & FX-35.5: Fetch alerts scoped by branch and role.
 * Open and acknowledged alerts persist across reloads, disconnects, and re-logins.
 */
export const getOperationalAlerts: RequestHandler = async (req, res, next) => {
	if (!req.user) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = queryOperationalAlertsSchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const match: Record<string, any> = {};

		// Branch scoping (FX-35.5)
		const userLocationId = (req.user as any).locationId;
		if (userLocationId && mongoose.Types.ObjectId.isValid(userLocationId)) {
			match.branchId = new mongoose.Types.ObjectId(userLocationId);
		} else if (parsed.data.branchId && mongoose.Types.ObjectId.isValid(parsed.data.branchId)) {
			match.branchId = new mongoose.Types.ObjectId(parsed.data.branchId);
		}

		// Role scoping (FX-35.5): admin can see all; otherwise match targetRoles or user id
		if (req.user.role !== "admin") {
			match.$or = [
				{ targetRoles: req.user.role },
				{ targetUserId: new mongoose.Types.ObjectId(req.user.id) },
				{ targetRoles: { $exists: false } },
				{ targetRoles: { $size: 0 } },
			];
		}

		// Status filter (FX-35.3)
		if (parsed.data.status === "active") {
			match.status = { $in: [AlertStatus.Open, AlertStatus.Acknowledged] };
		} else if (parsed.data.status) {
			match.status = parsed.data.status;
		}

		if (parsed.data.severity) {
			match.severity = parsed.data.severity;
		}

		const alerts = await OperationalAlert.find(match)
			.sort({ createdAt: -1 })
			.populate("branchId", "name code")
			.lean();

		res.status(200).json({ alerts });
	} catch (error) {
		next(error);
	}
};

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (typeof idParam !== "string" || !mongoose.Types.ObjectId.isValid(idParam)) return null;
	return idParam;
};

/**
 * PATCH /api/v1/alerts/:id/acknowledge
 * FX-35.2 & FX-35.4: Moves alert from open -> acknowledged.
 * Records named person and timestamp. Silences noise while staying on the board.
 */
export const acknowledgeOperationalAlert: RequestHandler = async (req, res, next) => {
	if (!req.user) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const alertId = getIdParam(req.params.id);
	if (!alertId) {
		res.status(400).json({ error: "Invalid alert id", code: "BAD_REQUEST" });
		return;
	}

	try {
		const alert = await OperationalAlert.findById(alertId);
		if (!alert) {
			res.status(404).json({ error: "Alert not found", code: "NOT_FOUND" });
			return;
		}

		const userName =
			(req.user as any).adminName ||
			(req.user as any).username ||
			req.user.email ||
			"Named Staff";

		alert.status = AlertStatus.Acknowledged;
		alert.acknowledgedBy = {
			userId: new mongoose.Types.ObjectId(req.user.id),
			name: userName,
			role: req.user.role,
		};
		alert.acknowledgedAt = new Date();

		await alert.save();

		// Realtime broadcast to stop noise across connected dashboards (FX-35.4)
		emitAlertAcknowledged(alert.toObject());

		res.status(200).json({
			message: "Alert acknowledged successfully",
			alert,
		});
	} catch (error) {
		next(error);
	}
};

/**
 * PATCH /api/v1/alerts/:id/resolve
 * FX-35.2 & FX-35.4: Moves alert to resolved state.
 */
export const resolveOperationalAlert: RequestHandler = async (req, res, next) => {
	if (!req.user) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const alertId = getIdParam(req.params.id);
	if (!alertId) {
		res.status(400).json({ error: "Invalid alert id", code: "BAD_REQUEST" });
		return;
	}

	const parsed = resolveOperationalAlertSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const alert = await OperationalAlert.findById(alertId);
		if (!alert) {
			res.status(404).json({ error: "Alert not found", code: "NOT_FOUND" });
			return;
		}

		const userName =
			(req.user as any).adminName ||
			(req.user as any).username ||
			req.user.email ||
			"Named Staff";

		alert.status = AlertStatus.Resolved;
		alert.resolvedBy = {
			userId: new mongoose.Types.ObjectId(req.user.id),
			name: userName,
			role: req.user.role,
		};
		alert.resolvedAt = new Date();
		alert.resolutionReason = parsed.data.reason || "Resolved by staff";

		await alert.save();

		// Realtime broadcast to remove from active boards
		emitAlertResolved(alert.toObject());

		res.status(200).json({
			message: "Alert resolved successfully",
			alert,
		});
	} catch (error) {
		next(error);
	}
};

/**
 * POST /api/v1/alerts
 * FX-35.1: Create an operational alert (manual or system triggered).
 */
export const createOperationalAlert: RequestHandler = async (req, res, next) => {
	if (!req.user) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = createOperationalAlertSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const { branchId, ...rest } = parsed.data;
		if (!mongoose.Types.ObjectId.isValid(branchId)) {
			res.status(400).json({ error: "Invalid branchId", code: "BAD_REQUEST" });
			return;
		}

		const branchExists = await Location.findById(branchId);
		if (!branchExists) {
			res.status(404).json({ error: "Branch location not found", code: "NOT_FOUND" });
			return;
		}

		// FX-36.2 & FX-36.3: Apply effective configured rule (or sensible defaults)
		const rule = await getEffectiveAlertRule(rest.type);

		const alert = await OperationalAlert.create({
			...rest,
			severity: rest.severity ?? rule.severity,
			targetRoles:
				rest.targetRoles && rest.targetRoles.length > 0
					? rest.targetRoles
					: [rule.firstResponderRole],
			sound: rule.sound,
			escalationLadder: rule.escalationLadder,
			branchId: new mongoose.Types.ObjectId(branchId),
			status: AlertStatus.Open,
			autoResolveKey: `${rest.relatedEntity.entityType}:${rest.relatedEntity.entityId}`,
		});

		emitOperationalAlert(alert.toObject());

		res.status(201).json({
			message: "Operational alert created",
			alert,
		});
	} catch (error) {
		next(error);
	}
};

/**
 * Auto-resolves operational alerts for an entity (FX-35.4).
 * For example: called when a lead is claimed or a trainer joins a live session.
 */
export async function autoResolveOperationalAlerts(
	entityType: "lead" | "session" | "booking" | "other",
	entityId: string,
	reason: string,
): Promise<number> {
	try {
		const key = `${entityType}:${entityId}`;
		const openAlerts = await OperationalAlert.find({
			$or: [
				{ autoResolveKey: key },
				{
					"relatedEntity.entityType": entityType,
					"relatedEntity.entityId": entityId,
				},
			],
			status: { $in: [AlertStatus.Open, AlertStatus.Acknowledged] },
		});

		if (openAlerts.length === 0) return 0;

		const now = new Date();
		for (const alert of openAlerts) {
			alert.status = AlertStatus.Resolved;
			alert.resolvedAt = now;
			alert.resolutionReason = reason;
			await alert.save();
			emitAlertResolved(alert.toObject());
		}

		return openAlerts.length;
	} catch (err) {
		console.error(`[OperationalAlert] Failed to auto-resolve alerts for ${entityType}:${entityId}`, err);
		return 0;
	}
}
