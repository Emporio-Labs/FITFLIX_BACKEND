import mongoose from "mongoose";
import Location from "../models/Location";

/**
 * Location resolution.
 *
 * Every location-stamped write takes a locationId. While exactly one branch is
 * active the server resolves it, so no client has to send one and no UI has to
 * ask. The moment a second branch goes live, resolution becomes ambiguous and
 * callers are forced to be explicit — which is the point: the API is
 * multi-branch from day one, the UI catches up when it needs to.
 */

export type LocationErrorCode =
	| "LOCATION_REQUIRED"
	| "LOCATION_NOT_FOUND"
	| "LOCATION_INACTIVE"
	| "INVALID_LOCATION_ID";

export class LocationError extends Error {
	code: LocationErrorCode;

	constructor(code: LocationErrorCode, message: string) {
		super(message);
		this.name = "LocationError";
		this.code = code;
	}
}

export const mapLocationError = (
	error: LocationError,
): { status: number; message: string; code: string } => {
	switch (error.code) {
		case "LOCATION_NOT_FOUND":
			return { status: 404, message: error.message, code: error.code };
		case "LOCATION_REQUIRED":
		case "LOCATION_INACTIVE":
		case "INVALID_LOCATION_ID":
			return { status: 400, message: error.message, code: error.code };
		default:
			return { status: 400, message: error.message, code: "BAD_REQUEST" };
	}
};

/**
 * Resolve the location for an operation.
 *
 * - explicit id given  → validate it exists and is active, return it
 * - no id, one active  → return that one
 * - no id, many active → throw LOCATION_REQUIRED (caller must be explicit)
 * - no id, none active → throw LOCATION_NOT_FOUND (system not seeded)
 */
export const resolveLocationId = async (
	explicitId?: string | mongoose.Types.ObjectId | null,
): Promise<mongoose.Types.ObjectId> => {
	if (explicitId) {
		const raw = String(explicitId);
		if (!mongoose.Types.ObjectId.isValid(raw)) {
			throw new LocationError(
				"INVALID_LOCATION_ID",
				`"${raw}" is not a valid location id`,
			);
		}

		const location = await Location.findById(raw).select("_id isActive");
		if (!location) {
			throw new LocationError("LOCATION_NOT_FOUND", "Location not found");
		}
		if (location.isActive === false) {
			throw new LocationError(
				"LOCATION_INACTIVE",
				"That location is not currently active",
			);
		}

		return location._id;
	}

	// Cap at 2 — we only need to know "exactly one" vs "more than one".
	const activeLocations = await Location.find({ isActive: true })
		.select("_id")
		.limit(2);

	const soleLocation = activeLocations[0];
	if (activeLocations.length === 1 && soleLocation) {
		return soleLocation._id;
	}

	if (activeLocations.length === 0) {
		throw new LocationError(
			"LOCATION_NOT_FOUND",
			"No active location is configured. Seed at least one branch.",
		);
	}

	throw new LocationError(
		"LOCATION_REQUIRED",
		"Multiple active locations exist — locationId is required for this operation",
	);
};

/**
 * Read-side counterpart. Returns a Mongo filter fragment that scopes a query to
 * a branch, or `{}` when no scoping is requested. Unlike resolveLocationId this
 * never throws on ambiguity: an admin listing across all branches is valid.
 */
export const buildLocationFilter = (
	explicitId?: string | null,
	field = "locationId",
): Record<string, unknown> => {
	if (!explicitId) {
		return {};
	}

	if (!mongoose.Types.ObjectId.isValid(explicitId)) {
		throw new LocationError(
			"INVALID_LOCATION_ID",
			`"${explicitId}" is not a valid location id`,
		);
	}

	return { [field]: new mongoose.Types.ObjectId(explicitId) };
};

/** Full location document, for settings-driven behaviour (tax, windows, caps). */
export const getLocationOrThrow = async (
	locationId: string | mongoose.Types.ObjectId,
) => {
	const location = await Location.findById(locationId);
	if (!location) {
		throw new LocationError("LOCATION_NOT_FOUND", "Location not found");
	}
	return location;
};

/**
 * Timezone and booking-policy settings for a branch, degrading to safe
 * defaults rather than throwing.
 *
 * Used on paths that must not fail just because a record predates locations or
 * the system isn't seeded yet — cancelling a booking should never 500 because
 * no branch is configured.
 */
export const resolveBookingTimeContext = async (
	locationId?: string | mongoose.Types.ObjectId | null,
): Promise<{ timezone: string; cancellationWindowHours: number }> => {
	const fallback = { timezone: "Asia/Kolkata", cancellationWindowHours: 24 };

	try {
		const resolvedId = await resolveLocationId(locationId ?? undefined);
		const location = await Location.findById(resolvedId).select(
			"timezone settings.cancellationWindowHours",
		);

		if (!location) {
			return fallback;
		}

		return {
			timezone: location.timezone || fallback.timezone,
			cancellationWindowHours: Number(
				location.settings?.cancellationWindowHours ??
					fallback.cancellationWindowHours,
			),
		};
	} catch {
		return fallback;
	}
};

/**
 * Settings for the branch that governs a member's experience, falling back to
 * the resolved default branch when the member has no home club yet.
 */
export const getLocationSettings = async (
	locationId?: string | mongoose.Types.ObjectId | null,
) => {
	const resolvedId = await resolveLocationId(locationId ?? undefined);
	const location = await getLocationOrThrow(resolvedId);
	return { locationId: resolvedId, location, settings: location.settings };
};
