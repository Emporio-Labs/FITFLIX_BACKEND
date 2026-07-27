import ClassModel from "../models/Class";
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

	if (
		(rawStatus && rawStatus !== "ACTIVE" && rawStatus !== "Active") ||
		isActive === false
	) {
		return {
			allowed: false,
			statusCode: 403,
			message: "Member account is inactive or suspended",
		};
	}

	const membershipStatus = (user as any).membershipStatus;
	if (membershipStatus === "EXPIRED" || membershipStatus === "CANCELLED") {
		return {
			allowed: false,
			statusCode: 403,
			message: "Active membership tier required for class bookings",
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

	// 3. Dynamic Booking Window Evaluation based on Class Configuration
	const windowValue = targetClass.bookingWindowValue || 72;
	const windowUnit = targetClass.bookingWindowUnit || "hours";
	const windowMs = calculateWindowMs(windowValue, windowUnit);

	// Construct Session Start Time
	const [hours, minutes] = String(startTime).split(":").map(Number);
	const startDateTime = new Date(sessionDate);
	startDateTime.setHours(hours, minutes, 0, 0);

	const windowOpenTime = new Date(startDateTime.getTime() - windowMs);

	if (now.getTime() < windowOpenTime.getTime()) {
		return {
			allowed: false,
			statusCode: 403,
			message: `Booking window opens ${windowValue} ${windowUnit} prior to class start time`,
			details: { windowOpenTime, windowValue, windowUnit },
		};
	}

	if (now.getTime() > startDateTime.getTime()) {
		return {
			allowed: false,
			statusCode: 403,
			message: "Booking window closed as class has already started",
			details: { startDateTime },
		};
	}

	return { allowed: true };
}
