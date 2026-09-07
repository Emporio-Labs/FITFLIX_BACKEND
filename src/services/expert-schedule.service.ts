import mongoose from "mongoose";
import {
	AppointmentBookingStatus,
	AppointmentMode,
	ExpertType,
	UnifiedBookingStatus,
} from "../models/Enums";
import ExpertAppointment from "../models/ExpertAppointment";
import ExpertSchedule from "../models/ExpertSchedule";
import Trainer from "../models/Trainer";
import UnifiedBooking from "../models/UnifiedBooking";
import User from "../models/User";
import {
	type CanonicalAppointmentMode,
	normalizeAppointmentMode,
	normalizeSupportedModes,
} from "../utils/appointment-mode";
import { resolveBookingTimeContext } from "../utils/location.resolver";
import { formatDateInZone, minutesIntoDayInZone } from "../utils/timezone.util";

export interface AvailableSlotDto {
	startTime: string; // "07:00"
	endTime: string; // "07:45"
	durationMinutes: number;
	isAvailable: boolean;
}

/** A pooled slot also names every expert free at that time. */
export interface PooledSlotDto extends AvailableSlotDto {
	expertIds: string[];
}

export interface ExpertDirectoryEntry {
	id: string;
	name: string;
	expertType: ExpertType;
	expertModel: "Trainer" | "User";
}

/**
 * Which collection an expert of a given type lives in. `ExpertSchedule.expertModel`
 * has always accepted both — only the wiring hardcoded "Trainer".
 */
