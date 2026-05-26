// ─── Cal ID API request/response DTOs ────────────────────────────────────────
// Cal ID API base: https://api.cal.id
// Auth: Authorization: Bearer calid_*

// ─── Slot derivation (computed locally; Cal ID has no /slots endpoint) ────────

export interface CalIdEventType {
	id: number;
	slug?: string;
	title?: string;
	length: number; // minutes per booking
	slotInterval?: number | null; // minutes between candidate starts; defaults to length
	minimumBookingNotice?: number; // minutes ahead required
	scheduleId?: number | null;
	timeZone?: string | null;
	hidden?: boolean;
}

export interface CalIdEventTypeResponse {
	status?: "success" | "error";
	data?: CalIdEventType;
}

export interface CalIdScheduleAvailability {
	days: number[]; // 0 = Sunday … 6 = Saturday
	startTime: string; // "HH:mm" in schedule's timezone
	endTime: string; // "HH:mm"
	date?: string | null; // YYYY-MM-DD if it's a date override
}

export interface CalIdSchedule {
	id: number;
	name?: string;
	timeZone: string;
	availability: CalIdScheduleAvailability[];
}

export interface CalIdScheduleListResponse {
	status?: "success" | "error";
	data?: CalIdSchedule[] | CalIdSchedule;
}

export interface CalIdScheduleResponse {
	status?: "success" | "error";
	data?: CalIdSchedule;
}

// ─── Booking ──────────────────────────────────────────────────────────────────

export interface CalIdCreateBookingParams {
	eventTypeId: number;
	start: string; // ISO 8601
	end: string; // ISO 8601
	responses: {
		name: string;
		email: string;
		[key: string]: unknown;
	};
	attendee: {
		name: string;
		email: string;
		timeZone: string;
		language?: string;
	};
	metadata?: Record<string, string>;
}

export interface CalIdBookingData {
	id: number;
	uid: string;
	title: string;
	status: string; // "ACCEPTED" | "PENDING" | "CANCELLED" | "REJECTED"
	start?: string;
	end?: string;
	startTime?: string;
	endTime?: string;
	eventTypeId: number;
	meetingUrl?: string;
	location?: string;
	attendees?: Array<{
		name: string;
		email: string;
		timeZone: string;
	}>;
	hosts?: Array<{
		id: number;
		name: string;
		email: string;
		username?: string;
		timeZone?: string;
	}>;
	eventType?: { id: number; slug: string };
	metadata?: Record<string, unknown>;
}

export interface CalIdBookingResponse {
	status?: "success" | "error";
	data: CalIdBookingData;
}

export interface CalIdBookingListResponse {
	status?: "success" | "error";
	data?: CalIdBookingData[];
}

export interface CalIdListBookingsQuery {
	eventTypeId?: string | number;
	afterStart?: string; // ISO 8601
	beforeEnd?: string; // ISO 8601
	status?: string;
}

// ─── Reschedule / cancel ──────────────────────────────────────────────────────

export interface CalIdRescheduleParams {
	start: string; // ISO 8601
	rescheduledBy?: string;
	reschedulingReason?: string;
	seatUid?: string;
}

export interface CalIdCancelParams {
	cancellationReason?: string;
}

// ─── Webhook payloads ─────────────────────────────────────────────────────────

export type CalIdWebhookTrigger =
	| "BOOKING_CREATED"
	| "BOOKING_CONFIRMED"
	| "BOOKING_RESCHEDULED"
	| "BOOKING_CANCELLED"
	| "BOOKING_REJECTED";

export interface CalIdWebhookPayload {
	triggerEvent: CalIdWebhookTrigger;
	uid?: string; // unique per delivery (idempotency key)
	createdAt: string;
	payload: {
		uid: string; // booking UID
		id: number;
		status: string;
		title: string;
		startTime: string;
		endTime: string;
		eventTypeId: number;
		meetingUrl?: string;
		location?: string;
		attendees?: Array<{
			name: string;
			email: string;
			timeZone: string;
		}>;
		cancellationReason?: string;
		reschedulingReason?: string;
		metadata?: Record<string, unknown>;
	};
}

// ─── Normalized slot (internal representation) ────────────────────────────────

export interface NormalizedSlot {
	start: string; // ISO 8601
	end: string; // ISO 8601
}

export interface SlotsByDay {
	date: string; // YYYY-MM-DD
	slots: NormalizedSlot[];
}

// ─── Error types ──────────────────────────────────────────────────────────────

export class CalIdError extends Error {
	public readonly statusCode: number;
	public readonly body: unknown;

	constructor(message: string, statusCode: number, body?: unknown) {
		super(message);
		this.name = "CalIdError";
		this.statusCode = statusCode;
		this.body = body;
	}
}

export class CalIdTimeoutError extends Error {
	constructor() {
		super("Cal ID API request timed out");
		this.name = "CalIdTimeoutError";
	}
}

export class CalIdSlotUnavailableError extends Error {
	constructor() {
		super("The requested time slot is no longer available");
		this.name = "CalIdSlotUnavailableError";
	}
}
