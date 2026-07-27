import z from "zod";

const timeFormatRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

export const createClassScheduleSchema = z.object({
	classId: z.string().trim().min(1, "classId is required"),
	trainerId: z.string().trim().optional(),
	sessionDate: z.string().trim().min(1, "sessionDate is required"),
	startTime: z.string().regex(timeFormatRegex, "startTime must be HH:mm (00:00 - 23:59)"),
	endTime: z.string().regex(timeFormatRegex, "endTime must be HH:mm (00:00 - 23:59)"),
	deliveryType: z.enum(["ONLINE", "OFFLINE", "HYBRID"]).optional().default("OFFLINE"),
	locationAddress: z.string().trim().optional(),
	capacity: z.number().int().positive().optional().default(20),
	recurrenceRule: z.enum(["NONE", "DAILY", "WEEKLY"]).optional().default("NONE"),
	repeatCount: z.number().int().min(1).max(30).optional().default(1),
	streamRoomId: z.string().trim().optional(),
	isPublished: z.boolean().optional().default(true),
});

export const updateClassScheduleSchema = z.object({
	trainerId: z.string().trim().optional(),
	sessionDate: z.string().trim().optional(),
	startTime: z.string().regex(timeFormatRegex, "startTime must be HH:mm").optional(),
	endTime: z.string().regex(timeFormatRegex, "endTime must be HH:mm").optional(),
	deliveryType: z.enum(["ONLINE", "OFFLINE", "HYBRID"]).optional(),
	locationAddress: z.string().trim().optional(),
	capacity: z.number().int().positive().optional(),
	status: z.enum(["SCHEDULED", "CANCELLED", "COMPLETED"]).optional(),
	streamRoomId: z.string().trim().optional(),
	isPublished: z.boolean().optional(),
});
