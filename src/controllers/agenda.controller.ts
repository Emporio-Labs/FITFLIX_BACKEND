import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { getMemberAgenda } from "../services/agenda.service";
import { agendaQuerySchema } from "../validators/agenda.validator";

export const getMemberAgendaHandler: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const userId = req.user?.id;
		if (!userId) {
			res.status(401).json({
				error: "Unauthorized",
				code: "UNAUTHORIZED",
			});
			return;
		}

		const parsed = agendaQuerySchema.safeParse(req.query);
		if (!parsed.success) {
			const details: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path.map(String).join(".");
				details[key] = issue.message;
			}
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details,
			});
			return;
		}

		const { from, to, timezone } = parsed.data;
		const agenda = await getMemberAgenda(userId, from, to, timezone);

		res.status(200).json({
			success: true,
			agenda,
		});
	} catch (error) {
		next(error);
	}
};

export const getMemberAgendaForStaffHandler: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const requesterRole = req.user?.role;
		if (
			!["admin", "frontdesk", "trainer", "nutritionist", "doctor"].includes(
				requesterRole || "",
			)
		) {
			res.status(403).json({
				error: "Forbidden",
				code: "FORBIDDEN",
			});
			return;
		}

		const { userId } = req.params;
		if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
			res.status(400).json({
				error: "Invalid user ID",
				code: "BAD_REQUEST",
			});
			return;
		}

		const parsed = agendaQuerySchema.safeParse(req.query);
		if (!parsed.success) {
			const details: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path.map(String).join(".");
				details[key] = issue.message;
			}
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details,
			});
			return;
		}

		const { from, to, timezone } = parsed.data;
		const agenda = await getMemberAgenda(userId, from, to, timezone);

		res.status(200).json({
			success: true,
			agenda,
		});
	} catch (error) {
		next(error);
	}
};