export const expertModelForType = (
	expertType: ExpertType,
): "Trainer" | "User" =>
	expertType === ExpertType.Trainer ? "Trainer" : "User";

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
			expertModel: expertModelForType(expertType),
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
		supportedModes?: unknown;
		maxAdvanceBookingDays?: number;
		isActive?: boolean;
	},
	expertType: ExpertType = ExpertType.Trainer,
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

	const { supportedModes, ...rest } = data;
	const update: Record<string, unknown> = { ...rest };

	// Fold OFFLINE → IN_PERSON here so the availability filter only ever sees
	// the two canonical values.
	if (supportedModes !== undefined) {
		update.supportedModes = normalizeSupportedModes(supportedModes);
	}

	const expertObjId = new mongoose.Types.ObjectId(expertId);
	const schedule = await ExpertSchedule.findOneAndUpdate(
		{ expertId: expertObjId },
		{
			$set: update,
			// Only stamped when this upsert actually inserts, so an existing
			// trainer schedule is never retyped by a nutritionist-scoped call.
			$setOnInsert: {
				expertType,
				expertModel: expertModelForType(expertType),
			},
		},
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

type BookedInterval = { startMin: number; endMin: number };

/**
 * Every source that can occupy an expert's time, keyed by expert id.
 *
 * `UnifiedBooking.expertId` covers personal training and — after the
 * nutritionist migration — 1:1 nutrition consultations. `ExpertAppointment`
 * is still the sports-scientist collection and is keyed by `assignedExpertId`,
 * so it has to be swept too: a check that only looked at UnifiedBooking would
 * happily offer a sports scientist a time they are already booked for.
 */
const loadBookedIntervals = async (
	expertIds: mongoose.Types.ObjectId[],
	startOfDay: Date,
	endOfDay: Date,
): Promise<Map<string, BookedInterval[]>> => {
	const byExpert = new Map<string, BookedInterval[]>();
	if (expertIds.length === 0) return byExpert;

	const push = (
		key: unknown,
		startTime?: string | null,
		endTime?: string | null,
	) => {
		if (!key || !startTime || !endTime) return;
		const id = String(key);
		const interval = {
			startMin: parseTimeToMinutes(startTime),
			endMin: parseTimeToMinutes(endTime),
		};
		const existing = byExpert.get(id);
		if (existing) existing.push(interval);
		else byExpert.set(id, [interval]);
	};

	const [unified, appointments] = await Promise.all([
		UnifiedBooking.find({
			expertId: { $in: expertIds },
			bookingDate: { $gte: startOfDay, $lte: endOfDay },
			status: {
				$in: [UnifiedBookingStatus.PENDING, UnifiedBookingStatus.CONFIRMED],
			},
		})
			.select("expertId startTime endTime")
			.lean(),
		ExpertAppointment.find({
			assignedExpertId: { $in: expertIds },
			appointmentDate: { $gte: startOfDay, $lte: endOfDay },
			bookingStatus: {
				$in: [
					AppointmentBookingStatus.Pending,
					AppointmentBookingStatus.Confirmed,
				],
			},
		})
			.select("assignedExpertId startTime endTime")
			.lean(),
	]);

	for (const b of unified) push(b.expertId, b.startTime, b.endTime);
	for (const a of appointments)
		push(a.assignedExpertId, a.startTime, a.endTime);

	return byExpert;
};

/** The shift windows an expert actually works on `targetDate`, or [] for none. */
const resolveDayWindows = (
	schedule: { weeklySlots?: unknown; blackoutDates?: unknown },
	targetDate: Date,
): Array<{ startTime: string; endTime: string }> => {
	// 1. Blackout dates (leave / holiday) beat everything else.
	const targetIsoDate = targetDate.toISOString().slice(0, 10);
	const blackouts = (schedule.blackoutDates || []) as Date[];
	const isBlackout = blackouts.some(
		(bDate) => new Date(bDate).toISOString().slice(0, 10) === targetIsoDate,
	);
	if (isBlackout) return [];

	// 2. Weekly schedule for day of week.
	// targetDate is a calendar date pinned to UTC midnight, so its weekday must
	// be read in UTC. getDay() reads the server's local zone, which lands on the
	// previous day for any server running behind UTC.
	const dayOfWeek = targetDate.getUTCDay();
	const weeklySlots = (schedule.weeklySlots || []) as Array<{
		dayOfWeek: number;
		startTime?: string | null;
		endTime?: string | null;
		shifts?: Array<{ startTime: string; endTime: string }> | null;
		isAvailable?: boolean;
	}>;
	const dayConfig = weeklySlots.find((s) => s.dayOfWeek === dayOfWeek);

	if (!dayConfig || !dayConfig.isAvailable) return [];

	const shiftWindows: Array<{ startTime: string; endTime: string }> = [];
	if (Array.isArray(dayConfig.shifts) && dayConfig.shifts.length > 0) {
		shiftWindows.push(...dayConfig.shifts);
	} else if (dayConfig.startTime && dayConfig.endTime) {
		shiftWindows.push({
			startTime: dayConfig.startTime,
			endTime: dayConfig.endTime,
		});
	}

	return shiftWindows
		.filter(
			(s) => parseTimeToMinutes(s.endTime) > parseTimeToMinutes(s.startTime),
		)
		.sort(
			(a, b) =>
				parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime),
		);
};

const generateSlots = (
	schedule: { slotDurationMinutes?: number | null; bufferMinutes?: number | null },
	windows: Array<{ startTime: string; endTime: string }>,
	bookedIntervals: BookedInterval[],
	isToday: boolean,
	currentMinuteOfDay: number,
): AvailableSlotDto[] => {
	const slotDuration = schedule.slotDurationMinutes || 45;
	const buffer = schedule.bufferMinutes ?? 15;
	const step = slotDuration + buffer;

	const slotMap = new Map<string, AvailableSlotDto>();

	for (const shift of windows) {
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
		(a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime),
	);
};

const resolveTargetDate = (dateInput: string | Date) => {
	const rawDateStr =
		typeof dateInput === "string"
			? dateInput.slice(0, 10)
			: dateInput.toISOString().slice(0, 10);
	const targetDate = new Date(`${rawDateStr}T00:00:00.000Z`);
	if (Number.isNaN(targetDate.getTime())) {
		throw new Error("Invalid date input");
	}
	return { rawDateStr, targetDate };
};

