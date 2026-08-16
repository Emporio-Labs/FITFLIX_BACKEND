import type { RequestHandler } from "express";
import mongoose from "mongoose";
import ClassModel from "../models/Class";
import ScheduledSession from "../models/ScheduledSession";
import { updateCapacityAdmin } from "../services/capacity-engine.service";
import { normalizeDeliveryType } from "../utils/delivery-type";
import {
	combineSessionWindow,
	deriveRoomId,
	resolveSessionRoomId,
} from "../utils/zego-room";
import {
	createClassScheduleSchema,
	updateClassScheduleSchema,
} from "../validators/class-schedule.validator";

import { syncSessionsForClass } from "./class.controller";

/// Absolute instants, computed once server-side so neither the Flutter app nor
/// frontdesk has to re-derive them from `sessionDate` + "HH:mm" (the exact
/// derivation that was drifting by the IST offset before combineSessionDateTime
/// was fixed to read that string as business-timezone, not UTC).
const withAbsoluteTimes = <T extends { sessionDate: Date; startTime: string; endTime: string }>(
	session: T,
): T & { startsAtUtc: string | null; endsAtUtc: string | null } => {
	// Paired: a session ending past midnight ends on the next day, and these
	// are the instants the app trusts instead of re-deriving them.
	const { startsAt, endsAt } = combineSessionWindow(
		session.sessionDate,
		session.startTime,
		session.endTime,
	);
	return {
		...session,
		startsAtUtc: startsAt?.toISOString() ?? null,
		endsAtUtc: endsAt?.toISOString() ?? null,
	};
};

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

export async function ensureSessionsMaterializedForActiveClasses(): Promise<void> {
	try {
		const activeClasses = await ClassModel.find({
			isPublished: { $ne: false },
			status: { $ne: "INACTIVE" },
		});
		for (const c of activeClasses) {
			await syncSessionsForClass(c);
		}
	} catch (e) {
		console.error("[ensureSessionsMaterialized] Warning:", e);
	}
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

			// Pre-generate the _id so videoRoomId matches deriveRoomId(_id) exactly:
			// every reader falls back to that derivation for rows the lifecycle job
			// has not stamped yet, so the two must never disagree.
			//
			// Stamping it here does not "create the room" — a Zego room only exists
			// once someone joins. The lifecycle job still owns the T-minus-lead
			// transition to roomStatus READY.
			const sessionId = new mongoose.Types.ObjectId();
			const sessionDoc = await ScheduledSession.create({
				_id: sessionId,
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
				// Zego layout template inherited from the class — not a room id.
				streamRoomId: streamRoomId || targetClass.streamRoomId || null,
				videoRoomId: deriveRoomId(sessionId),
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
			.populate("classId", "name description creditCost mode sessionType instructor instructorUserId tags durationMinutes maxParticipants scheduleInfo recurrenceRule schedulePattern scheduleType daysOfWeek locationAddress streamRoomId enableWaitlist bookingWindowValue bookingWindowUnit bookingCloseValue bookingCloseUnit occurrenceLeadMinutes imageUrl format startDate endDate enrollmentOpensAt enrollmentClosesAt status")
			.sort({ sessionDate: 1, startTime: 1 })
			.lean();

		// Filter out sessions belonging to retired (INACTIVE) classes
		const activeSessions = sessions.filter((s: any) => s.classId && s.classId.status !== "INACTIVE");

		res.status(200).json({
			message: "Scheduled sessions retrieved successfully",
			count: activeSessions.length,
			sessions: activeSessions.map((s) => {
				// videoConferenceId must always mirror videoRoomId (never derived
				// separately) so the Admin host and User App can never resolve
				// different rooms.
				const videoRoomId = resolveSessionRoomId(s as any);
				return withAbsoluteTimes({
					...s,
					videoRoomId,
					videoConferenceId: videoRoomId,
				});
			}),
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
			.populate("classId", "name description creditCost mode sessionType instructor instructorUserId tags durationMinutes maxParticipants scheduleInfo recurrenceRule schedulePattern scheduleType daysOfWeek locationAddress streamRoomId enableWaitlist bookingWindowValue bookingWindowUnit bookingCloseValue bookingCloseUnit occurrenceLeadMinutes imageUrl format startDate endDate enrollmentOpensAt enrollmentClosesAt status isPublished")
			.sort({ sessionDate: 1, startTime: 1 })
			.lean();

		// Retiring a class (softDeleteClassById) sets Class.status = INACTIVE but
		// deliberately keeps sessions that already have bookings, and those rows stay
		// SCHEDULED/isPublished — so the session-level filter above is not enough. The
		// class state, not the session date, is what decides member visibility: a
		// retired class is hidden whether its session is today or in the future.
		const activeSessions = sessions.filter(
			(s: any) =>
				s.classId &&
				s.classId.status !== "INACTIVE" &&
				s.classId.isPublished !== false,
		);

		res.status(200).json({
			message: "Active scheduled sessions retrieved successfully",
			count: activeSessions.length,
			sessions: activeSessions.map((s) => {
				// videoConferenceId must always mirror videoRoomId (never derived
				// separately) so the Admin host and User App can never resolve
				// different rooms.
				const videoRoomId = resolveSessionRoomId(s as any);
				return withAbsoluteTimes({
					...s,
					videoRoomId,
					videoConferenceId: videoRoomId,
				});
			}),
		});
	} catch (error) {
		next(error);
	}
};

export const getScheduledSessionByIdForMembers: RequestHandler = async (
	req,
	res,
	next,
) => {
	const id = String(req.params.id);
	const isValidId =
		mongoose.Types.ObjectId.isValid(id) ||
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

	if (!isValidId) {
		res.status(400).json({
			message: "Invalid session id format. Must be a valid ObjectId or UUID.",
		});
		return;
	}

	try {
		const session = await ScheduledSession.findById(id)
			.populate(
				"classId",
				"name description creditCost mode sessionType instructor instructorUserId tags durationMinutes maxParticipants scheduleInfo recurrenceRule schedulePattern scheduleType daysOfWeek locationAddress streamRoomId enableWaitlist bookingWindowValue bookingWindowUnit bookingCloseValue bookingCloseUnit occurrenceLeadMinutes imageUrl format startDate endDate enrollmentOpensAt enrollmentClosesAt status isPublished",
			)
			.lean();

		if (!session) {
			res.status(404).json({ message: "Session not found" });
			return;
		}

		const sessionClass = (session as any).classId;
		if (
			!sessionClass ||
			sessionClass.status === "INACTIVE" ||
			sessionClass.isPublished === false
		) {
			// A retired class's direct/deep-link session lookup must look identical
			// to a missing session, not leak the fact that it was retired.
			res.status(404).json({ message: "Session not found" });
			return;
		}

		const videoRoomId = resolveSessionRoomId(session as any);
		res.status(200).json({
			session: withAbsoluteTimes({
				...session,
				videoRoomId,
				videoConferenceId: videoRoomId,
			}),
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

	// COMPLETED carries side effects — attendance backfill, a best-effort Zego
	// kick, endedAt/endedBy — that this endpoint's blind Object.assign below
	// does not perform. Route hosts/admins to the endpoint that actually does.
	if (parsed.data.status === "COMPLETED") {
		res.status(400).json({
			message:
				"Use POST /api/v1/zego/sessions/:sessionId/end to end a live session.",
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
