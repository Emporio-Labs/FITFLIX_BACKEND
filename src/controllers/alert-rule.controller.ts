import type { RequestHandler } from "express";
import mongoose from "mongoose";
import AlertRule from "../models/AlertRule";
import { AlertType } from "../models/Enums";
import {
	DEFAULT_ALERT_RULES,
	getEffectiveAlertRule,
} from "../utils/default-alert-rules";
import { updateAlertRuleSchema } from "../validators/alert-rule.validator";
import { getIO } from "../services/realtime.service";

const getValidationDetails = (issues: any[]): Record<string, string> => {
	const details: Record<string, string> = {};
	for (const issue of issues) {
		const path = issue.path ? issue.path.map(String).join(".") : "field";
		details[path] = issue.message;
	}
	return details;
};

/**
 * GET /api/v1/admin/settings/alert-rules
 * Returns all alert rules (merging customized DB rules with sensible defaults).
 * FX-36.1 & FX-36.3
 */
export const getAllAlertRules: RequestHandler = async (_req, res, next) => {
	try {
		const customRules = await AlertRule.find().lean();
		const customMap = new Map(customRules.map((r) => [r.alertType, r]));

		const allTypes = Object.values(AlertType);
		const rules = allTypes.map((type) => {
			if (customMap.has(type)) {
				return customMap.get(type);
			}
			return {
				...DEFAULT_ALERT_RULES[type],
				isDefault: true,
			};
		});

		res.status(200).json({ rules });
	} catch (error) {
		next(error);
	}
};

/**
 * PUT /api/v1/admin/settings/alert-rules/:alertType
 * Updates severity, first responder role, escalation ladder, or sound.
 * Records named admin audit trail (FX-36.2 & FX-36.4).
 */
export const updateAlertRule: RequestHandler = async (req, res, next) => {
	if (!req.user || req.user.role !== "admin") {
		res.status(403).json({ error: "Only admins can modify alert rules", code: "FORBIDDEN" });
		return;
	}

	const rawType = req.params.alertType;
	if (!rawType || !Object.values(AlertType).includes(rawType as AlertType)) {
		res.status(400).json({ error: `Invalid alertType: ${rawType}`, code: "BAD_REQUEST" });
		return;
	}

	const alertType = rawType as AlertType;
	const parsed = updateAlertRuleSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const fallback = DEFAULT_ALERT_RULES[alertType];
		const adminName =
			(req.user as any).adminName ||
			(req.user as any).username ||
			req.user.email ||
			"Admin";

		const updatePayload: Record<string, any> = {
			alertType,
			title: parsed.data.title ?? fallback.title,
			description: parsed.data.description ?? fallback.description,
			severity: parsed.data.severity ?? fallback.severity,
			firstResponderRole: parsed.data.firstResponderRole ?? fallback.firstResponderRole,
			escalationLadder: parsed.data.escalationLadder ?? fallback.escalationLadder,
			sound: parsed.data.sound ?? fallback.sound,
			updatedBy: {
				userId: new mongoose.Types.ObjectId(req.user.id),
				name: adminName,
				role: req.user.role,
				updatedAt: new Date(),
			},
		};

		const updated = await AlertRule.findOneAndUpdate(
			{ alertType },
			updatePayload,
			{ new: true, upsert: true, setDefaultsOnInsert: true },
		);

		// Realtime broadcast to FrontDesk dashboards
		getIO()?.emit("alert_rules:updated", updated.toObject());

		res.status(200).json({
			message: `Alert rule for ${alertType} updated successfully`,
			rule: updated,
		});
	} catch (error) {
		next(error);
	}
};

/**
 * POST /api/v1/admin/settings/alert-rules/reset
 * Resets customized alert rules back to system defaults.
 */
export const resetAlertRules: RequestHandler = async (req, res, next) => {
	if (!req.user || req.user.role !== "admin") {
		res.status(403).json({ error: "Only admins can reset alert rules", code: "FORBIDDEN" });
		return;
	}

	try {
		await AlertRule.deleteMany({});
		getIO()?.emit("alert_rules:reset");

		res.status(200).json({
			message: "All alert rules reset to factory defaults",
		});
	} catch (error) {
		next(error);
	}
};