/**
 * Days between "today at the branch" and the requested date. Negative for a
 * past date. Used to enforce maxAdvanceBookingDays, which until now was stored
 * and never checked.
 */
const daysAhead = (rawDateStr: string, todayStr: string): number => {
	const target = Date.parse(`${rawDateStr}T00:00:00.000Z`);
	const today = Date.parse(`${todayStr}T00:00:00.000Z`);
	if (Number.isNaN(target) || Number.isNaN(today)) return 0;
	return Math.round((target - today) / 86_400_000);
};

export interface CalculateAvailabilityOptions {
	/** When given, an expert whose supportedModes excludes it returns nothing. */
	mode?: AppointmentMode | string | null;
	/** Governs which collection a missing schedule is created against. */
	expertType?: ExpertType;
	/** Pre-loaded schedule, so pooled availability doesn't refetch per expert. */
	schedule?: Awaited<ReturnType<typeof getOrCreateExpertSchedule>> | null;
	/** Pre-loaded collisions, same reason. */
	bookedIntervals?: BookedInterval[];
}

export const calculateAvailableSlots = async (
	expertId: string,
	dateInput: string | Date,
	// Branch zone governing "what time is it there right now". Resolved from
	// the sole active location when the caller doesn't pass one.
	timeZoneInput?: string,
	options: CalculateAvailabilityOptions = {},
): Promise<AvailableSlotDto[]> => {
	const expertObjId = new mongoose.Types.ObjectId(expertId);
	const timeZone =
		timeZoneInput || (await resolveBookingTimeContext(null)).timezone;
	const { rawDateStr, targetDate } = resolveTargetDate(dateInput);

	const schedule =
		options.schedule ??
		(await getOrCreateExpertSchedule(
			expertId,
			options.expertType ?? ExpertType.Trainer,
		));
	if (!schedule.isActive) {
		return [];
	}

	// Mode gate: an online-only nutritionist has no in-person availability, and
	// vice versa. Unrecognised input is treated as "no filter" rather than
	// silently emptying the list.
	const requestedMode = normalizeAppointmentMode(options.mode);
	if (requestedMode) {
		const supported = normalizeSupportedModes(schedule.supportedModes);
		if (!supported.includes(requestedMode)) {
			return [];
		}
	}

	const now = new Date();
	const todayStr = formatDateInZone(now, timeZone);

	// Booking horizon. Past dates and anything beyond maxAdvanceBookingDays
	// return nothing, so the server and the client's date picker agree.
	const offset = daysAhead(rawDateStr, todayStr);
	if (offset < 0) return [];
	const horizon = schedule.maxAdvanceBookingDays || 60;
	if (offset > horizon) return [];

	const windows = resolveDayWindows(schedule, targetDate);
	if (windows.length === 0) return [];

	let bookedIntervals = options.bookedIntervals;
	if (!bookedIntervals) {
		const startOfDay = new Date(targetDate);
		startOfDay.setUTCHours(0, 0, 0, 0);
		const endOfDay = new Date(targetDate);
		endOfDay.setUTCHours(23, 59, 59, 999);
		const map = await loadBookedIntervals([expertObjId], startOfDay, endOfDay);
		bookedIntervals = map.get(String(expertObjId)) ?? [];
	}

	// rawDateStr is already the requested calendar day; compare it against what
	// day it currently is *at the branch*, not on the server.
	const isToday = todayStr === rawDateStr;
	const currentMinuteOfDay = minutesIntoDayInZone(now, timeZone);

	return generateSlots(
		schedule,
		windows,
		bookedIntervals,
		isToday,
		currentMinuteOfDay,
	);
};

/**
 * Everyone who can hold a booking of this type.
 *
 * Trainers are their own collection. Every other expert type is a `User`
 * carrying `staffRole` — the only persisted marker of who is a nutritionist or
 * sports scientist, since the JWT role alone leaves nothing to query.
 */
