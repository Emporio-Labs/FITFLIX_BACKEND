import type { RequestHandler } from "express";
import z from "zod";
import mongoose from "mongoose";
import Class from "../models/Class";
import ScheduledSession from "../models/ScheduledSession";
import {
	createClassBodySchema,
	updateClassBodySchema,
} from "../validators/class.validator";

// Helper to validate UUID format
const isValidUuid = (id: string | undefined): boolean => {
	if (!id) return false;
	return z.string().uuid().safeParse(id).success;
};

function formatHHMM(date: Date): string {
	const h = String(date.getUTCHours()).padStart(2, "0");
	const m = String(date.getUTCMinutes()).padStart(2, "0");
	return `${h}:${m}`;
}

export async function syncSessionsForClass(classDoc: any) {
	const scheduleInfo = classDoc.scheduleInfo;
	const hasAnySchedule = scheduleInfo?.trim() || classDoc.recurrenceRule || classDoc.daysOfWeek?.length;
	if (!hasAnySchedule) {
		return;
	}

	// 1. Delete existing future scheduled sessions for this class
	const todayStart = new Date();
	todayStart.setUTCHours(0, 0, 0, 0);
	await ScheduledSession.deleteMany({
		classId: classDoc._id,
		sessionDate: { $gte: todayStart },
	});

	// 2. Parse schedule — prefer structured fields, fall back to scheduleInfo text
	let frequency: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY" = "NONE";
	const daysOfWeek: number[] = [];
	let startTime = "09:00";
	let endTime = "10:00";
	let maxOccurrences = 1;
	const startDate = new Date();
	startDate.setUTCHours(0, 0, 0, 0);

	// --- Use structured recurrenceRule if available ---
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

	// --- Use structured daysOfWeek if available ---
	if (Array.isArray(classDoc.daysOfWeek) && classDoc.daysOfWeek.length > 0) {
		daysOfWeek.push(...classDoc.daysOfWeek.map(Number));
	} else if (scheduleInfo) {
		const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
		dayNames.forEach((dayName, index) => {
			if (scheduleInfo.includes(dayName)) {
				daysOfWeek.push(index);
			}
		});
	}

	// Parse time window from scheduleInfo text
	if (scheduleInfo) {
		const timeMatch = scheduleInfo.match(/(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})/);
		if (timeMatch) {
			startTime = timeMatch[1];
			endTime = timeMatch[2];
		}

		// Parse occurrences
		const occMatch = scheduleInfo.match(/(\d+)\s*occurrence/);
		if (occMatch) {
			maxOccurrences = parseInt(occMatch[1], 10);
		} else {
			maxOccurrences = frequency === "NONE" ? 1 : 90;
		}
	} else {
		maxOccurrences = frequency === "NONE" ? 1 : 90;
	}

	// Generate session dates
	const results: Date[] = [];
	const capDate = new Date();
	capDate.setDate(capDate.getDate() + 90); // Cap at 90 days out
	capDate.setUTCHours(23, 59, 59, 999);

	const cursor = new Date(startDate);
	while (cursor <= capDate && results.length < maxOccurrences) {
		const dayVal = cursor.getUTCDay();
		const dayOfMonth = cursor.getUTCDate();

		if (frequency === "DAILY") {
			results.push(new Date(cursor));
			cursor.setUTCDate(cursor.getUTCDate() + 1);
		} else if (frequency === "WEEKLY") {
			if (daysOfWeek.length === 0 || daysOfWeek.includes(dayVal)) {
				results.push(new Date(cursor));
			}
			cursor.setUTCDate(cursor.getUTCDate() + 1);
		} else if (frequency === "MONTHLY") {
			const targetDay = daysOfWeek[0] ?? 1;
			if (dayOfMonth === targetDay) {
				results.push(new Date(cursor));
			}
			cursor.setUTCDate(cursor.getUTCDate() + 1);
		} else {
			// One-time
			if (scheduleInfo) {
				const dateMatch = scheduleInfo.match(/One-Time:\s*([A-Za-z]+,\s*[A-Za-z]+\s*\d{1,2},\s*\d{4})/);
				if (dateMatch) {
					const parsedD = new Date(dateMatch[1]);
					if (!isNaN(parsedD.getTime())) {
						parsedD.setUTCHours(0, 0, 0, 0);
						results.push(parsedD);
					}
				}
			}
			break;
		}
	}

	// 3. Create ScheduledSession documents — derive deliveryType from class.mode
	const modeUpper = String(classDoc.mode || "OFFLINE").toUpperCase();
	const deliveryType = (modeUpper === "ONLINE" || modeUpper === "HYBRID") ? modeUpper : "OFFLINE";

	for (const sessionDate of results) {
		await ScheduledSession.create({
			classId: classDoc._id,
			trainerId: null,
			sessionDate,
			startTime,
			endTime,
			deliveryType,
			locationAddress: classDoc.locationAddress || null,
			streamRoomId: classDoc.streamRoomId || null,
			capacity: classDoc.maxParticipants || 20,
			currentBookings: 0,
			remainingCapacity: classDoc.maxParticipants || 20,
			status: "SCHEDULED",
		});
	}
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
		const retiredClass = await Class.findByIdAndUpdate(
			id,
			{ status: "INACTIVE" },
			{ returnDocument: "after" },
		);

		if (!retiredClass) {
			res.status(404).json({ message: "Class not found" });
			return;
		}

		res.status(200).json({ message: "Class retired", class: retiredClass });
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
