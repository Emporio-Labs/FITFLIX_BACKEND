import {
	CalcomError,
	CalcomSlotUnavailableError,
	CalcomTimeoutError,
	type CalcomAvailabilityResponse,
	type CalcomBookingResponse,
	type CalcomCancelParams,
	type CalcomCreateBookingParams,
	type CalcomRescheduleParams,
	type CalcomSlotAvailabilityParams,
} from "./calcom.types";
import { withRetry } from "./calcom.utils";

const TIMEOUT_MS = 10_000;
const CAL_API_VERSION = "2024-08-13";

function getConfig(): { apiKey: string; baseUrl: string } {
	const apiKey = process.env.CAL_API_KEY;
	const baseUrl = process.env.CAL_BASE_URL ?? "https://api.cal.com/v2";

	if (!apiKey) {
		throw new Error("CAL_API_KEY environment variable is not set");
	}

	return { apiKey, baseUrl };
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
		const res = await fetch(`${baseUrl}${path}`, {
			method,
			signal: controller.signal,
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				"cal-api-version": CAL_API_VERSION,
			},
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		});

		const json = (await res.json()) as T & { status?: string; message?: string };

		if (!res.ok) {
			// Cal.com returns 409 when a slot is taken
			if (res.status === 409) {
				throw new CalcomSlotUnavailableError();
			}
			throw new CalcomError(
				(json as { message?: string }).message ?? `Cal.com API error ${res.status}`,
				res.status,
				json,
			);
		}

		return json;
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") {
			throw new CalcomTimeoutError();
		}
		throw err;
	} finally {
		clearTimeout(timeout);
	}
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getSlots(
	params: CalcomSlotAvailabilityParams,
): Promise<CalcomAvailabilityResponse> {
	const qs = new URLSearchParams({
		eventTypeId: params.eventTypeId,
		startTime: params.startTime,
		endTime: params.endTime,
		timeZone: params.timeZone,
	}).toString();

	return withRetry(() =>
		calFetch<CalcomAvailabilityResponse>("GET", `/slots/available?${qs}`),
	);
}

export async function createBooking(
	params: CalcomCreateBookingParams,
): Promise<CalcomBookingResponse> {
	// No retry on create — not idempotent without a Cal.com idempotency header
	return calFetch<CalcomBookingResponse>("POST", "/bookings", params);
}

export async function getBooking(uid: string): Promise<CalcomBookingResponse> {
	return withRetry(() =>
		calFetch<CalcomBookingResponse>("GET", `/bookings/${uid}`),
	);
}

export async function rescheduleBooking(
	uid: string,
	params: CalcomRescheduleParams,
): Promise<CalcomBookingResponse> {
	return withRetry(() =>
		calFetch<CalcomBookingResponse>("PATCH", `/bookings/${uid}/reschedule`, params),
	);
}

export async function cancelBooking(
	uid: string,
	params: CalcomCancelParams = {},
): Promise<void> {
	await withRetry(() =>
		calFetch<unknown>("POST", `/bookings/${uid}/cancel`, params),
	);
}
