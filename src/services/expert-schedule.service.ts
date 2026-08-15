import mongoose from "mongoose";
import { ExpertType, UnifiedBookingStatus } from "../models/Enums";
import ExpertSchedule from "../models/ExpertSchedule";
import UnifiedBooking from "../models/UnifiedBooking";

export interface AvailableSlotDto {
	startTime: string; // "07:00"
	endTime: string; // "07:45"
	durationMinutes: number;
	isAvailable: boolean;
}

export const getOrCreateExpertSchedule = async (
	expertId: string,
	expertType: ExpertType = ExpertType.Trainer,
) => {
	const expertObjId = new mongoose.Types.ObjectId(expertId);
	let schedule = await ExpertSchedule.findOne({ expertId: expertObjId });

	if (!schedule) {
		schedule = await ExpertSchedule.create({
			expertId: expertObjId,
			expertType,
			expertModel: expertType === ExpertType.Trainer ? "Trainer" : "User",
			slotDurationMinutes: 45,
			bufferMinutes: 15,
			weeklySlots: [
				{ dayOfWeek: 1, startTime: "07:00", endTime: "20:00", isAvailable: true }, // Mon
				{ dayOfWeek: 2, startTime: "07:00", endTime: "20:00", isAvailable: true }, // Tue
				{ dayOfWeek: 3, startTime: "07:00", endTime: "20:00", isAvailable: true }, // Wed
				{ dayOfWeek: 4, startTime: "07:00", endTime: "20:00", isAvailable: true }, // Thu
				{ dayOfWeek: 5, startTime: "07:00", endTime: "20:00", isAvailable: true }, // Fri
				{ dayOfWeek: 6, startTime: "08:00", endTime: "16:00", isAvailable: true }, // Sat
				{ dayOfWeek: 0, startTime: "08:00", endTime: "14:00", isAvailable: false }, // Sun
			],
		});
	}

	return schedule;
};

export const updateExpertSchedule = async (
	expertId: string,
	data: {
		weeklySlots?: Array<{
			dayOfWeek: number;
			startTime?: string;
			endTime?: string;
			shifts?: Array<{ startTime: string; endTime: string }>;
			isAvailable: boolean;
		}>;
		slotDurationMinutes?: number;
		bufferMinutes?: number;
		blackoutDates?: Date[];
		isActive?: boolean;
	},
) => {
	// Validate split shift windows for overlaps and invalid durations
	if (Array.isArray(data.weeklySlots)) {
		for (const slotConfig of data.weeklySlots) {
			if (!slotConfig.isAvailable) continue;

			const shifts: Array<{ startTime: string; endTime: string }> = [];
			if (Array.isArray(slotConfig.shifts) && slotConfig.shifts.length > 0) {
				shifts.push(...slotConfig.shifts);
			} else if (slotConfig.startTime && slotConfig.endTime) {
				shifts.push({
					startTime: slotConfig.startTime,
					endTime: slotConfig.endTime,
				});
			}

			// 1. Check for invalid end times
			for (const shift of shifts) {
				const startMin = parseTimeToMinutes(shift.startTime);
				const endMin = parseTimeToMinutes(shift.endTime);
				if (endMin <= startMin) {
					throw new Error(
						`Invalid shift window (${shift.startTime} to ${shift.endTime}). End time must be after start time.`,
					);
				}
			}

			// 2. Sort shifts by start time and check for internal overlaps
			const sortedShifts = shifts.slice().sort(
				(a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime),
			);

			for (let i = 0; i < sortedShifts.length - 1; i++) {
				const currentEnd = parseTimeToMinutes(sortedShifts[i].endTime);
				const nextStart = parseTimeToMinutes(sortedShifts[i + 1].startTime);
				if (nextStart < currentEnd) {
					throw new Error(
						`Shift window conflict on day ${slotConfig.dayOfWeek}: Shift starting at ${sortedShifts[i + 1].startTime} overlaps with shift ending at ${sortedShifts[i].endTime}.`,
					);
				}
			}
		}
	}

	const expertObjId = new mongoose.Types.ObjectId(expertId);
	const schedule = await ExpertSchedule.findOneAndUpdate(
		{ expertId: expertObjId },
		{ $set: data },
		{ new: true, upsert: true, setDefaultsOnInsert: true },
	);
	return schedule;
};

const parseTimeToMinutes = (timeStr: string): number => {
	const [h, m] = String(timeStr).split(":").map(Number);
	return (h || 0) * 60 + (m || 0);
};

