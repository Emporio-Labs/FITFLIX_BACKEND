import type { RequestHandler } from "express";
import ClassModel from "../models/Class";
import ScheduledSession from "../models/ScheduledSession";
import { updateCapacityAdmin } from "../services/capacity-engine.service";
import { normalizeDeliveryType } from "../utils/delivery-type";
import {
	createClassScheduleSchema,
	updateClassScheduleSchema,
} from "../validators/class-schedule.validator";

function parseTimeToMinutes(timeStr: string): number {
	const parts = (timeStr || "00:00").split(":").map(Number);
	const hours = parts[0] ?? 0;
	const minutes = parts[1] ?? 0;
	return hours * 60 + minutes;
}

function normalizeDateStart(dateInput: string | Date): Date {
	const d = new Date(dateInput);
	d.setUTCHours(0, 0, 0, 0);
	return d;
}

export const createScheduledSession: RequestHandler = async (
	req,
	res,
	next,
) => {
	const parsed = createClassScheduleSchema.safeParse(req.body);

	if (!parsed.success) {
		res.status(400).json({
			message: "Validation failed for schedule creation",
			errors: parsed.error.issues,
		});
		return;
	}

	const {
		classId,
		trainerId,
		sessionDate: rawSessionDate,
		startTime,
		endTime,
		deliveryType,
		locationAddress,
		capacity,
		recurrenceRule,
		repeatCount,
		streamRoomId,
		isPublished,
	} = parsed.data;

	try {
		const targetClass = await ClassModel.findById(classId);
		if (!targetClass) {
			res.status(404).json({ message: "Class not found" });
			return;
		}

		// An omitted deliveryType inherits the class's mode rather than silently
		// defaulting to OFFLINE, which previously left online classes with
		// offline sessions that the app then filed under the wrong tab.
		const resolvedDeliveryType =
			deliveryType ?? normalizeDeliveryType(targetClass.mode);

		const startMins = parseTimeToMinutes(startTime);
		const endMins = parseTimeToMinutes(endTime);

		if (endMins <= startMins) {
			res.status(400).json({
				message: "Session end time must be after start time",
			});
			return;
		}

		const baseDate = new Date(rawSessionDate);
		const todayStart = new Date();
		todayStart.setUTCHours(0, 0, 0, 0);

		const sessionDateStart = new Date(baseDate);
		sessionDateStart.setUTCHours(0, 0, 0, 0);

		if (sessionDateStart.getTime() < todayStart.getTime()) {
			res.status(400).json({
				message: "Cannot schedule class sessions in the past",
			});
			return;
		}

		const count = recurrenceRule === "NONE" ? 1 : repeatCount;
		const createdSessions: any[] = [];

		for (let i = 0; i < count; i++) {
			const currentSessionDate = new Date(sessionDateStart);
			if (recurrenceRule === "DAILY") {
				currentSessionDate.setUTCDate(currentSessionDate.getUTCDate() + i);
			} else if (recurrenceRule === "WEEKLY") {
				currentSessionDate.setUTCDate(currentSessionDate.getUTCDate() + i * 7);
			}

			if (trainerId) {
				const existingSessions = await ScheduledSession.find({
					trainerId,
					status: "SCHEDULED",
					sessionDate: currentSessionDate,
				}).lean();

				const hasConflict = existingSessions.some((existing) => {
					const exStart = parseTimeToMinutes(existing.startTime);
					const exEnd = parseTimeToMinutes(existing.endTime);
					return exStart < endMins && exEnd > startMins;
				});

				if (hasConflict) {
					res.status(409).json({
						message: "Trainer is already scheduled for a conflicting session at this time",
					});
					return;
				}
			}

			const sessionDoc = await ScheduledSession.create({
				classId,
				trainerId: trainerId || null,
				sessionDate: currentSessionDate,
				startTime,
				endTime,
				deliveryType: resolvedDeliveryType,
				locationAddress: locationAddress || null,
				capacity: capacity || targetClass.maxParticipants || 20,
				status: "SCHEDULED",
				recurrenceRule,
				streamRoomId: streamRoomId || targetClass.streamRoomId || null,
				isPublished,
			});

			createdSessions.push(sessionDoc);
		}

		res.status(201).json({
			message: "Class session scheduled successfully",
			count: createdSessions.length,
			sessions: createdSessions,
		});
	} catch (error) {
		next(error);
	}
};

export const getAllSchedulesForAdmin: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const { classId, trainerId, date, startDate, endDate } = req.query;
		const query: any = {};

		if (classId) query.classId = classId;
		if (trainerId) query.trainerId = trainerId;

		if (date) {
			const startOfDay = new Date(String(date));
			startOfDay.setUTCHours(0, 0, 0, 0);
			const endOfDay = new Date(String(date));
			endOfDay.setUTCHours(23, 59, 59, 999);
			query.sessionDate = { $gte: startOfDay, $lte: endOfDay };
		} else if (startDate || endDate) {
			query.sessionDate = {};
			if (startDate) query.sessionDate.$gte = normalizeDateStart(String(startDate));
			if (endDate) query.sessionDate.$lte = normalizeDateStart(String(endDate));
		}

		const sessions = await ScheduledSession.find(query)
			.populate("classId", "name description creditCost mode sessionType instructor instructorUserId tags durationMinutes maxParticipants scheduleInfo recurrenceRule schedulePattern scheduleType daysOfWeek locationAddress streamRoomId enableWaitlist bookingWindowValue bookingWindowUnit bookingCloseValue bookingCloseUnit")
			.sort({ sessionDate: 1, startTime: 1 })
			.lean();

		res.status(200).json({
			message: "Scheduled sessions retrieved successfully",
			count: sessions.length,
			sessions: sessions.map((s) => ({
				...s,
				// videoConferenceId is the session's own _id — the ZEGOCLOUD
				// conference room is derived from this at join time (GCLS-24).
				videoConferenceId: s._id.toString(),
			})),
		});
	} catch (error) {
		next(error);
	}
};

