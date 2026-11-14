import mongoose from "mongoose";
import Bookings from "../models/Bookings";
import NutritionistBooking from "../models/NutritionistBooking";
import UnifiedBooking from "../models/UnifiedBooking";
import WorkoutPlanAssignment from "../models/WorkoutPlanAssignment";
import {
	DEFAULT_TIMEZONE,
	IST_TIMEZONE,
	dayOfWeekInZone,
	formatDateInZone,
} from "../utils/timezone.util";

export type AgendaItemCategory =
	| "WORKOUT"
	| "CLASS"
	| "LIVE_STREAM"
	| "THERAPY"
	| "COACHING"
	| "NUTRITIONIST"
	| "CHECKIN";

export type AgendaItemStatus =
	| "SCHEDULED"
	| "LIVE_NOW"
	| "COMPLETED"
	| "MISSED"
	| "CANCELLED"
	| "REST_DAY";

export interface AgendaItem {
	id: string;
	sourceId: string;
	sourceCollection:
		| "WorkoutPlanAssignment"
		| "Booking"
		| "UnifiedBooking"
		| "NutritionistBooking"
		| "System";
	category: AgendaItemCategory;
	title: string;
	subtitle?: string;
	date: string; // "YYYY-MM-DD"
	startTime?: string; // "07:00"
	endTime?: string; // "07:45"
	timeLabel: string; // "07:00 AM - 07:45 AM" or "Anytime today"
	status: AgendaItemStatus;
	isOnline: boolean;
	location?: string;
	zegoRoomId?: string | null;
	canJoinNow: boolean;
	actionUrl?: string;
	metadata?: Record<string, unknown>;
}

export interface AgendaDay {
	date: string; // "YYYY-MM-DD"
	dayOfWeek: number; // 0 = Sun, 1 = Mon, ..., 6 = Sat
	dayName: string; // "Wednesday"
	dayInitial: string; // "W"
	isToday: boolean;
	isPast: boolean;
	hasEvents: boolean;
	dots: {
		workout: boolean;
		therapy: boolean;
		coaching: boolean;
		classSession: boolean;
		nutrition: boolean;
	};
	items: AgendaItem[];
}

export interface AgendaResult {
	selectedDate: string; // "YYYY-MM-DD"
	range: {
		from: string;
		to: string;
	};
	summary: {
		todayItemCount: number;
		weekItemCount: number;
	};
	days: AgendaDay[];
}

const DAY_NAMES = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];
const DAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

function formatTime12h(hhmm?: string): string {
	if (!hhmm || !hhmm.includes(":")) return "";
	const [hStr, mStr] = hhmm.split(":");
	let hour = parseInt(hStr || "0", 10);
	const min = mStr || "00";
	if (Number.isNaN(hour)) return hhmm;
	const period = hour >= 12 ? "PM" : "AM";
	if (hour > 12) hour -= 12;
	if (hour === 0) hour = 12;
	return `${hour.toString().padStart(2, "0")}:${min} ${period}`;
}

