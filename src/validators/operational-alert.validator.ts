import { z } from "zod";
import { AlertSeverity, AlertStatus, AlertType } from "../models/Enums";

export const createOperationalAlertSchema = z.object({
	type: z.nativeEnum(AlertType),
	severity: z.nativeEnum(AlertSeverity).default(AlertSeverity.Warning),
	title: z.string().trim().min(1, "Title is required"),
	message: z.string().trim().min(1, "Message is required"),
	branchId: z.string().trim().min(1, "branchId is required"),
	targetRoles: z.array(z.string().trim()).optional(),
	targetUserId: z.string().trim().optional(),
	relatedEntity: z.object({
		entityType: z.enum(["lead", "session", "booking", "other"]),
		entityId: z.string().trim().min(1, "entityId is required"),
		summary: z.string().trim().optional(),
	}),
});

export const resolveOperationalAlertSchema = z.object({
	reason: z.string().trim().optional(),
});

export const queryOperationalAlertsSchema = z.object({
	branchId: z.string().trim().optional(),
	status: z.enum(["open", "acknowledged", "resolved", "active"]).optional().default("active"),
	severity: z.nativeEnum(AlertSeverity).optional(),
});

export type CreateOperationalAlertInput = z.infer<typeof createOperationalAlertSchema>;
export type ResolveOperationalAlertInput = z.infer<typeof resolveOperationalAlertSchema>;
export type QueryOperationalAlertsInput = z.infer<typeof queryOperationalAlertsSchema>;