export const getSchedulesForMembers: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const { date } = req.query;
		// FULL sessions stay in the member feed so a sold-out class renders as full
		// rather than disappearing — capacity-engine flips SCHEDULED -> FULL at zero
		// remaining capacity.
		const query: any = {
			status: { $in: ["SCHEDULED", "FULL"] },
			isPublished: { $ne: false },
		};

		if (date) {
			const startOfDay = new Date(String(date));
			startOfDay.setUTCHours(0, 0, 0, 0);
			const endOfDay = new Date(String(date));
			endOfDay.setUTCHours(23, 59, 59, 999);
			query.sessionDate = { $gte: startOfDay, $lte: endOfDay };
		} else {
			const today = new Date();
			today.setUTCHours(0, 0, 0, 0);
			query.sessionDate = { $gte: today };
		}

		const sessions = await ScheduledSession.find(query)
			.populate("classId", "name description creditCost mode sessionType instructor instructorUserId tags durationMinutes maxParticipants scheduleInfo recurrenceRule schedulePattern scheduleType daysOfWeek locationAddress streamRoomId enableWaitlist bookingWindowValue bookingWindowUnit bookingCloseValue bookingCloseUnit")
			.sort({ sessionDate: 1, startTime: 1 })
			.lean();

		res.status(200).json({
			message: "Active scheduled sessions retrieved successfully",
			count: sessions.length,
			sessions: sessions.map((s) => ({
				...s,
				// videoConferenceId = session._id — ZEGOCLOUD conference room
				// is derived from this identifier at join time (GCLS-24 MVP).
				videoConferenceId: s._id.toString(),
			})),
		});
	} catch (error) {
		next(error);
	}
};

export const updateScheduledSession: RequestHandler = async (
	req,
	res,
	next,
) => {
	const { id } = req.params;
	const parsed = updateClassScheduleSchema.safeParse(req.body);

	if (!parsed.success) {
		res.status(400).json({
			message: "Validation failed for schedule update",
			errors: parsed.error.issues,
		});
		return;
	}

	try {
		const session = await ScheduledSession.findById(id);
		if (!session) {
			res.status(404).json({ message: "Scheduled session not found" });
			return;
		}

		const newStartTime = parsed.data.startTime || session.startTime;
		const newEndTime = parsed.data.endTime || session.endTime;
		const newTrainerId = parsed.data.trainerId ?? session.trainerId?.toString();
		const newSessionDate = parsed.data.sessionDate
			? normalizeDateStart(parsed.data.sessionDate)
			: session.sessionDate;

		const startMins = parseTimeToMinutes(newStartTime);
		const endMins = parseTimeToMinutes(newEndTime);

		if (endMins <= startMins) {
			res.status(400).json({
				message: "Session end time must be after start time",
			});
			return;
		}

		const todayStart = new Date();
		todayStart.setUTCHours(0, 0, 0, 0);
		if (newSessionDate.getTime() < todayStart.getTime()) {
			res.status(400).json({
				message: "Cannot schedule class sessions in the past",
			});
			return;
		}

		if (newTrainerId) {
			const existingSessions = await ScheduledSession.find({
				_id: { $ne: session._id },
				trainerId: newTrainerId,
				status: "SCHEDULED",
				sessionDate: newSessionDate,
			}).lean();

			const hasConflict = existingSessions.some((existing) => {
				const exStart = parseTimeToMinutes(existing.startTime);
				const exEnd = parseTimeToMinutes(existing.endTime);
				return exStart < endMins && exEnd > startMins;
			});

			if (hasConflict) {
				res.status(409).json({
					message: "Trainer is already scheduled for a conflicting session at this time",
				});
				return;
			}
		}

		Object.assign(session, parsed.data);
		if (parsed.data.sessionDate) {
			session.sessionDate = newSessionDate;
		}

		await session.save();

		res.status(200).json({
			message: "Scheduled session updated successfully",
			session,
		});
	} catch (error) {
		next(error);
	}
};

export const updateSessionCapacity: RequestHandler = async (
	req,
	res,
	next,
) => {
	const id = req.params.id as string;
	const { capacity } = req.body;

	if (typeof capacity !== "number" || capacity < 1) {
		res.status(400).json({ message: "Capacity must be a positive integer" });
		return;
	}

	try {
		const result = await updateCapacityAdmin(id, capacity);
		res.status(result.status).json(result);
	} catch (error) {
		next(error);
	}
};