export const resolveExpertsOfType = async (
	expertType: ExpertType,
): Promise<ExpertDirectoryEntry[]> => {
	if (expertType === ExpertType.Trainer) {
		const trainers = await Trainer.find({ isActive: { $ne: false } })
			.select("trainerName")
			.lean();
		return trainers.map((t) => ({
			id: String(t._id),
			name: t.trainerName || "Coach",
			expertType,
			expertModel: "Trainer" as const,
		}));
	}

	const staff = await User.find({
		staffRole: expertType,
		isActive: { $ne: false },
	})
		.select("username")
		.lean();

	return staff.map((u) => ({
		id: String(u._id),
		name: u.username || "Expert",
		expertType,
		expertModel: "User" as const,
	}));
};

export interface PooledAvailabilityResult {
	slots: PooledSlotDto[];
	experts: ExpertDirectoryEntry[];
	/** Smallest horizon across the pool — what the client's picker should clamp to. */
	maxAdvanceBookingDays: number;
	timeZone: string;
}

/**
 * Availability across every expert of a type, unioned by start time.
 *
 * With one nutritionist this degrades to exactly the per-expert result. With
 * five it just works, and each returned time carries the set of experts free
 * then, so booking can bind one at creation instead of assigning after the
 * fact.
 */
export const calculatePooledAvailability = async (params: {
	expertType: ExpertType;
	date: string | Date;
	mode?: AppointmentMode | string | null;
	timeZone?: string;
}): Promise<PooledAvailabilityResult> => {
	const { expertType, date } = params;
	const { rawDateStr, targetDate } = resolveTargetDate(date);

	// Directory first: with nobody of this type registered there is nothing to
	// compute, and the booking path calls this on every create.
	const directory = await resolveExpertsOfType(expertType);
	const timeZone =
		params.timeZone || (await resolveBookingTimeContext(null)).timezone;
	if (directory.length === 0) {
		return { slots: [], experts: [], maxAdvanceBookingDays: 60, timeZone };
	}

	const expertObjIds = directory.map((e) => new mongoose.Types.ObjectId(e.id));

	// One schedule query for the whole pool. An expert with no schedule row yet
	// is simply not bookable — pooled availability must never create documents
	// as a side effect of a read.
	const schedules = await ExpertSchedule.find({
		expertId: { $in: expertObjIds },
	});
	const scheduleByExpert = new Map(
		schedules.map((s) => [String(s.expertId), s]),
	);

	const requestedMode = normalizeAppointmentMode(params.mode);

	const eligible = directory.filter((entry) => {
		const schedule = scheduleByExpert.get(entry.id);
		if (!schedule || !schedule.isActive) return false;
		if (!requestedMode) return true;
		return normalizeSupportedModes(schedule.supportedModes).includes(
			requestedMode,
		);
	});

	if (eligible.length === 0) {
		return {
			slots: [],
			experts: [],
			maxAdvanceBookingDays: Math.min(
				...schedules.map((s) => s.maxAdvanceBookingDays || 60),
				60,
			),
			timeZone,
		};
	}

	const maxAdvanceBookingDays = Math.max(
		...eligible.map(
			(e) => scheduleByExpert.get(e.id)?.maxAdvanceBookingDays || 60,
		),
	);

	const startOfDay = new Date(targetDate);
	startOfDay.setUTCHours(0, 0, 0, 0);
	const endOfDay = new Date(targetDate);
	endOfDay.setUTCHours(23, 59, 59, 999);
	const bookedByExpert = await loadBookedIntervals(
		eligible.map((e) => new mongoose.Types.ObjectId(e.id)),
		startOfDay,
		endOfDay,
	);

	const now = new Date();
	const todayStr = formatDateInZone(now, timeZone);
	const isToday = todayStr === rawDateStr;
	const currentMinuteOfDay = minutesIntoDayInZone(now, timeZone);
	const offset = daysAhead(rawDateStr, todayStr);

	const unioned = new Map<string, PooledSlotDto>();

	for (const entry of eligible) {
		const schedule = scheduleByExpert.get(entry.id);
		if (!schedule) continue;
		if (offset < 0 || offset > (schedule.maxAdvanceBookingDays || 60)) continue;

		const windows = resolveDayWindows(schedule, targetDate);
		if (windows.length === 0) continue;

		const slots = generateSlots(
			schedule,
			windows,
			bookedByExpert.get(entry.id) ?? [],
			isToday,
			currentMinuteOfDay,
		);

		for (const slot of slots) {
			const existing = unioned.get(slot.startTime);
			if (existing) {
				existing.expertIds.push(entry.id);
				// Keep the longest end time so the member is never shown a window
				// shorter than what the chosen expert will actually give them.
				if (
					parseTimeToMinutes(slot.endTime) >
					parseTimeToMinutes(existing.endTime)
				) {
					existing.endTime = slot.endTime;
					existing.durationMinutes = slot.durationMinutes;
				}
			} else {
				unioned.set(slot.startTime, { ...slot, expertIds: [entry.id] });
			}
		}
	}

	const slots = Array.from(unioned.values()).sort(
		(a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime),
	);

	return { slots, experts: eligible, maxAdvanceBookingDays, timeZone };
};

