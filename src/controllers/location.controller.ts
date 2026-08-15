import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Location, { DEFAULT_LOCATION_SETTINGS } from "../models/Location";
import {
	createLocationSchema,
	locationSettingsSchema,
	updateLocationSchema,
} from "../validators/location.validator";
import { LocationError, mapLocationError } from "../utils/location.resolver";

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (typeof idParam !== "string" || !mongoose.Types.ObjectId.isValid(idParam)) {
		return null;
	}
	return idParam;
};

const handleError = (error: unknown, res: Parameters<RequestHandler>[1]) => {
	if (error instanceof LocationError) {
		const mapped = mapLocationError(error);
		res.status(mapped.status).json({
			message: mapped.message,
			code: mapped.code,
		});
		return true;
	}

	const err = error as any;
	if (err?.name === "MongoServerError" && err?.code === 11000) {
		res.status(409).json({
			message: "A location with that code already exists",
			code: "DUPLICATE_RESOURCE",
			details: err.keyValue ?? null,
		});
		return true;
	}

	return false;
};

export const getAllLocations: RequestHandler = async (req, res, next) => {
	try {
		// Members only ever see live branches; staff can ask for the full list.
		const includeInactive =
			String(req.query.includeInactive ?? "") === "true" &&
			(req.user?.role === "admin" || req.user?.role === "frontdesk");

		const filter = includeInactive ? {} : { isActive: true };
		const locations = await Location.find(filter).sort({ name: 1 });

		res.status(200).json({ locations, count: locations.length });
	} catch (error) {
		next(error);
	}
};

export const getLocationById: RequestHandler = async (req, res, next) => {
	try {
		const id = getIdParam(req.params.id);
		if (!id) {
			res
				.status(400)
				.json({ message: "Invalid location id", code: "INVALID_LOCATION_ID" });
			return;
		}

		const location = await Location.findById(id);
		if (!location) {
			res
				.status(404)
				.json({ message: "Location not found", code: "LOCATION_NOT_FOUND" });
			return;
		}

		res.status(200).json({ location });
	} catch (error) {
		next(error);
	}
};

export const createLocation: RequestHandler = async (req, res, next) => {
	const parsed = createLocationSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			message: "Invalid payload",
			code: "INVALID_PAYLOAD",
			details: parsed.error.issues,
		});
		return;
	}

	try {
		// Settings are per-location, so a new branch starts from the documented
		// defaults and merges any caller overrides on top — never an empty object.
		const location = await Location.create({
			...parsed.data,
			settings: {
				...DEFAULT_LOCATION_SETTINGS,
				...(parsed.data.settings ?? {}),
				graceGrantLimits: {
					...DEFAULT_LOCATION_SETTINGS.graceGrantLimits,
					...(parsed.data.settings?.graceGrantLimits ?? {}),
				},
			},
		});

		res.status(201).json({ message: "Location created", location });
	} catch (error) {
		if (handleError(error, res)) return;
		next(error);
	}
};

export const updateLocationById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);
	if (!id) {
		res
			.status(400)
			.json({ message: "Invalid location id", code: "INVALID_LOCATION_ID" });
		return;
	}

	const parsed = updateLocationSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			message: "Invalid payload",
			code: "INVALID_PAYLOAD",
			details: parsed.error.issues,
		});
		return;
	}

	try {
		const location = await Location.findByIdAndUpdate(
			id,
			{ $set: parsed.data },
			{ new: true, runValidators: true },
		);

		if (!location) {
			res
				.status(404)
				.json({ message: "Location not found", code: "LOCATION_NOT_FOUND" });
			return;
		}

		res.status(200).json({ message: "Location updated", location });
	} catch (error) {
		if (handleError(error, res)) return;
		next(error);
	}
};

/**
 * Deactivates rather than deletes. Locations are referenced by bookings, visits
 * and memberships — removing the document would orphan that history.
 */
