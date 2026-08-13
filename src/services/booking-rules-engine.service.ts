import ClassModel from "../models/Class";
import { UserStatus } from "../models/Enums";
import ScheduledSession from "../models/ScheduledSession";
import User from "../models/User";

export interface BookingRuleEvaluationResult {
	allowed: boolean;
	statusCode?: 400 | 403 | 404;
	message?: string;
	details?: any;
}

export function calculateWindowMs(
	value: number,
	unit: "hours" | "days" | string,
): number {
	if (unit === "days") {
		return value * 24 * 60 * 60 * 1000;
	}
	return value * 60 * 60 * 1000;
}

export interface LocalDateParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
}

export function getLocalDateParts(timezone: string, date: Date): LocalDateParts {
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	});

	const parts = formatter.formatToParts(date);
	const getVal = (type: string) => parts.find((p) => p.type === type)?.value || "";

	return {
		year: Number(getVal("year")),
		month: Number(getVal("month")),
		day: Number(getVal("day")),
		hour: Number(getVal("hour")),
		minute: Number(getVal("minute")),
	};
}

export function parseInTimezone(date: Date, timeStr: string, timezone: string): Date {
	const localDateParts = getLocalDateParts(timezone, date);
	const [hours, minutes] = String(timeStr).split(":").map(Number);

	const utcDate = new Date(
		Date.UTC(
			localDateParts.year,
			localDateParts.month - 1,
			localDateParts.day,
			hours,
			minutes,
			0,
			0,
		),
	);

	const partsInTz = getLocalDateParts(timezone, utcDate);
	const dateInTz = new Date(
		Date.UTC(
			partsInTz.year,
			partsInTz.month - 1,
			partsInTz.day,
			partsInTz.hour,
			partsInTz.minute,
			0,
			0,
		),
	);

	const offsetMs = dateInTz.getTime() - utcDate.getTime();
	return new Date(utcDate.getTime() - offsetMs);
}

export async function evaluateBookingRules(params: {
	userId: string;
	classId?: string;
	sessionId?: string;
	sessionDate?: Date | string;
	startTime?: string;
	now?: Date;
}): Promise<BookingRuleEvaluationResult> {
	const now = params.now || new Date();

	// 1. Account Status & Membership Verification
	const user = await User.findById(params.userId).lean();
	if (!user) {
		return {
			allowed: false,
			statusCode: 404,
			message: "Member account not found",
		};
	}

	const rawStatus = (user as any).status || (user as any).accountStatus;
	const isActive = (user as any).isActive;

	// `User.status` is the community suspend/ban gate (UserStatus enum,
	// lowercase values — "active"/"suspended"/"banned"), not a membership
	// field. Older code paths wrote uppercase "ACTIVE"/"Active" before the
	// User model adopted the enum; both forms are accepted here so neither a
	// freshly-created account nor a pre-existing document is wrongly blocked.
	const normalizedStatus =
		typeof rawStatus === "string" ? rawStatus.toLowerCase() : rawStatus;

	if (
		(normalizedStatus && normalizedStatus !== UserStatus.Active) ||
		isActive === false
	) {
		return {
			allowed: false,
			statusCode: 403,
			message: "Member account is inactive or suspended",
		};
	}

	// 2. Resolve Class and Session Details
	let targetClassId = params.classId;
	let sessionDate = params.sessionDate;
	let startTime = params.startTime;

	if (params.sessionId) {
		const session = await ScheduledSession.findById(params.sessionId).lean();
		if (!session) {
			return {
				allowed: false,
				statusCode: 404,
				message: "Scheduled session not found",
			};
		}
		targetClassId = targetClassId || session.classId.toString();
		sessionDate = sessionDate || session.sessionDate;
		startTime = startTime || session.startTime;
	}

	if (!targetClassId || !sessionDate || !startTime) {
		return {
			allowed: false,
			statusCode: 400,
			message: "Class and Session timing details are required",
		};
	}

	const targetClass = await ClassModel.findById(targetClassId).lean();
	if (!targetClass) {
		return { allowed: false, statusCode: 404, message: "Class not found" };
	}

	const isOpenToAll = (targetClass as any)?.access === "open_to_all";
	const membershipStatus = (user as any).membershipStatus;
	if (!isOpenToAll && (membershipStatus === "EXPIRED" || membershipStatus === "CANCELLED")) {
		return {
			allowed: false,
			statusCode: 403,
			message: "Active membership tier required for class bookings",
		};
	}

	// 3. Dynamic Booking Window Evaluation based on Class Configuration
	// `0` is a valid, intentional configuration (booking opens at session start
	// time) and must not be coerced to the 72h default — only an absent value
	// (undefined/null) should fall back.
	const windowValue = targetClass.bookingWindowValue ?? 72;
	const windowUnit = targetClass.bookingWindowUnit ?? "hours";
	const windowMs = calculateWindowMs(windowValue, windowUnit);

	// Construct Session Start Time (Timezone-Aware)
	const classTimezone = (targetClass as any).timezone || "Asia/Kolkata";
	const startDateTime = parseInTimezone(new Date(sessionDate), startTime, classTimezone);

	const windowOpenTime = new Date(startDateTime.getTime() - windowMs);

	if (now.getTime() < windowOpenTime.getTime()) {
		return {
			allowed: false,
			statusCode: 403,
			message: `Booking window opens ${windowValue} ${windowUnit} prior to class start time`,
			details: { windowOpenTime, windowValue, windowUnit },
		};
	}

	const closeValue = (targetClass as any).bookingCloseValue !== undefined && (targetClass as any).bookingCloseValue !== null
		? Number((targetClass as any).bookingCloseValue)
		: null;
	const closeUnit = (targetClass as any).bookingCloseUnit || "minutes";

	if (closeValue !== null) {
		let closeMs = closeValue * 60 * 1000;
		if (closeUnit === "hours") {
			closeMs = closeValue * 60 * 60 * 1000;
		} else if (closeUnit === "days") {
			closeMs = closeValue * 24 * 60 * 60 * 1000;
		}

		const windowCloseTime = new Date(startDateTime.getTime() - closeMs);

		if (now.getTime() > windowCloseTime.getTime()) {
			return {
				allowed: false,
				statusCode: 403,
				message: `Booking window closed ${closeValue} ${closeUnit} before class start time`,
				details: { windowCloseTime, startDateTime },
			};
		}
	} else {
		// Fallback: only close booking if the class has already started
		if (now.getTime() > startDateTime.getTime()) {
			return {
				allowed: false,
				statusCode: 403,
				message: "Booking window closed as class has already started",
				details: { startDateTime },
			};
		}
	}

	return { allowed: true };
}
