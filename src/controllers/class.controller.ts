import type { RequestHandler } from "express";
import z from "zod";
import mongoose from "mongoose";
import Class from "../models/Class";
import ScheduledSession from "../models/ScheduledSession";
import Booking from "../models/Bookings";
import { normalizeDeliveryType } from "../utils/delivery-type";
import {
	createClassBodySchema,
	updateClassBodySchema,
} from "../validators/class.validator";

// Helper to validate UUID format
const isValidUuid = (id: string | undefined): boolean => {
	if (!id) return false;
	return z.string().uuid().safeParse(id).success;
};

/** Day-of-week index by name, accepting the abbreviations the admin portal emits. */
const DAY_NAME_TO_INDEX: Record<string, number> = {
	sunday: 0,
	sun: 0,
	monday: 1,
	mon: 1,
	tuesday: 2,
	tue: 2,
	tues: 2,
	wednesday: 3,
	wed: 3,
	thursday: 4,
	thu: 4,
	thurs: 4,
	friday: 5,
	fri: 5,
	saturday: 6,
	sat: 6,
};

export interface ScheduleSyncSummary {
	created: number;
	deleted: number;
	preserved: number;
	skipped: boolean;
	reason?: string;
}

/**
 * Resolve a class's recurrence into concrete session dates.
 *
 * Prefers the structured fields (`recurrenceRule`, `daysOfWeek`) and falls back
 * to parsing the human-readable `scheduleInfo` string, which is the only place
 * the admin portal records the time window and occurrence count.
 */
