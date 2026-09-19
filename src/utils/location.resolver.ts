import mongoose from "mongoose";
import Location from "../models/Location";
import User from "../models/User";
import type { AuthenticatedUser } from "../types/auth";
import { IST_TIMEZONE, normalizeTimeZone } from "./timezone.util";

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

/**
 * Admin branch scope.
 *
 * `isGlobal` is HQ — no confinement. Otherwise the admin is confined to the
 * branches on their token. A token with neither claim is a member token or a
 * pre-migration admin token: those are treated as unscoped so the change is
 * non-breaking until admins are actually assigned branches.
 */
export const getAdminLocationScope = (
	user: Pick<AuthenticatedUser, "locationIds" | "isGlobal"> | undefined,
): mongoose.Types.ObjectId[] | null => {
	if (!user || user.isGlobal === true) {
		return null;
	}

	const ids = user.locationIds;
	if (!Array.isArray(ids)) {
		return null;
	}

	return ids
		.filter((id) => mongoose.Types.ObjectId.isValid(id))
		.map((id) => new mongoose.Types.ObjectId(id));
};

/**
 * Write-side guard. Throws when a branch-scoped admin tries to touch a branch
 * they don't manage. A global admin, or an unscoped token, is a no-op.
 */
export const assertAdminCanAccessLocation = (
	user: Pick<AuthenticatedUser, "locationIds" | "isGlobal"> | undefined,
	locationId: string | mongoose.Types.ObjectId | null | undefined,
): void => {
	const scope = getAdminLocationScope(user);
	if (scope === null) {
		return;
	}

	// Fail closed: an admin with an empty branch list manages nothing.
	if (scope.length === 0) {
		throw new LocationError(
			"LOCATION_REQUIRED",
			"Your account is not assigned to any branch",
		);
	}

	// A null locationId is company-wide data, which a branch admin may not write.
	if (!locationId) {
		throw new LocationError(
			"LOCATION_REQUIRED",
			"locationId is required — your account is limited to specific branches",
		);
	}

	const target = String(locationId);
	if (!scope.some((id) => id.toString() === target)) {
		throw new LocationError(
			"LOCATION_REQUIRED",
			"That branch is outside your account's scope",
		);
	}
};

/**
 * Read-side counterpart to [assertAdminCanAccessLocation]. Intersects the
 * caller's requested branch with the branches they manage, so a branch admin
 * listing without a `locationId` query param still sees only their own.
 *
 * `includeNull` is for catalog collections where `locationId: null` means
 * "available at every branch" — those rows ride along with a branch filter.
 */
