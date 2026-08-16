import type { RequestHandler } from "express";
import z from "zod";
import mongoose from "mongoose";
import Class from "../models/Class";
import ScheduledSession from "../models/ScheduledSession";
import Booking from "../models/Bookings";
import { normalizeDeliveryType } from "../utils/delivery-type";
import {
	createClassBodySchema,
	eventFieldsSchema,
	pickEventFields,
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
 * Idempotent by day: a date that already has a session is *updated in place*,
 * never dropped and re-created. That is not a performance nicety — a session's
 * `_id` is its room identity (`deriveRoomId(_id)`, see utils/zego-room.ts) and
 * the id every client holds after listing the schedule. This function runs on
 * every admin/member schedule read (ensureSessionsMaterializedForActiveClasses),
 * so re-creating rows handed out fresh `_id`s several times a minute and any
 * client that had already loaded the list was left asking for a session that no
 * longer existed — the 409 NO_SCHEDULE / "This session has no valid schedule."
 * seen when hosting a class.
 *
 * Two invariants still hold: sessions are only removed once a replacement set
 * has actually been computed, and sessions that carry bookings are never
 * deleted.
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

	const dayKeyOf = (d: Date | string): string =>
		new Date(d).toISOString().slice(0, 10);

	// 2. Load every existing session for the class, not just the booked ones —
	//    the unbooked ones have to be matched by day and reused, not wiped.
	const existing = await ScheduledSession.find({ classId: classDoc._id });

	// One session per day is the model. Where history left duplicates for a day,
	// the booked one wins (dropping it would orphan members' bookings); the
	// oldest wins otherwise, since that is the id clients have had longest.
	const keepByDay = new Map<string, (typeof existing)[number]>();
	const redundant: typeof existing = [];
	for (const session of existing) {
		const key = dayKeyOf(session.sessionDate);
		const incumbent = keepByDay.get(key);
		if (!incumbent) {
			keepByDay.set(key, session);
			continue;
		}
		const incumbentBooked = (incumbent.currentBookings ?? 0) > 0;
		const challengerBooked = (session.currentBookings ?? 0) > 0;
		const challengerWins =
			(challengerBooked && !incumbentBooked) ||
			(challengerBooked === incumbentBooked &&
				String(session._id) < String(incumbent._id));
		if (challengerWins) {
			keepByDay.set(key, session);
			redundant.push(incumbent);
		} else {
			redundant.push(session);
		}
	}

	const targetDayKeys = new Set(dates.map(dayKeyOf));
	const reusedDayKeys = new Set(
		[...keepByDay.keys()].filter((key) => targetDayKeys.has(key)),
	);
	const toCreate = dates.filter((d) => !keepByDay.has(dayKeyOf(d)));

	// A session the schedule no longer covers goes only if nobody booked it; a
	// booked one outside the new recurrence is honoured rather than cancelled
	// out from under the member.
	const stale = [...keepByDay.entries()]
		.filter(([key]) => !targetDayKeys.has(key))
		.map(([, session]) => session)
		.filter((session) => (session.currentBookings ?? 0) <= 0);
	const removable = [
		...stale,
		...redundant.filter((session) => (session.currentBookings ?? 0) <= 0),
	];

	if (options.dryRun) {
		return {
			created: toCreate.length,
			deleted: removable.length,
			preserved: reusedDayKeys.size,
			skipped: false,
		};
	}

	const deliveryType = normalizeDeliveryType(classDoc.mode);
	const capacity = classDoc.maxParticipants || 20;

	// 3. Update the surviving sessions in place, keeping `_id` (room identity),
	//    `status` (a COMPLETED occurrence stays completed) and the booking
	//    counters, and taking only the class-derived fields from the template.
	for (const key of reusedDayKeys) {
		const session = keepByDay.get(key);
		if (!session) continue;
		session.startTime = startTime;
		session.endTime = endTime;
		session.deliveryType = deliveryType;
		session.locationAddress = classDoc.locationAddress || null;
		// Zego layout template, not a room id — see resolveSessionRoomId.
		session.streamRoomId = classDoc.streamRoomId || null;
		// Resizing a session that people have already booked into would have to
		// reconcile remainingCapacity against those bookings; leave that to the
		// capacity engine and only apply the class default to empty sessions.
		if ((session.currentBookings ?? 0) <= 0) {
			session.capacity = capacity;
			session.remainingCapacity = capacity;
		}
		if (session.isModified()) await session.save();
	}

	// 4. Create the days that have no session yet. Upsert rather than create:
	//    this runs on every schedule read, so two concurrent readers would
	//    otherwise both materialize the same day and hand two different room ids
	//    out for one class.
	for (const sessionDate of toCreate) {
		await ScheduledSession.findOneAndUpdate(
			{ classId: classDoc._id, sessionDate },
			{
				$setOnInsert: {
					trainerId: null,
					startTime,
					endTime,
					deliveryType,
					locationAddress: classDoc.locationAddress || null,
					streamRoomId: classDoc.streamRoomId || null,
					// `videoRoomId` is deliberately left unset — the lifecycle job
					// stamps it at (start - lead), and every reader derives the
					// identical value from _id until then.
					capacity,
					currentBookings: 0,
					remainingCapacity: capacity,
					status: "SCHEDULED",
				},
			},
			{ upsert: true, setDefaultsOnInsert: true },
		);
	}

	// 5. Drop what the schedule no longer covers, plus historical duplicates.
	let deleted = 0;
	if (removable.length > 0) {
		const result = await ScheduledSession.deleteMany({
			_id: { $in: removable.map((session) => session._id) },
		});
		deleted = result.deletedCount ?? 0;
	}

	return {
		created: toCreate.length,
		deleted,
		preserved: reusedDayKeys.size,
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
		const classDetail = await Class.findById(id).lean();

		if (!classDetail) {
			res.status(404).json({
				message:
					"Class not found. If this is a session id, use GET /api/v1/classes/schedule/:id.",
			});
			return;
		}

		// Retired/unpublished classes stay visible to admin and trainer (dashboard
		// still needs to show/edit them) but must 404 for members, same as a
		// missing class, so a retired class can't be reached via a direct/deep link.
		const requesterRole = (req.user as any)?.role;
		if (
			requesterRole === "user" &&
			((classDetail as any).status === "INACTIVE" ||
				(classDetail as any).isPublished === false)
		) {
			res.status(404).json({
				message:
					"Class not found. If this is a session id, use GET /api/v1/classes/schedule/:id.",
			});
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
		// The validator only sees the fields that were sent. Flipping a class to
		// `batch` without resending its dates, or moving one end of a run in
		// isolation, can still produce an inconsistent document — so the event
		// rules are re-checked against the merged result.
		const existing = await Class.findById(id).lean();
		if (!existing) {
			res.status(404).json({ message: "Class not found" });
			return;
		}

		const mergedEventFields = eventFieldsSchema.safeParse({
			...pickEventFields(existing),
			...pickEventFields(parsedBody.data),
		});

		if (!mergedEventFields.success) {
			res.status(400).json({
				message: "Invalid class update payload",
				errors: mergedEventFields.error.issues,
			});
			return;
		}

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