const formatMinutesToTime = (minutes: number): string => {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

export const calculateAvailableSlots = async (
	expertId: string,
	dateInput: string | Date,
): Promise<AvailableSlotDto[]> => {
	const expertObjId = new mongoose.Types.ObjectId(expertId);
	const rawDateStr =
		typeof dateInput === "string"
			? dateInput.slice(0, 10)
			: dateInput.toISOString().slice(0, 10);
	const targetDate = new Date(`${rawDateStr}T00:00:00.000Z`);
	if (Number.isNaN(targetDate.getTime())) {
		throw new Error("Invalid date input");
	}

	const schedule = await getOrCreateExpertSchedule(expertId);
	if (!schedule.isActive) {
		return [];
	}

	// 1. Check blackout dates
	const targetIsoDate = targetDate.toISOString().slice(0, 10);
	const isBlackout = (schedule.blackoutDates || []).some((bDate) => {
		return new Date(bDate).toISOString().slice(0, 10) === targetIsoDate;
	});

	if (isBlackout) {
		return [];
	}

	// 2. Check weekly schedule for day of week
	const dayOfWeek = targetDate.getDay();
	const dayConfig = (schedule.weeklySlots || []).find(
		(s) => s.dayOfWeek === dayOfWeek,
	);

	if (!dayConfig || !dayConfig.isAvailable) {
		return [];
	}

	const shiftWindows: Array<{ startTime: string; endTime: string }> = [];
	if (Array.isArray(dayConfig.shifts) && dayConfig.shifts.length > 0) {
		shiftWindows.push(...dayConfig.shifts);
	} else if (dayConfig.startTime && dayConfig.endTime) {
		shiftWindows.push({
			startTime: dayConfig.startTime,
			endTime: dayConfig.endTime,
		});
	}

	if (shiftWindows.length === 0) {
		return [];
	}

	// Filter valid windows & sort chronologically by start time
	const validShiftWindows = shiftWindows
		.filter(
			(s) => parseTimeToMinutes(s.endTime) > parseTimeToMinutes(s.startTime),
		)
		.sort(
			(a, b) =>
				parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime),
		);

	const slotDuration = schedule.slotDurationMinutes || 45;
	const buffer = schedule.bufferMinutes || 15;
	const step = slotDuration + buffer;

	// 3. Load active bookings for this date and expert
	const startOfDay = new Date(targetDate);
	startOfDay.setUTCHours(0, 0, 0, 0);
	const endOfDay = new Date(targetDate);
	endOfDay.setUTCHours(23, 59, 59, 999);

	const activeBookings = await UnifiedBooking.find({
		expertId: expertObjId,
		bookingDate: { $gte: startOfDay, $lte: endOfDay },
		status: {
			$in: [UnifiedBookingStatus.PENDING, UnifiedBookingStatus.CONFIRMED],
		},
	}).select("startTime endTime status");

	const bookedIntervals = activeBookings.map((b) => ({
		startMin: parseTimeToMinutes(b.startTime),
		endMin: parseTimeToMinutes(b.endTime),
	}));

	// 4. Generate discrete slot candidates across all shift windows
	const now = new Date();
	const isToday =
		now.toISOString().slice(0, 10) === targetDate.toISOString().slice(0, 10);
	const currentMinuteOfDay = now.getHours() * 60 + now.getMinutes();

	const slotMap = new Map<string, AvailableSlotDto>();

	for (const shift of validShiftWindows) {
		const dayStartMin = parseTimeToMinutes(shift.startTime);
		const dayEndMin = parseTimeToMinutes(shift.endTime);

		for (let min = dayStartMin; min + slotDuration <= dayEndMin; min += step) {
			const slotStartMin = min;
			const slotEndMin = min + slotDuration;

			// Filter out past slots if today (with 15 min buffer)
			if (isToday && slotStartMin <= currentMinuteOfDay + 15) {
				continue;
			}

			// Check overlap with any active booking: (slotStart < bookedEnd && slotEnd > bookedStart)
			const isColliding = bookedIntervals.some(
				(b) => slotStartMin < b.endMin && slotEndMin > b.startMin,
			);

			if (!isColliding) {
				const startFormatted = formatMinutesToTime(slotStartMin);
				if (!slotMap.has(startFormatted)) {
					slotMap.set(startFormatted, {
						startTime: startFormatted,
						endTime: formatMinutesToTime(slotEndMin),
						durationMinutes: slotDuration,
						isAvailable: true,
					});
				}
			}
		}
	}

	return Array.from(slotMap.values()).sort(
		(a, b) =>
			parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime),
	);
};