export const buildScopedLocationFilter = (
	user: Pick<AuthenticatedUser, "locationIds" | "isGlobal"> | undefined,
	explicitId?: string | null,
	options: { includeNull?: boolean; field?: string } = {},
): Record<string, unknown> => {
	const { includeNull = false, field = "locationId" } = options;
	const scope = getAdminLocationScope(user);

	if (explicitId && !mongoose.Types.ObjectId.isValid(explicitId)) {
		throw new LocationError(
			"INVALID_LOCATION_ID",
			`"${explicitId}" is not a valid location id`,
		);
	}

	let ids: mongoose.Types.ObjectId[] | null = null;

	if (explicitId) {
		const requested = new mongoose.Types.ObjectId(explicitId);
		if (scope !== null && !scope.some((id) => id.equals(requested))) {
			throw new LocationError(
				"LOCATION_REQUIRED",
				"That branch is outside your account's scope",
			);
		}
		ids = [requested];
	} else if (scope !== null) {
		ids = scope;
	}

	if (ids === null) {
		return {};
	}

	const values: (mongoose.Types.ObjectId | null)[] = [...ids];
	if (includeNull) {
		values.push(null);
	}

	return { [field]: { $in: values } };
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
	const fallback = { timezone: IST_TIMEZONE, cancellationWindowHours: 24 };

	try {
		const resolvedId = await resolveLocationId(locationId ?? undefined);
		const location = await Location.findById(resolvedId).select(
			"timezone settings.cancellationWindowHours",
		);

		if (!location) {
			return fallback;
		}

		return {
			// Normalised, not trusted: a branch row edited by hand can hold
			// anything, and an unusable zone reaches Intl as a RangeError on
			// whichever request happens to touch that branch next.
			timezone: normalizeTimeZone(location.timezone, fallback.timezone),
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

/* -------------------------------------------------------------------------
 * Timezone resolution
 *
 * A branch's zone decides what the "HH:mm" on its sessions actually means.
 * Every read of that answer goes through here so the join gate, the room
 * lifecycle job and the schedule listings can never disagree about when a
 * class starts — which is the disagreement that refused a host their own
 * class for a whole evening.
 * ---------------------------------------------------------------------- */

/// Short enough that an admin editing a branch's zone sees it take effect
/// within one class, long enough that the video-token path — which the
/// frontdesk retries on NOT_OPEN_YET — does not add a lookup per attempt.
const TIMEZONE_CACHE_TTL_MS = 5 * 60_000;

/// `null` is a cached *answer* ("this id has no usable zone"), distinct from a
/// cache miss, so an unknown branch does not re-query on every token mint.
const timeZoneCache = new Map<
	string,
	{ value: string | null; expiresAt: number }
>();

const cacheRead = (key: string): string | null | undefined => {
	const hit = timeZoneCache.get(key);
	if (!hit) return undefined;
	if (hit.expiresAt <= Date.now()) {
		timeZoneCache.delete(key);
		return undefined;
	}
	return hit.value;
};

const cacheWrite = (key: string, value: string | null): string | null => {
	timeZoneCache.set(key, {
		value,
		expiresAt: Date.now() + TIMEZONE_CACHE_TTL_MS,
	});
	return value;
};

/** Drops the cache. For tests, and for an admin changing a branch's zone. */
export const clearTimeZoneCache = (): void => {
	timeZoneCache.clear();
};

const readLocationTimeZone = async (
	locationId: string | mongoose.Types.ObjectId,
): Promise<string | null> => {
	const raw = String(locationId);
	if (!mongoose.Types.ObjectId.isValid(raw)) return null;

	const cached = cacheRead(`loc:${raw}`);
	if (cached !== undefined) return cached;

	const location = await Location.findById(raw).select("timezone").lean();
	return cacheWrite(
		`loc:${raw}`,
		location?.timezone ? normalizeTimeZone(location.timezone) : null,
	);
};

const readHomeLocationId = async (
	userId: string | mongoose.Types.ObjectId,
): Promise<string | null> => {
	const raw = String(userId);
	if (!mongoose.Types.ObjectId.isValid(raw)) return null;

	const cached = cacheRead(`user:${raw}`);
	if (cached !== undefined) return cached;

	const user = await User.findById(raw).select("homeLocationId").lean();
	return cacheWrite(
		`user:${raw}`,
		user?.homeLocationId ? String(user.homeLocationId) : null,
	);
};

/**
 * The timezone a wall-clock time should be read in.
 *
 * Order: the branch that owns the thing being scheduled, then the member's
 * home club, then IST. Never throws — a missing, inactive or unseeded branch
 * degrades to IST, matching resolveBookingTimeContext. A join gate that threw
 * because a class predates locations would be a worse failure than one that
 * assumed the company's home zone.
 */
export const resolveTimeZone = async ({
	locationId,
	userId,
}: {
	locationId?: string | mongoose.Types.ObjectId | null;
	userId?: string | mongoose.Types.ObjectId | null;
} = {}): Promise<string> => {
	try {
		if (locationId) {
			const branchZone = await readLocationTimeZone(locationId);
			if (branchZone) return branchZone;
		}

		if (userId) {
			const homeLocationId = await readHomeLocationId(userId);
			if (homeLocationId) {
				const homeZone = await readLocationTimeZone(homeLocationId);
				if (homeZone) return homeZone;
			}
		}
	} catch (error) {
		console.warn("[timezone] branch lookup failed, using IST:", error);
	}

	return IST_TIMEZONE;
};