function resolveScheduleForClass(classDoc: any): {
	dates: Date[];
	startTime: string;
	endTime: string;
} {
	const scheduleInfo: string | undefined = classDoc.scheduleInfo;

	let frequency: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY" = "NONE";
	const daysOfWeek: number[] = [];
	let startTime = "09:00";
	let endTime = "10:00";
	let maxOccurrences = 1;

	const startDate = new Date();
	startDate.setUTCHours(0, 0, 0, 0);

	// --- Frequency: structured field wins, scheduleInfo prose is the fallback ---
	if (classDoc.recurrenceRule && classDoc.recurrenceRule !== "NONE") {
		frequency = classDoc.recurrenceRule as "DAILY" | "WEEKLY" | "MONTHLY";
	} else if (scheduleInfo) {
		if (scheduleInfo.includes("Weekly")) {
			frequency = "WEEKLY";
		} else if (scheduleInfo.includes("Daily")) {
			frequency = "DAILY";
		} else if (scheduleInfo.includes("Monthly")) {
			frequency = "MONTHLY";
		} else if (scheduleInfo.includes("One-Time")) {
			frequency = "NONE";
		}
	}

	// --- Days: structured field wins; otherwise read day names out of the prose.
	// The portal writes abbreviations ("Weekly on Mon, Tue, Wed"), so matching
	// full names alone would silently yield an empty set for legacy documents.
	if (Array.isArray(classDoc.daysOfWeek) && classDoc.daysOfWeek.length > 0) {
		daysOfWeek.push(...classDoc.daysOfWeek.map(Number));
	} else if (scheduleInfo) {
		for (const token of scheduleInfo.match(/[A-Za-z]+/g) ?? []) {
			const index = DAY_NAME_TO_INDEX[token.toLowerCase()];
			if (index !== undefined && !daysOfWeek.includes(index)) {
				daysOfWeek.push(index);
			}
		}
	}

	// --- Time window and occurrence count: only ever present in scheduleInfo ---
	if (scheduleInfo) {
		const timeMatch = scheduleInfo.match(
			/(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/,
		);
		if (timeMatch?.[1] && timeMatch[2]) {
			startTime = timeMatch[1].padStart(5, "0");
			endTime = timeMatch[2].padStart(5, "0");
		}

		const occMatch = scheduleInfo.match(/(\d+)\s*occurrence/);
		maxOccurrences = occMatch?.[1]
			? parseInt(occMatch[1], 10)
			: frequency === "NONE"
				? 1
				: 90;
	} else {
		maxOccurrences = frequency === "NONE" ? 1 : 90;
	}

	// Structured times, if a future admin payload ever sends them, take priority.
	if (typeof classDoc.startTime === "string" && classDoc.startTime.includes(":")) {
		startTime = classDoc.startTime;
	}
	if (typeof classDoc.endTime === "string" && classDoc.endTime.includes(":")) {
		endTime = classDoc.endTime;
	}

	// A WEEKLY rule with no days resolved would otherwise match *every* day and
	// generate a session daily. Anchor it to the start date's weekday instead.
	if (frequency === "WEEKLY" && daysOfWeek.length === 0) {
		daysOfWeek.push(startDate.getUTCDay());
	}

	const dates: Date[] = [];
	const capDate = new Date();
	capDate.setDate(capDate.getDate() + 90); // Cap at 90 days out
	capDate.setUTCHours(23, 59, 59, 999);

	if (frequency === "NONE") {
		// One-time: the only date lives in the scheduleInfo text.
		const dateMatch = scheduleInfo?.match(/One-Time:\s*([^·\n]+)/);
		if (dateMatch?.[1]) {
			const rawDateStr = dateMatch[1].trim();
			let parsed = new Date(rawDateStr);
			if (Number.isNaN(parsed.getTime())) {
				const stripped = rawDateStr.replace(/^[A-Za-z]+,\s*/, "");
				parsed = new Date(stripped);
			}
			if (!Number.isNaN(parsed.getTime())) {
				const utcMidnight = new Date(
					Date.UTC(
						parsed.getFullYear(),
						parsed.getMonth(),
						parsed.getDate(),
						0,
						0,
						0,
						0,
					),
				);
				dates.push(utcMidnight);
			}
		}
		return { dates, startTime, endTime };
	}

	const cursor = new Date(startDate);
	while (cursor <= capDate && dates.length < maxOccurrences) {
		if (frequency === "DAILY") {
			dates.push(new Date(cursor));
		} else if (frequency === "WEEKLY") {
			if (daysOfWeek.includes(cursor.getUTCDay())) {
				dates.push(new Date(cursor));
			}
		} else if (frequency === "MONTHLY") {
			// For monthly recurrence the admin portal overloads daysOfWeek[0] as a
			// day-of-month (1-31), so compare against the calendar date.
			if (cursor.getUTCDate() === (daysOfWeek[0] ?? 1)) {
				dates.push(new Date(cursor));
			}
		}
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}

	return { dates, startTime, endTime };
}

/**
 * Materialize `ScheduledSession` rows for a class's recurrence.
 *
 * Regenerating is destructive by nature, so two invariants hold: future sessions
 * are only removed once a replacement set has actually been computed, and
 * sessions that already carry bookings are never deleted.
 */
export async function syncSessionsForClass(
	classDoc: any,
	options: { dryRun?: boolean } = {},
): Promise<ScheduleSyncSummary> {
	const hasAnySchedule =
		classDoc.scheduleInfo?.trim() ||
		(classDoc.recurrenceRule && classDoc.recurrenceRule !== "NONE") ||
		classDoc.daysOfWeek?.length;
	if (!hasAnySchedule) {
		return {
			created: 0,
			deleted: 0,
			preserved: 0,
			skipped: true,
			reason: "no schedule configured",
		};
	}

	// 1. Resolve the replacement set *before* touching anything. A schedule we
	//    cannot parse must leave the existing sessions alone rather than wipe them.
	const { dates, startTime, endTime } = resolveScheduleForClass(classDoc);
	if (dates.length === 0) {
		return {
			created: 0,
			deleted: 0,
			preserved: 0,
			skipped: true,
			reason: "schedule produced no dates",
		};
	}

	const todayStart = new Date();
	todayStart.setUTCHours(0, 0, 0, 0);

	// 2. Sessions with bookings are load-bearing for members — keep them, and
	//    remember their dates so step 4 doesn't create a duplicate alongside.
	const booked = await ScheduledSession.find({
		classId: classDoc._id,
		currentBookings: { $gt: 0 },
	})
		.select("sessionDate")
		.lean();

	const preservedDayKeys = new Set(
		booked.map((s: any) => new Date(s.sessionDate).toISOString().slice(0, 10)),
	);

	if (options.dryRun) {
		const toCreate = dates.filter(
			(d) => !preservedDayKeys.has(d.toISOString().slice(0, 10)),
		);
		return {
			created: toCreate.length,
			deleted: 0,
			preserved: preservedDayKeys.size,
			skipped: false,
		};
	}

	// 3. Clear unbooked sessions for this class (including misdated legacy rows).
	const deleteResult = await ScheduledSession.deleteMany({
		classId: classDoc._id,
		$or: [{ currentBookings: { $lte: 0 } }, { currentBookings: null }],
	});

	// 4. Recreate, deriving deliveryType from the parent class's mode.
	const deliveryType = normalizeDeliveryType(classDoc.mode);
	const capacity = classDoc.maxParticipants || 20;
	let created = 0;

	for (const sessionDate of dates) {
		if (preservedDayKeys.has(sessionDate.toISOString().slice(0, 10))) continue;

		await ScheduledSession.create({
			classId: classDoc._id,
			trainerId: null,
			sessionDate,
			startTime,
			endTime,
			deliveryType,
			locationAddress: classDoc.locationAddress || null,
			streamRoomId: classDoc.streamRoomId || null,
			capacity,
			currentBookings: 0,
			remainingCapacity: capacity,
			status: "SCHEDULED",
		});
		created += 1;
	}

	return {
		created,
		deleted: deleteResult.deletedCount ?? 0,
		preserved: preservedDayKeys.size,
		skipped: false,
	};
}

export const createClass: RequestHandler = async (req, res, next) => {
	const parsedBody = createClassBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid class payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	try {
		const newClass = await Class.create(parsedBody.data);
		await syncSessionsForClass(newClass);
		res.status(201).json({ message: "Class created", class: newClass });
	} catch (error) {
		next(error);
	}
};

export const getAllClassesForAdmin: RequestHandler = async (
	_req,
	res,
	next,
) => {
	try {
		const classes = await Class.find().sort({ createdAt: -1 });
		res.status(200).json({ classes });
	} catch (error) {
		next(error);
	}
};

export const getActiveClassesForMembers: RequestHandler = async (
	_req,
	res,
	next,
) => {
	try {
		// Member-facing listing returns *only* active and published classes
		const classes = await Class.find({
			status: "ACTIVE",
			isPublished: { $ne: false },
		}).sort({
			createdAt: -1,
		});
		res.status(200).json({ classes });
	} catch (error) {
		next(error);
	}
};

export const getClassById: RequestHandler = async (req, res, next) => {
	const id = String(req.params.id);

	const isUuid = z.string().uuid().safeParse(id).success;
	const isObjectId = mongoose.Types.ObjectId.isValid(id);
	if (!isUuid && !isObjectId) {
		res.status(400).json({
			message: "Invalid class id format. Must be a valid UUID or ObjectId.",
		});
		return;
	}

	try {
		let classDetail = await Class.findById(id).lean();

		if (!classDetail && isObjectId) {
			const sessionDetail = await ScheduledSession.findById(id).populate("classId").lean();
			if (sessionDetail && sessionDetail.classId) {
				const classObj = sessionDetail.classId as any;
				classDetail = {
					...classObj,
					_id: sessionDetail._id,
					classId: classObj,
					sessionDate: sessionDetail.sessionDate,
					startTime: sessionDetail.startTime,
					endTime: sessionDetail.endTime,
					status: sessionDetail.status,
					capacity: sessionDetail.capacity,
					currentBookings: sessionDetail.currentBookings,
					remainingCapacity: sessionDetail.remainingCapacity,
				};
			}
		}

		if (!classDetail) {
			res.status(404).json({ message: "Class not found" });
			return;
		}

		res.status(200).json({ class: classDetail });
	} catch (error) {
		next(error);
	}
};

export const updateClassById: RequestHandler = async (req, res, next) => {
	const { id } = req.params;

	if (!isValidUuid(id)) {
		res.status(400).json({
			message: "Invalid class id format. Must be a valid UUID.",
		});
		return;
	}

	const parsedBody = updateClassBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid class update payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	try {
		const updatedClass = await Class.findByIdAndUpdate(id, parsedBody.data, {
			returnDocument: "after",
			runValidators: true,
		});

		if (!updatedClass) {
			res.status(404).json({ message: "Class not found" });
			return;
		}

		await syncSessionsForClass(updatedClass);
		res.status(200).json({ message: "Class updated", class: updatedClass });
	} catch (error) {
		next(error);
	}
};

export const softDeleteClassById: RequestHandler = async (req, res, next) => {
	const { id } = req.params;

	if (!isValidUuid(id)) {
		res.status(400).json({
			message: "Invalid class id format. Must be a valid UUID.",
		});
		return;
	}

	try {
		const hasBookings = await Booking.exists({ classId: id });
		const hasActiveSessionBookings = await ScheduledSession.exists({
			classId: id,
			currentBookings: { $gt: 0 },
		});

		if (hasBookings || hasActiveSessionBookings) {
			// Soft delete/retire the class by setting status to INACTIVE.
			const retiredClass = await Class.findByIdAndUpdate(
				id,
				{ status: "INACTIVE" },
				{ returnDocument: "after" },
			);

			if (!retiredClass) {
				res.status(404).json({ message: "Class not found" });
				return;
			}

			// Clean up unbooked sessions of the retired class
			await ScheduledSession.deleteMany({
				classId: id,
				$or: [{ currentBookings: { $lte: 0 } }, { currentBookings: null }],
			});

			res.status(200).json({ message: "Class retired", class: retiredClass });
		} else {
			// Hard delete the class and all associated unbooked sessions
			const deletedClass = await Class.findByIdAndDelete(id);

			if (!deletedClass) {
				res.status(404).json({ message: "Class not found" });
				return;
			}

			await ScheduledSession.deleteMany({ classId: id });

			res.status(200).json({
				message: "Class deleted successfully",
				class: deletedClass,
			});
		}
	} catch (error) {
		next(error);
	}
};

export const publishClassById: RequestHandler = async (req, res, next) => {
	const { id } = req.params;

	if (!isValidUuid(id)) {
		res.status(400).json({
			message: "Invalid class id format. Must be a valid UUID.",
		});
		return;
	}

	const isPublished =
		req.body?.isPublished !== undefined
			? Boolean(req.body.isPublished)
			: req.body?.is_published !== undefined
				? Boolean(req.body.is_published)
				: true;

	try {
		const updatedClass = await Class.findByIdAndUpdate(
			id,
			{ isPublished, status: isPublished ? "ACTIVE" : "INACTIVE" },
			{ returnDocument: "after" },
		);

		if (!updatedClass) {
			res.status(404).json({ message: "Class not found" });
			return;
		}

		await syncSessionsForClass(updatedClass);
		res.status(200).json({
			message: isPublished ? "Class published" : "Class unpublished",
			class: updatedClass,
		});
	} catch (error) {
		next(error);
	}
};