export async function getMemberAgenda(
	userId: string,
	fromInput?: string | Date,
	toInput?: string | Date,
	timeZone: string = DEFAULT_TIMEZONE,
): Promise<AgendaResult> {
	const userObjectId = new mongoose.Types.ObjectId(userId);
	const now = new Date();
	const todayStr = formatDateInZone(now, timeZone);

	// Default range: from Monday of current week to Sunday of current week + next 7 days
	let fromStr: string;
	let toStr: string;

	if (fromInput) {
		fromStr =
			fromInput instanceof Date
				? formatDateInZone(fromInput, timeZone)
				: (fromInput.split("T")[0] || todayStr);
	} else {
		// Start 3 days ago by default
		const past = new Date(now.getTime() - 3 * 86400000);
		fromStr = formatDateInZone(past, timeZone);
	}

	if (toInput) {
		toStr =
			toInput instanceof Date
				? formatDateInZone(toInput, timeZone)
				: (toInput.split("T")[0] || todayStr);
	} else {
		// End 10 days in the future
		const future = new Date(now.getTime() + 10 * 86400000);
		toStr = formatDateInZone(future, timeZone);
	}

	// Build array of dates in interval
	const dates: string[] = [];
	const startCursor = new Date(`${fromStr}T00:00:00.000Z`);
	const endCursor = new Date(`${toStr}T00:00:00.000Z`);

	let current = new Date(startCursor);
	while (current <= endCursor) {
		const isoStr = current.toISOString().split("T")[0];
		if (isoStr) dates.push(isoStr);
		current = new Date(current.getTime() + 86400000);
	}

	// Range filter for database queries
	const searchFrom = new Date(`${fromStr}T00:00:00.000Z`);
	const searchTo = new Date(`${toStr}T23:59:59.999Z`);

	// Concurrent aggregation across sources
	const [activePlanAssignment, bookings, unifiedBookings, nutritionistBookings] =
		await Promise.all([
			// 1. Workout Plan Assignment
			WorkoutPlanAssignment.findOne({
				userId: userObjectId,
				status: "active",
				isDeleted: { $ne: true },
			}).lean(),

			// 2. Service Bookings (Group Classes, Live Streams, Therapies)
			Bookings.find({
				user: userObjectId,
				bookingDate: { $gte: searchFrom, $lte: searchTo },
			})
				.populate("service", "serviceName serviceType creditCost")
				.populate("slot", "date startTime endTime")
				.populate(
					"sessionId",
					"sessionDate startTime endTime status deliveryType videoRoomId hostLiveAt",
				)
				.populate(
					"classId",
					"name description creditCost mode sessionType instructor locationAddress imageUrl",
				)
				.lean(),

			// 3. 1-on-1 Personal Training / Expert Sessions
			UnifiedBooking.find({
				userId: userObjectId,
				bookingDate: { $gte: searchFrom, $lte: searchTo },
			}).lean(),

			// 4. Nutritionist Consultations
			NutritionistBooking.find({
				userId: userObjectId,
				bookingDate: { $gte: searchFrom, $lte: searchTo },
			}).lean(),
		]);

	const allItems: AgendaItem[] = [];

	// ─── 1. Process Workouts ──────────────────────────────────────────────────
	if (activePlanAssignment && Array.isArray(activePlanAssignment.dayProgress)) {
		const userDaysMap = new Map<number, any>(
			(activePlanAssignment.userDays || []).map((ud: any) => [
				ud.dayNumber,
				ud,
			]),
		);

		for (const dp of activePlanAssignment.dayProgress) {
			const dpDateStr = formatDateInZone(new Date(dp.scheduledDate), timeZone);
			if (dpDateStr < fromStr || dpDateStr > toStr) continue;

			const userDay = userDaysMap.get(dp.dayNumber);
			const isRest = userDay?.isRestDay ?? false;
			const workoutName = userDay?.name || `Day ${dp.dayNumber}`;
			const exerciseCount = userDay?.exercises?.length || 0;

			let status: AgendaItemStatus = "SCHEDULED";
			if (isRest) {
				status = "REST_DAY";
			} else if (dp.status === "completed") {
				status = "COMPLETED";
			} else if (dp.status === "missed") {
				status = "MISSED";
			} else if (dpDateStr < todayStr && dp.status === "pending") {
				status = "MISSED";
			}

			allItems.push({
				id: `workout_${activePlanAssignment._id}_day_${dp.dayNumber}`,
				sourceId: activePlanAssignment._id.toString(),
				sourceCollection: "WorkoutPlanAssignment",
				category: "WORKOUT",
				title: isRest ? "Rest Day" : workoutName,
				subtitle: isRest
					? "Recovery & hydration"
					: `${exerciseCount} exercises • Prescribed routine`,
				date: dpDateStr,
				timeLabel: isRest ? "Full Day" : "Anytime today",
				status,
				isOnline: false,
				canJoinNow: false,
				actionUrl: isRest
					? undefined
					: `/exercise-tracking`,
				metadata: {
					dayNumber: dp.dayNumber,
					exerciseCount,
					isRestDay: isRest,
					sessionId: dp.sessionId ? dp.sessionId.toString() : null,
				},
			});
		}
	}

	// ─── 2. Process Bookings (Classes, Live Streams, Therapies) ────────────────
	for (const b of bookings) {
		const bDateStr = formatDateInZone(new Date(b.bookingDate), timeZone);
		const service = b.service as any;
		const classDoc = b.classId as any;
		const sessionDoc = b.sessionId as any;

		let category: AgendaItemCategory = "THERAPY";
		let title = "Session Booking";
		let subtitle: string | undefined;
		let isOnline = false;
		let location = "FitFlix Center";
		let zegoRoomId: string | null = null;

		const startTime = b.startTime || sessionDoc?.startTime || "00:00";
		const endTime = b.endTime || sessionDoc?.endTime || "";

		if (classDoc || sessionDoc) {
			const isLive =
				classDoc?.sessionType === "live_stream" ||
				sessionDoc?.deliveryType === "ONLINE" ||
				classDoc?.mode === "online";
			category = isLive ? "LIVE_STREAM" : "CLASS";
			title = classDoc?.name || "Group Class";
			subtitle = classDoc?.instructor
				? `Instructor: ${classDoc.instructor}`
				: undefined;
			isOnline = Boolean(isLive);
			location = isOnline
				? "Online Video Room"
				: classDoc?.locationAddress || "Main Studio";
			zegoRoomId = sessionDoc?.videoRoomId || null;
		} else if (service) {
			category =
				service.serviceType === "Therapy" ? "THERAPY" : "CLASS";
			title = service.serviceName || "Therapy Session";
			subtitle = `Duration: ${service.serviceTime || 45} mins`;
			location = "Therapy Suite";
		}

		let status: AgendaItemStatus = "SCHEDULED";
		const rawStatus = String(b.status || "").toLowerCase();
		if (rawStatus === "attended" || rawStatus === "consumed") {
			status = "COMPLETED";
		} else if (rawStatus === "cancelled") {
			status = "CANCELLED";
		} else if (rawStatus === "unattended" || (bDateStr < todayStr && rawStatus === "confirmed")) {
			status = "MISSED";
		}

		const timeFormatted = startTime && endTime
			? `${formatTime12h(startTime)} - ${formatTime12h(endTime)}`
			: formatTime12h(startTime);

		// Check if active now (within 10m before start to 45m after start on today)
		let canJoinNow = false;
		if (isOnline && bDateStr === todayStr && startTime) {
			const [h = 0, m = 0] = startTime.split(":").map(Number);
			const sessionMinute = h * 60 + m;
			const nowMinute = now.getHours() * 60 + now.getMinutes();
			if (nowMinute >= sessionMinute - 10 && nowMinute <= sessionMinute + 60) {
				canJoinNow = true;
				if (status === "SCHEDULED") status = "LIVE_NOW";
			}
		}

		allItems.push({
			id: `booking_${b._id}`,
			sourceId: b._id.toString(),
			sourceCollection: "Booking",
			category,
			title,
			subtitle,
			date: bDateStr,
			startTime,
			endTime,
			timeLabel: timeFormatted,
			status,
			isOnline,
			location,
			zegoRoomId,
			canJoinNow,
			actionUrl: isOnline && zegoRoomId
				? `/live-session/${zegoRoomId}`
				: `/session/${b._id}`,
			metadata: {
				bookingStatus: b.status,
				creditCost: b.creditCostSnapshot,
			},
		});
	}

	// ─── 3. Process 1-on-1 PT / Coaching (UnifiedBooking) ─────────────────────
	for (const ub of unifiedBookings) {
		const ubDateStr = formatDateInZone(new Date(ub.bookingDate), timeZone);
		const isOnline = ub.appointmentMode === "ONLINE";
		const expertName = ub.assignedExpertName || "Assigned Coach";

		let status: AgendaItemStatus = "SCHEDULED";
		const rawStatus = String(ub.status || "").toUpperCase();
		if (rawStatus === "COMPLETED") {
			status = "COMPLETED";
		} else if (rawStatus === "CANCELLED" || rawStatus === "REJECTED") {
			status = "CANCELLED";
		} else if (rawStatus === "HOST_NO_SHOW" || (ubDateStr < todayStr && rawStatus === "CONFIRMED")) {
			status = "MISSED";
		}

		const startTime = ub.startTime || "";
		const endTime = ub.endTime || "";
		const timeFormatted = startTime && endTime
			? `${formatTime12h(startTime)} - ${formatTime12h(endTime)}`
			: formatTime12h(startTime);

		let canJoinNow = false;
		if (isOnline && ubDateStr === todayStr && startTime) {
			const [h = 0, m = 0] = startTime.split(":").map(Number);
			const sessionMinute = h * 60 + m;
			const nowMinute = now.getHours() * 60 + now.getMinutes();
			if (nowMinute >= sessionMinute - 10 && nowMinute <= sessionMinute + 60) {
				canJoinNow = true;
				if (status === "SCHEDULED") status = "LIVE_NOW";
			}
		}

		allItems.push({
			id: `pt_${ub._id}`,
			sourceId: ub._id.toString(),
			sourceCollection: "UnifiedBooking",
			category: "COACHING",
			title: `1-on-1 with ${expertName}`,
			subtitle: isOnline ? "Online Video Coaching" : "In-Club Personal Training",
			date: ubDateStr,
			startTime,
			endTime,
			timeLabel: timeFormatted,
			status,
			isOnline,
			location: isOnline ? "Online Video Room" : ub.location || "Strength Floor",
			zegoRoomId: ub.zegoRoomId || null,
			canJoinNow,
			actionUrl: isOnline && ub.zegoRoomId
				? `/live-session/${ub.zegoRoomId}`
				: `/personal-training`,
			metadata: {
				expertName,
				mode: ub.appointmentMode,
			},
		});
	}

	// ─── 4. Process Nutritionist Consultations ────────────────────────────────
	for (const nb of nutritionistBookings) {
		const nbDateStr = formatDateInZone(new Date(nb.bookingDate), timeZone);
		const isOnline = nb.appointmentMode === "ONLINE";
		const nutName = nb.assignedNutritionistName || "Clinical Nutritionist";

		let status: AgendaItemStatus = "SCHEDULED";
		const rawStatus = String(nb.status || "").toUpperCase();
		if (rawStatus === "COMPLETED") {
			status = "COMPLETED";
		} else if (rawStatus === "CANCELLED" || rawStatus === "REJECTED") {
			status = "CANCELLED";
		} else if (nbDateStr < todayStr && rawStatus === "ACCEPTED") {
			status = "MISSED";
		}

		const startTime = nb.startTime || "";
		const endTime = nb.endTime || "";
		const timeFormatted = startTime && endTime
			? `${formatTime12h(startTime)} - ${formatTime12h(endTime)}`
			: formatTime12h(startTime);

		let canJoinNow = false;
		if (isOnline && nbDateStr === todayStr && startTime) {
			const [h = 0, m = 0] = startTime.split(":").map(Number);
			const sessionMinute = h * 60 + m;
			const nowMinute = now.getHours() * 60 + now.getMinutes();
			if (nowMinute >= sessionMinute - 10 && nowMinute <= sessionMinute + 60) {
				canJoinNow = true;
				if (status === "SCHEDULED") status = "LIVE_NOW";
			}
		}

		allItems.push({
			id: `nut_${nb._id}`,
			sourceId: nb._id.toString(),
			sourceCollection: "NutritionistBooking",
			category: "NUTRITIONIST",
			title: `Consultation: ${nutName}`,
			subtitle: isOnline ? "Online Clinical Consultation" : "Nutrition Clinic",
			date: nbDateStr,
			startTime,
			endTime,
			timeLabel: timeFormatted,
			status,
			isOnline,
			location: isOnline ? "Online Consultation" : nb.clinicLocation || "Consultation Room",
			zegoRoomId: nb.zegoRoomId || null,
			canJoinNow,
			actionUrl: isOnline && nb.zegoRoomId
				? `/live-session/${nb.zegoRoomId}`
				: `/nutrition`,
			metadata: {
				nutritionistName: nutName,
			},
		});
	}

	// ─── Group by Date into AgendaDay Array ──────────────────────────────────
	const itemsByDate = new Map<string, AgendaItem[]>();
	for (const item of allItems) {
		const list = itemsByDate.get(item.date) || [];
		list.push(item);
		itemsByDate.set(item.date, list);
	}

	let todayItemCount = 0;
	let weekItemCount = 0;

	const days: AgendaDay[] = dates.map((dateStr) => {
		const d = new Date(`${dateStr}T12:00:00.000Z`);
		const dow = dayOfWeekInZone(d, timeZone);
		const isToday = dateStr === todayStr;
		const isPast = dateStr < todayStr;
		const dayItems = itemsByDate.get(dateStr) || [];

		// Sort: items with startTime ascending, rest days/untimed workouts last
		dayItems.sort((a, b) => {
			if (a.startTime && b.startTime) {
				return a.startTime.localeCompare(b.startTime);
			}
			if (a.startTime && !b.startTime) return -1;
			if (!a.startTime && b.startTime) return 1;
			return 0;
		});

		const nonCancelledItems = dayItems.filter((i) => i.status !== "CANCELLED");
		if (isToday) todayItemCount = nonCancelledItems.length;
		weekItemCount += nonCancelledItems.length;

		const dots = {
			workout: dayItems.some((i) => i.category === "WORKOUT" && i.status !== "CANCELLED"),
			therapy: dayItems.some((i) => i.category === "THERAPY" && i.status !== "CANCELLED"),
			coaching: dayItems.some((i) => i.category === "COACHING" && i.status !== "CANCELLED"),
			classSession: dayItems.some(
				(i) => (i.category === "CLASS" || i.category === "LIVE_STREAM") && i.status !== "CANCELLED",
			),
			nutrition: dayItems.some((i) => i.category === "NUTRITIONIST" && i.status !== "CANCELLED"),
		};

		return {
			date: dateStr,
			dayOfWeek: dow,
			dayName: DAY_NAMES[dow] || "Day",
			dayInitial: DAY_INITIALS[dow] || "D",
			isToday,
			isPast,
			hasEvents: dayItems.length > 0,
			dots,
			items: dayItems,
		};
	});

	return {
		selectedDate: todayStr,
		range: {
			from: fromStr,
			to: toStr,
		},
		summary: {
			todayItemCount,
			weekItemCount,
		},
		days,
	};
}
