import {
	CalIdError,
	CalIdSlotUnavailableError,
	CalIdTimeoutError,
	type CalIdBookingListResponse,
	type CalIdBookingResponse,
	type CalIdCancelParams,
	type CalIdCreateBookingParams,
	type CalIdEventTypeResponse,
	type CalIdListBookingsQuery,
	type CalIdRescheduleParams,
	type CalIdScheduleListResponse,
	type CalIdScheduleResponse,
} from "./calid.types";
import { withRetry } from "./calid.utils";

const TIMEOUT_MS = 10_000;

function getConfig(): { apiKey: string; baseUrl: string } {
	const apiKey = process.env.CALID_API_KEY;
	const baseUrl = process.env.CALID_BASE_URL ?? "https://api.cal.id";

	if (!apiKey) {
		throw new Error("CALID_API_KEY environment variable is not set");
	}

	return { apiKey, baseUrl: baseUrl.replace(/\/+$/, "") };
}

async function calFetch<T>(
	method: string,
	path: string,
	body?: unknown,
): Promise<T> {
	const { apiKey, baseUrl } = getConfig();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		const url = `${baseUrl}${path}`;
		const isRescheduleRequest = method === "PATCH" && path.endsWith("/reschedule");

		const b = body as Record<string, unknown> | undefined;
		const att = (b?.attendee ?? {}) as { email?: string };
		console.log(
			`[CALID REQ] method=${method} url=${url} path=${path} bodyKeys=${b ? Object.keys(b).join(",") : "-"} body.eventTypeId=${b?.eventTypeId} body.start=${b?.start} body.attendee.email=${att?.email}`,
		);
		if (isRescheduleRequest && b) {
			console.log(`[CALID RESCHEDULE REQ] url=${url} body=${JSON.stringify(b)}`);
		}

		const res = await fetch(url, {
			method,
			signal: controller.signal,
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		});

		const text = await res.text();
		if (isRescheduleRequest) {
			console.log(`[CALID RESCHEDULE RES] status=${res.status} url=${url} path=${path}`);
			console.log(`[CALID RESCHEDULE RES] headers=${JSON.stringify(Object.fromEntries(res.headers.entries()))}`);
			console.log(`[CALID RESCHEDULE RES] body=${text.length > 0 ? text : "<empty>"}`);
		}
		let json: unknown = {};
		if (text.length > 0) {
			try {
				json = JSON.parse(text) as unknown;
			} catch {
				json = { raw: text };
			}
		}

		try {
			const j = json as {
				data?: {
					id?: number;
					uid?: string;
					eventTypeId?: number;
					eventType?: { id?: number; slug?: string };
					hosts?: Array<{ email?: string; username?: string }>;
					attendees?: Array<{ email?: string }>;
					meetingUrl?: string;
				};
			};
			const d = j?.data;
			if (d && !Array.isArray(d)) {
				const hostsStr = d?.hosts
					? d.hosts.map((h) => `{email:${h.email},username:${h.username}}`).join(",")
					: "-";
				console.log(
					`[CALID RES] status=${res.status} data.id=${d?.id} data.uid=${d?.uid} data.eventTypeId=${d?.eventTypeId} data.eventType.id=${d?.eventType?.id} data.eventType.slug=${d?.eventType?.slug} data.hosts=[${hostsStr}] data.attendees[0].email=${d?.attendees?.[0]?.email} data.meetingUrl=${d?.meetingUrl}`,
				);
			} else {
				console.log(`[CALID RES] status=${res.status} (no data envelope)`);
			}
		} catch (_) {
			// ignore log shape errors
		}

		if (!res.ok) {
			if (res.status === 409) {
				throw new CalIdSlotUnavailableError();
			}
			const message =
				(json as { message?: string }).message ?? `Cal ID API error ${res.status}`;
			throw new CalIdError(message, res.status, json);
		}

		const responsePayload =
			json && typeof json === "object" && "data" in json
				? json
				: { status: "success", data: json };
		return responsePayload as unknown as T;
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") {
			throw new CalIdTimeoutError();
		}
		throw err;
	} finally {
		clearTimeout(timeout);
	}
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getEventType(
	eventTypeId: string | number,
): Promise<CalIdEventTypeResponse> {
	return withRetry(() =>
		calFetch<CalIdEventTypeResponse>("GET", `/event-types/${encodeURIComponent(String(eventTypeId))}`),
	);
}

export async function listSchedules(): Promise<CalIdScheduleListResponse> {
	return withRetry(() => calFetch<CalIdScheduleListResponse>("GET", "/schedule/"));
}

export async function getSchedule(
	scheduleId: string | number,
): Promise<CalIdScheduleResponse> {
	return withRetry(() =>
		calFetch<CalIdScheduleResponse>(
			"GET",
			`/schedule/${encodeURIComponent(String(scheduleId))}`,
		),
	);
}

export async function listBookings(
	query: CalIdListBookingsQuery = {},
): Promise<CalIdBookingListResponse> {
	const params = new URLSearchParams();
	if (query.eventTypeId !== undefined) {
		params.set("eventTypeId", String(query.eventTypeId));
	}
	if (query.afterStart) params.set("afterStart", query.afterStart);
	if (query.beforeEnd) params.set("beforeEnd", query.beforeEnd);
	if (query.status) params.set("status", query.status);

	const qs = params.toString();
	const path = qs.length > 0 ? `/booking/?${qs}` : "/booking/";
	return withRetry(() => calFetch<CalIdBookingListResponse>("GET", path));
}

export async function createBooking(
	params: CalIdCreateBookingParams,
): Promise<CalIdBookingResponse> {
	// No retry on create — not idempotent
	return calFetch<CalIdBookingResponse>("POST", "/booking/", params);
}

export async function getBooking(id: string): Promise<CalIdBookingResponse> {
	return withRetry(() =>
		calFetch<CalIdBookingResponse>("GET", `/booking/${encodeURIComponent(id)}`),
	);
}

export async function rescheduleBooking(
	id: string | number,
	params: CalIdRescheduleParams,
): Promise<CalIdBookingResponse> {
	return withRetry(() =>
		calFetch<CalIdBookingResponse>(
			"PATCH",
			`/booking/${encodeURIComponent(String(id))}/reschedule`,
			params,
		),
	);
}

export async function cancelBooking(
	id: string | number,
	params: CalIdCancelParams = {},
): Promise<void> {
	await withRetry(() =>
		calFetch<unknown>(
			"POST",
			`/booking/${encodeURIComponent(String(id))}/cancel`,
			params,
		),
	);
}
