import { z } from "zod";
import { AlertSeverity } from "../models/Enums";

export const escalationStepSchema = z.object({
	role: z.string().trim().min(1, "Role is required"),
	afterMinutes: z
		.number()
		.int("Minutes must be an integer")
		.min(1, "Must be at least 1 minute")
		.max(1440, "Maximum is 24 hours (1440 mins)"),
});

export const updateAlertRuleSchema = z.object({
	severity: z.nativeEnum(AlertSeverity).optional(),
	firstResponderRole: z.string().trim().min(1).optional(),
	escalationLadder: z.array(escalationStepSchema).optional(),
	sound: z.enum(["chime", "siren", "pulse", "bell"]).optional(),
	title: z.string().trim().optional(),
	description: z.string().trim().optional(),
});

export type UpdateAlertRuleInput = z.infer<typeof updateAlertRuleSchema>;
