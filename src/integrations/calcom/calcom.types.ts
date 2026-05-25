// ─── Cal.com API v2 request/response DTOs ────────────────────────────────────

export interface CalcomSlotAvailabilityParams {
	eventTypeId: string;
	startTime: string; // ISO 8601
	endTime: string; // ISO 8601
	timeZone: string;
}

export interface CalcomRawSlot {
	time: string; // ISO 8601 start time of the slot
}

export interface CalcomAvailabilityResponse {
	status: "success" | "error";
	data: {
		slots: Record<string, CalcomRawSlot[]>; // keyed by "YYYY-MM-DD"
	};
}

// ─── Booking ──────────────────────────────────────────────────────────────────

export interface CalcomCreateBookingParams {
	eventTypeId: string;
	start: string; // ISO 8601
	attendee: {
		name: string;
		email: string;
		timeZone: string;
	};
	metadata?: Record<string, string>;
	language?: string;
}

export interface CalcomBookingData {
	id: number;
	uid: string;
	title: string;
	status: string; // "ACCEPTED" | "PENDING" | "CANCELLED" | "REJECTED"
	start: string;
	end: string;
	eventTypeId: number;
	meetingUrl?: string;
	location?: string;
	attendees?: Array<{
		name: string;
		email: string;
		timeZone: string;
	}>;
	metadata?: Record<string, unknown>;
}

export interface CalcomBookingResponse {
	status: "success" | "error";
	data: CalcomBookingData;
}

// ─── Reschedule ───────────────────────────────────────────────────────────────

export interface CalcomRescheduleParams {
	start: string; // ISO 8601
	rescheduledReason?: string;
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

export interface CalcomCancelParams {
	cancellationReason?: string;
}

// ─── Webhook payloads ─────────────────────────────────────────────────────────

export type CalcomWebhookTrigger =
	| "BOOKING_CREATED"
	| "BOOKING_CONFIRMED"
	| "BOOKING_RESCHEDULED"
	| "BOOKING_CANCELLED"
	| "BOOKING_REJECTED";

export interface CalcomWebhookPayload {
	triggerEvent: CalcomWebhookTrigger;
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
	start: string; // ISO 8601 in requested timezone
	end: string; // ISO 8601 in requested timezone
}

export interface SlotsByDay {
	date: string; // YYYY-MM-DD
	slots: NormalizedSlot[];
}

// ─── Error types ──────────────────────────────────────────────────────────────

export class CalcomError extends Error {
	public readonly statusCode: number;
	public readonly body: unknown;

	constructor(message: string, statusCode: number, body?: unknown) {
		super(message);
		this.name = "CalcomError";
		this.statusCode = statusCode;
		this.body = body;
	}
}

export class CalcomTimeoutError extends Error {
	constructor() {
		super("Cal.com API request timed out");
		this.name = "CalcomTimeoutError";
	}
}

export class CalcomSlotUnavailableError extends Error {
	constructor() {
		super("The requested time slot is no longer available");
		this.name = "CalcomSlotUnavailableError";
	}
}
