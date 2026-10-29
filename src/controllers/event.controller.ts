import type { RequestHandler } from "express";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import FitflixEvent from "../models/FitflixEvent";
import { createEventSchema, updateEventSchema } from "../validators/event.validator";
import { uploadToS3 } from "../utils/s3.service";

const getValidationDetails = (
	issues: Array<{ path: PropertyKey[]; message: string }>,
): Record<string, string> => {
	const details: Record<string, string> = {};
	for (const issue of issues) {
		const field =
			issue.path && issue.path.length > 0
				? issue.path.map(String).join(".")
				: "body";
		if (!details[field]) {
			details[field] = issue.message;
		}
	}
	return details;
};

const slugify = (text: string): string => {
	return text
		.toString()
		.toLowerCase()
		.trim()
		.replace(/[\s\W-]+/g, "-")
		.replace(/^-+|-+$/g, "");
};

/**
 * GET /events (and /api/v1/events)
 * List all events for FrontDesk staff with optional filtering
 */
export const getEvents: RequestHandler = async (req, res, next) => {
	try {
		const filter: Record<string, any> = {};
		if (req.query.status && typeof req.query.status === "string" && req.query.status !== "all") {
			filter.status = req.query.status.toLowerCase().trim();
		}
		if (req.query.eventType && typeof req.query.eventType === "string") {
			filter.eventType = req.query.eventType.trim();
		}
		if (req.query.search && typeof req.query.search === "string") {
			const s = req.query.search.trim();
			filter.$or = [
				{ title: { $regex: s, $options: "i" } },
				{ slug: { $regex: s, $options: "i" } },
				{ "venue.name": { $regex: s, $options: "i" } },
				{ "venue.city": { $regex: s, $options: "i" } },
			];
		}

		const events = await FitflixEvent.find(filter).sort({ startDate: -1 }).lean();
		res.status(200).json({ events });
	} catch (error) {
		next(error);
	}
};

/**
 * GET /events/:id
 * Retrieve a single event by ObjectId or Slug
 */
export const getEventById: RequestHandler = async (req, res, next) => {
	try {
		const param = String(req.params.id || "").trim();
		if (!param) {
			res.status(400).json({ error: "Event ID or slug required", code: "BAD_REQUEST" });
			return;
		}

		const query = mongoose.Types.ObjectId.isValid(param)
			? { $or: [{ _id: param }, { slug: param.toLowerCase() }] }
			: { slug: param.toLowerCase() };

		const event = await FitflixEvent.findOne(query).lean();
		if (!event) {
			res.status(404).json({ error: "Event not found", code: "NOT_FOUND" });
			return;
		}

		res.status(200).json({ event });
	} catch (error) {
		next(error);
	}
};

/**
 * POST /events/upload-image
 * Upload cover flyer / poster image for an event
 */