export const deleteLocationById: RequestHandler = async (req, res, next) => {
	try {
		const id = getIdParam(req.params.id);
		if (!id) {
			res
				.status(400)
				.json({ message: "Invalid location id", code: "INVALID_LOCATION_ID" });
			return;
		}

		const activeCount = await Location.countDocuments({ isActive: true });
		const target = await Location.findById(id).select("isActive");

		if (!target) {
			res
				.status(404)
				.json({ message: "Location not found", code: "LOCATION_NOT_FOUND" });
			return;
		}

		// Refuse to leave the system with zero active branches — every
		// location-stamped write resolves through the active set.
		if (target.isActive !== false && activeCount <= 1) {
			res.status(409).json({
				message:
					"Cannot deactivate the only active location. Create another branch first.",
				code: "LAST_ACTIVE_LOCATION",
			});
			return;
		}

		const location = await Location.findByIdAndUpdate(
			id,
			{ $set: { isActive: false } },
			{ new: true },
		);

		res.status(200).json({ message: "Location deactivated", location });
	} catch (error) {
		next(error);
	}
};

export const getLocationSettingsById: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const id = getIdParam(req.params.id);
		if (!id) {
			res
				.status(400)
				.json({ message: "Invalid location id", code: "INVALID_LOCATION_ID" });
			return;
		}

		const location = await Location.findById(id).select("settings timezone name");
		if (!location) {
			res
				.status(404)
				.json({ message: "Location not found", code: "LOCATION_NOT_FOUND" });
			return;
		}

		res.status(200).json({
			locationId: id,
			name: location.name,
			timezone: location.timezone,
			settings: location.settings,
		});
	} catch (error) {
		next(error);
	}
};

export const updateLocationSettingsById: RequestHandler = async (
	req,
	res,
	next,
) => {
	const id = getIdParam(req.params.id);
	if (!id) {
		res
			.status(400)
			.json({ message: "Invalid location id", code: "INVALID_LOCATION_ID" });
		return;
	}

	const parsed = locationSettingsSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			message: "Invalid payload",
			code: "INVALID_PAYLOAD",
			details: parsed.error.issues,
		});
		return;
	}

	try {
		const existing = await Location.findById(id).select("settings");
		if (!existing) {
			res
				.status(404)
				.json({ message: "Location not found", code: "LOCATION_NOT_FOUND" });
			return;
		}

		// Merge rather than replace so a partial PUT can't silently blank out
		// settings the caller didn't mention.
		const current = (existing.settings ?? {}) as Record<string, unknown>;
		const merged = {
			...current,
			...parsed.data,
			graceGrantLimits: {
				...((current.graceGrantLimits as Record<string, unknown>) ?? {}),
				...(parsed.data.graceGrantLimits ?? {}),
			},
		};

		const location = await Location.findByIdAndUpdate(
			id,
			{ $set: { settings: merged } },
			{ new: true, runValidators: true },
		).select("settings timezone name");

		res.status(200).json({
			message: "Location settings updated",
			locationId: id,
			settings: location?.settings,
		});
	} catch (error) {
		if (handleError(error, res)) return;
		next(error);
	}
};

/**
 * Clones settings between branches.
 *
 * Settings are per-location by design, which means a company-wide policy change
 * would otherwise be retyped for every branch. This makes standing up branch N
 * a single call against a branch already known to be configured correctly.
 */
export const copyLocationSettings: RequestHandler = async (req, res, next) => {
	try {
		const id = getIdParam(req.params.id);
		const sourceId = getIdParam(req.params.sourceId);

		if (!id || !sourceId) {
			res
				.status(400)
				.json({ message: "Invalid location id", code: "INVALID_LOCATION_ID" });
			return;
		}

		if (id === sourceId) {
			res.status(400).json({
				message: "Source and target locations are the same",
				code: "INVALID_PAYLOAD",
			});
			return;
		}

		const source = await Location.findById(sourceId).select("settings name");
		if (!source) {
			res.status(404).json({
				message: "Source location not found",
				code: "LOCATION_NOT_FOUND",
			});
			return;
		}

		const target = await Location.findByIdAndUpdate(
			id,
			{ $set: { settings: source.settings } },
			{ new: true, runValidators: true },
		).select("settings name");

		if (!target) {
			res.status(404).json({
				message: "Target location not found",
				code: "LOCATION_NOT_FOUND",
			});
			return;
		}

		res.status(200).json({
			message: `Settings copied from ${source.name}`,
			locationId: id,
			settings: target.settings,
		});
	} catch (error) {
		if (handleError(error, res)) return;
		next(error);
	}
};