export interface ExpertAssignment {
	expertId: mongoose.Types.ObjectId;
	expertName: string;
	expertModel: "Trainer" | "User";
	startTime: string;
	endTime: string;
	durationMinutes: number;
}

/**
 * Bind an expert to a time at creation.
 *
 * Assignment used to be a post-hoc admin step, which is why one nutritionist
 * could be handed two overlapping bookings. Picking from the free set here —
 * fewest bookings that day, tie-broken by id so the choice is deterministic —
 * makes double-booking structurally impossible: the losing candidates were
 * never free, and `UnifiedBooking`'s partial unique index on
 * `{expertId, bookingDate, startTime}` catches the concurrent case.
 *
 * Returns null when nobody of that type is free at that time.
 */
export const pickExpertForSlot = async (params: {
	expertType: ExpertType;
	date: string | Date;
	startTime: string;
	mode?: AppointmentMode | string | null;
	timeZone?: string;
}): Promise<ExpertAssignment | null> => {
	const pooled = await calculatePooledAvailability({
		expertType: params.expertType,
		date: params.date,
		mode: params.mode,
		timeZone: params.timeZone,
	});

	const slot = pooled.slots.find((s) => s.startTime === params.startTime);
	if (!slot || slot.expertIds.length === 0) return null;

	const { targetDate } = resolveTargetDate(params.date);
	const startOfDay = new Date(targetDate);
	startOfDay.setUTCHours(0, 0, 0, 0);
	const endOfDay = new Date(targetDate);
	endOfDay.setUTCHours(23, 59, 59, 999);

	const candidateIds = slot.expertIds.map(
		(id) => new mongoose.Types.ObjectId(id),
	);
	const loadByExpert = await loadBookedIntervals(
		candidateIds,
		startOfDay,
		endOfDay,
	);

	const chosenId = slot.expertIds
		.slice()
		.sort((a, b) => {
			const loadA = loadByExpert.get(a)?.length ?? 0;
			const loadB = loadByExpert.get(b)?.length ?? 0;
			if (loadA !== loadB) return loadA - loadB;
			return a.localeCompare(b);
		})[0];

	const entry = pooled.experts.find((e) => e.id === chosenId);
	if (!entry) return null;

	return {
		expertId: new mongoose.Types.ObjectId(chosenId),
		expertName: entry.name,
		expertModel: entry.expertModel,
		startTime: slot.startTime,
		endTime: slot.endTime,
		durationMinutes: slot.durationMinutes,
	};
};