export const uploadEventImage: RequestHandler = async (req, res, next) => {
	if (!req.user || !["admin", "frontdesk", "ROLE_FRONT_DESK_STAFF"].includes(req.user.role)) {
		res.status(403).json({
			error: "Forbidden: Only staff and admins can upload event assets",
			code: "FORBIDDEN",
		});
		return;
	}

	const file = req.file;
	if (!file) {
		res.status(400).json({
			error: "No image file provided",
			code: "VALIDATION_ERROR",
			details: { image: "An image file is required" },
		});
		return;
	}

	try {
		const ext = path.extname(file.originalname).toLowerCase() || ".png";
		const key = `events/cover-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
		const buffer = await readFile(file.path);
		await uploadToS3(key, buffer, file.mimetype);

		// Clean up multer temp file
		try {
			await unlink(file.path);
		} catch {
			// Ignore temp cleanup errors
		}

		const backendBaseUrl = process.env.BACKEND_URL || "http://localhost:3000";
		const imageUrl = `${backendBaseUrl}/uploads/${key}`;

		res.status(200).json({
			message: "Event image uploaded successfully",
			url: imageUrl,
			key,
		});
	} catch (error) {
		next(error);
	}
};

/**
 * POST /events (and /api/v1/events)
 * Create an offline Fitflix event (Admin & Frontdesk only)
 */
export const createEvent: RequestHandler = async (req, res, next) => {
	if (!req.user || !["admin", "frontdesk", "ROLE_FRONT_DESK_STAFF"].includes(req.user.role)) {
		res.status(403).json({
			error: "Forbidden: Only staff and admins can create events",
			code: "FORBIDDEN",
		});
		return;
	}

	const parsed = createEventSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const data = parsed.data;
		let slug = data.slug ? slugify(data.slug) : slugify(data.title);

		if (!slug) {
			slug = `event-${Date.now()}`;
		}

		// Ensure uniqueness of slug
		let existingEvent = await FitflixEvent.findOne({ slug }).lean();
		if (existingEvent) {
			if (data.slug) {
				res.status(409).json({
					error: "An event with this custom slug already exists",
					code: "CONFLICT",
					details: { slug: "Slug is already in use" },
				});
				return;
			}
			// Auto-append random suffix if generated from title
			slug = `${slug}-${Math.random().toString(36).substring(2, 6)}`;
		}

		const event = await FitflixEvent.create({
			...data,
			slug,
			createdByAdminId: mongoose.Types.ObjectId.isValid(req.user.id)
				? new mongoose.Types.ObjectId(req.user.id)
				: null,
		});

		res.status(201).json({
			message: "Event created successfully",
			event,
		});
	} catch (error) {
		next(error);
	}
};

/**
 * PATCH /events/:id
 * Update event details (Admin & Frontdesk only)
 */
export const updateEvent: RequestHandler = async (req, res, next) => {
	if (!req.user || !["admin", "frontdesk", "ROLE_FRONT_DESK_STAFF"].includes(req.user.role)) {
		res.status(403).json({
			error: "Forbidden: Only staff and admins can update events",
			code: "FORBIDDEN",
		});
		return;
	}

	const param = String(req.params.id || "").trim();
	if (!param) {
		res.status(400).json({ error: "Event ID or slug required", code: "BAD_REQUEST" });
		return;
	}

	const parsed = updateEventSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const query = mongoose.Types.ObjectId.isValid(param)
			? { $or: [{ _id: param }, { slug: param.toLowerCase() }] }
			: { slug: param.toLowerCase() };

		const event = await FitflixEvent.findOne(query);
		if (!event) {
			res.status(404).json({ error: "Event not found", code: "NOT_FOUND" });
			return;
		}

		const updates = parsed.data;

		// Date consistency check when updating either date individually
		const effectiveStartDate = updates.startDate ?? event.startDate;
		const effectiveEndDate = updates.endDate ?? event.endDate;
		if (effectiveEndDate < effectiveStartDate) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: { endDate: "endDate cannot be before startDate" },
			});
			return;
		}

		// If updating slug, ensure uniqueness across other events
		if (updates.slug && updates.slug !== event.slug) {
			const slug = slugify(updates.slug);
			const conflict = await FitflixEvent.findOne({ slug, _id: { $ne: event._id } }).lean();
			if (conflict) {
				res.status(409).json({
					error: "An event with this custom slug already exists",
					code: "CONFLICT",
					details: { slug: "Slug is already in use" },
				});
				return;
			}
			updates.slug = slug;
		}

		// Merge nested venue cleanly to prevent overwriting existing venue properties
		if (updates.venue) {
			const existingVenue = event.venue && typeof (event.venue as any).toObject === "function"
				? (event.venue as any).toObject()
				: event.venue || {};
			updates.venue = {
				...existingVenue,
				...updates.venue,
			};
		}

		Object.assign(event, updates);
		await event.save();

		res.status(200).json({
			message: "Event updated successfully",
			event,
		});
	} catch (error) {
		next(error);
	}
};

/**
 * DELETE /events/:id
 * Delete or cancel an event (Admin only)
 */
export const deleteEvent: RequestHandler = async (req, res, next) => {
	if (!req.user || !["admin", "ROLE_FRONT_DESK_STAFF"].includes(req.user.role)) {
		res.status(403).json({
			error: "Forbidden: Only administrators can delete events",
			code: "FORBIDDEN",
		});
		return;
	}

	const param = String(req.params.id || "").trim();
	if (!param) {
		res.status(400).json({ error: "Event ID or slug required", code: "BAD_REQUEST" });
		return;
	}

	try {
		const query = mongoose.Types.ObjectId.isValid(param)
			? { $or: [{ _id: param }, { slug: param.toLowerCase() }] }
			: { slug: param.toLowerCase() };

		const event = await FitflixEvent.findOne(query);
		if (!event) {
			res.status(404).json({ error: "Event not found", code: "NOT_FOUND" });
			return;
		}

		await FitflixEvent.deleteOne({ _id: event._id });

		res.status(200).json({
			message: "Event deleted successfully",
			deletedEventId: event._id,
		});
	} catch (error) {
		next(error);
	}
};
