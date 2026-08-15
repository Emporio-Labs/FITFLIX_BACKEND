import mongoose from "mongoose";
import { ExpertType, UnifiedBookingStatus } from "../models/Enums";
import ExpertSchedule from "../models/ExpertSchedule";
import UnifiedBooking from "../models/UnifiedBooking";
import { resolveBookingTimeContext } from "../utils/location.resolver";
import {
	formatDateInZone,
	minutesIntoDayInZone,
} from "../utils/timezone.util";

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
			startTime: string;
			endTime: string;
			isAvailable: boolean;
		}>;
		slotDurationMinutes?: number;
		bufferMinutes?: number;
		blackoutDates?: Date[];
		isActive?: boolean;
	},
) => {
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
	// Branch zone governing "what time is it there right now". Resolved from
	// the sole active location when the caller doesn't pass one.
	timeZoneInput?: string,
): Promise<AvailableSlotDto[]> => {
	const expertObjId = new mongoose.Types.ObjectId(expertId);
	const timeZone =
		timeZoneInput || (await resolveBookingTimeContext(null)).timezone;
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

	// 2. Check weekly schedule for day of week.
	// targetDate is a calendar date pinned to UTC midnight, so its weekday must
	// be read in UTC. getDay() reads the server's local zone, which lands on the
	// previous day for any server running behind UTC.
	const dayOfWeek = targetDate.getUTCDay();
	const dayConfig = (schedule.weeklySlots || []).find(
		(s) => s.dayOfWeek === dayOfWeek,
	);

	if (!dayConfig || !dayConfig.isAvailable) {
		return [];
	}

	const dayStartMin = parseTimeToMinutes(dayConfig.startTime);
	const dayEndMin = parseTimeToMinutes(dayConfig.endTime);
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

	// 4. Generate discrete slot candidates.
	// Both halves of the "is this slot already past?" test must be read in the
	// branch's zone. Previously the date came from now.toISOString() (UTC) while
	// the clock came from now.getHours() (server-local): on an IST server the
	// UTC date rolls over at 18:30, so from then until midnight `isToday` was
	// false for the actual current day and past slots were offered as bookable.
	const now = new Date();
	// rawDateStr is already the requested calendar day; compare it against what
	// day it currently is *at the branch*, not on the server.
	const isToday = formatDateInZone(now, timeZone) === rawDateStr;
	const currentMinuteOfDay = minutesIntoDayInZone(now, timeZone);

	const availableSlots: AvailableSlotDto[] = [];

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
			availableSlots.push({
				startTime: formatMinutesToTime(slotStartMin),
				endTime: formatMinutesToTime(slotEndMin),
				durationMinutes: slotDuration,
				isAvailable: true,
			});
		}
	}

	return availableSlots;
};
