import crypto from "node:crypto";
import EventRegistration from "../models/EventRegistration";
import User from "../models/User";
import Lead from "../models/Lead";
import { EventStatus, LeadStatus, RegistrationPaymentStatus } from "../models/Enums";
import { registerEventSchema, verifyCheckInSchema } from "../validators/event-registration.validator";
import type { RequestHandler } from "express";
import { createReadStream, existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import FitflixEvent from "../models/FitflixEvent";
import { createEventSchema, updateEventSchema } from "../validators/event.validator";
import { getS3ObjectStream, uploadToS3 } from "../utils/s3.service";

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
		const assetType = String(req.query.type || "cover").toLowerCase().trim();
		const folderPrefix = ["collaborator", "sponsor", "badge", "cover"].includes(assetType)
			? assetType
			: "asset";
		const key = `events/${folderPrefix}-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
		const buffer = await readFile(file.path);
		const uploadResult = await uploadToS3(key, buffer, file.mimetype);

		// Clean up multer temp file
		try {
			await unlink(file.path);
		} catch {
			// Ignore temp cleanup errors
		}

		res.status(200).json({
			message: "Event asset uploaded successfully",
			url: uploadResult.url,
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
/**
 * GET /events/assets/* (and /api/v1/events/assets/*)
 * Public streaming proxy for event flyers, co-branding logos, and collaborator assets.
 * Seamlessly resolves from local uploads/ or authenticated AWS S3 without 403 Forbidden errors.
 */
export const streamEventAsset: RequestHandler = async (req, res, next) => {
	try {
		const rawKey = req.params.key;
		const keyString = Array.isArray(rawKey)
			? rawKey.join('/')
			: typeof rawKey === 'string'
				? rawKey
				: req.params[0] || req.path.replace(/^\/assets\/?/, '');
		const cleanKey = String(keyString).replace(/^\/+/, '').replace(/\.\./g, '');

		if (!cleanKey) {
			res.status(400).json({ error: 'Asset key required', code: 'BAD_REQUEST' });
			return;
		}

		// 1. Check local disk first
		const localUploadsPath = path.resolve(process.cwd(), 'uploads', cleanKey);
		if (existsSync(localUploadsPath)) {
			const ext = path.extname(cleanKey).toLowerCase();
			const mimeMap: Record<string, string> = {
				'.jpg': 'image/jpeg',
				'.jpeg': 'image/jpeg',
				'.png': 'image/png',
				'.webp': 'image/webp',
				'.svg': 'image/svg+xml',
				'.gif': 'image/gif',
			};
			const contentType = mimeMap[ext] || 'application/octet-stream';
			res.setHeader('Content-Type', contentType);
			res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
			createReadStream(localUploadsPath).pipe(res);
			return;
		}

		// 2. Fetch from AWS S3 via server credentials
		const s3Data = await getS3ObjectStream(cleanKey);
		if (s3Data?.stream) {
			res.setHeader('Content-Type', s3Data.contentType);
			if (s3Data.contentLength) {
				res.setHeader('Content-Length', s3Data.contentLength);
			}
			res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
			(s3Data.stream as any).pipe(res);
			return;
		}

		res.status(404).json({ error: 'Asset not found', code: 'NOT_FOUND' });
	} catch (error) {
		next(error);
	}
};

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

const generateTicketId = (eventSlug: string): string => {
	const cleanSlug = eventSlug.replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase() || "EVNT";
	const random = Math.floor(1000 + Math.random() * 9000);
	return `FFX-${cleanSlug}-${random}`;
};

/**
 * GET /events/public/:slug (and /api/v1/events/public/:slug)
 * Public endpoint to fetch event details, tiers, and availability
 */
/**
 * GET /events/public (and /api/v1/events/public)
 * Public: List published upcoming events for mobile app discovery
 */
export const getPublicEvents: RequestHandler = async (req, res, next) => {
	try {
		const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
		const filter: Record<string, any> = {
			status: EventStatus.Published,
			startDate: { $gte: oneDayAgo },
		};

		if (req.query.eventType && typeof req.query.eventType === "string") {
			filter.eventType = req.query.eventType.trim();
		}

		const events = await FitflixEvent.find(filter)
			.select("title slug tagline eventType startDate endDate reportingTime venue totalCapacity totalRegistered coverImageUrl collaborators ticketTiers status")
			.sort({ startDate: 1 })
			.lean();

		res.status(200).json({ events });
	} catch (error) {
		next(error);
	}
};

export const getPublicEventBySlug: RequestHandler = async (req, res, next) => {
	const slug = String(req.params.slug || "").trim().toLowerCase();
	if (!slug) {
		res.status(400).json({ error: "Event slug is required", code: "BAD_REQUEST" });
		return;
	}

	try {
		const event = await FitflixEvent.findOne({ slug }).lean();
		if (!event) {
		res.status(404).json({ error: "Event not found", code: "NOT_FOUND" });
			return;
		}

		// Public can view Published, Ongoing, or RegistrationClosed events
		if (![EventStatus.Published, EventStatus.RegistrationClosed, EventStatus.Ongoing].includes(event.status as any)) {
			res.status(404).json({ error: "Event is not publicly accessible", code: "NOT_FOUND" });
			return;
		}

		// Calculate remaining quantity per tier
		const tiersWithAvailability = (event.ticketTiers || []).map((t) => ({
			...t,
			remainingQuantity: Math.max(0, (t.totalQuantity || 0) - (t.soldQuantity || 0)),
			isSoldOut: (t.soldQuantity || 0) >= (t.totalQuantity || 0),
		}));

		res.status(200).json({
			event: {
				...event,
				ticketTiers: tiersWithAvailability,
				isSoldOut: (event.totalRegistered || 0) >= (event.totalCapacity || 0),
			},
		});
	} catch (error) {
		next(error);
	}
};

/**
 * POST /events/:slug/register (and /api/v1/events/:slug/register)
 * Public / Member registration checkout endpoint
 */
export const registerForEvent: RequestHandler = async (req, res, next) => {
	const slug = String(req.params.slug || "").trim().toLowerCase();
	if (!slug) {
		res.status(400).json({ error: "Event slug is required", code: "BAD_REQUEST" });
		return;
	}

	const parsed = registerEventSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	const { tierId, attendeeName, attendeeEmail, attendeePhone, answers, paymentReference } = parsed.data;

	try {
		const event = await FitflixEvent.findOne({ slug });
		if (!event) {
			res.status(404).json({ error: "Event not found", code: "NOT_FOUND" });
			return;
		}

		// Guard: Event status
		if (event.status !== EventStatus.Published) {
			res.status(400).json({
				error: `Event registrations are currently not open (Status: ${event.status}).`,
				code: "REGISTRATION_NOT_OPEN",
			});
			return;
		}

		// Guard: Overall event capacity
		if (event.totalRegistered >= event.totalCapacity) {
			res.status(409).json({
				error: "This event has reached full capacity. No further registrations can be accepted.",
				code: "EVENT_SOLD_OUT",
			});
			return;
		}

		// Guard: Find ticket tier
		const tier = event.ticketTiers.find((t) => t.tierId === tierId);
		if (!tier) {
			res.status(404).json({
				error: "Selected pass tier does not exist for this event.",
				code: "TIER_NOT_FOUND",
			});
			return;
		}

		// Guard: Tier quota
		if (tier.soldQuantity >= tier.totalQuantity) {
			res.status(409).json({
				error: `The ${tier.name} tier is completely sold out.`,
				code: "TIER_SOLD_OUT",
			});
			return;
		}

		// Guard: Sales window
		const now = new Date();
		if (tier.validFrom && now < new Date(tier.validFrom)) {
			res.status(400).json({
				error: `Pass sales have not started yet (Opens on ${new Date(tier.validFrom).toLocaleDateString()}).`,
				code: "SALES_NOT_STARTED",
			});
			return;
		}
		if (tier.validUntil && now > new Date(tier.validUntil)) {
			res.status(400).json({
				error: "Pass sales for this tier have ended.",
				code: "SALES_ENDED",
			});
			return;
		}

		// Guard: Duplicate registration
		const existingReg = await EventRegistration.findOne({
			eventId: event._id,
			$or: [{ attendeeEmail }, { attendeePhone }],
		});
		if (existingReg) {
			res.status(409).json({
				error: "You have already registered for this event with this email or phone number.",
				code: "DUPLICATE_REGISTRATION",
				existingTicketId: existingReg.ticketId,
			});
			return;
		}

		// Generate unique Ticket ID
		let ticketId = "";
		let isUnique = false;
		let attempts = 0;
		while (!isUnique && attempts < 10) {
			attempts++;
			ticketId = generateTicketId(event.slug);
			const exists = await EventRegistration.exists({ ticketId });
			if (!exists) isUnique = true;
		}

		const verificationToken = crypto.randomBytes(24).toString("hex");

		// Check User association if logged in or existing member
		let userId: mongoose.Types.ObjectId | null = null;
		if (req.user?.id && mongoose.Types.ObjectId.isValid(req.user.id)) {
			userId = new mongoose.Types.ObjectId(req.user.id);
		} else {
			const existingUser = await User.findOne({
				$or: [{ email: attendeeEmail }, { phone: attendeePhone }],
			});
			if (existingUser) {
				userId = existingUser._id;
			}
		}

		// Determine payment status
		const paymentStatus =
			tier.price > 0
				? paymentReference
					? RegistrationPaymentStatus.Paid
					: RegistrationPaymentStatus.Pending
				: RegistrationPaymentStatus.Free;

		const registration = await EventRegistration.create({
			eventId: event._id,
			tierId: tier.tierId,
			tierName: tier.name,
			ticketId,
			userId,
			attendeeName,
			attendeeEmail,
			attendeePhone,
			answers,
			paymentStatus,
			paymentReference: paymentReference || null,
			amountPaid: tier.price || 0,
			verificationToken,
		});

		// Atomic tier and event counter increment
		await FitflixEvent.updateOne(
			{ _id: event._id, "ticketTiers.tierId": tier.tierId },
			{
				$inc: {
					totalRegistered: 1,
					"ticketTiers.$.soldQuantity": 1,
				},
			},
		);

		// Async CRM lead sync (non-blocking)
		Lead.findOneAndUpdate(
			{ phone: attendeePhone },
			{
				$setOnInsert: {
					leadName: attendeeName,
					email: attendeeEmail,
					phone: attendeePhone,
					source: `Offline Event: ${event.title}`,
					status: LeadStatus.Warm,
					tags: ["event_attendee", tier.tierId, event.slug],
					notes: `Registered for ${event.title} (${tier.name}) on ${new Date().toLocaleDateString()}`,
				},
			},
			{ upsert: true },
		).catch((err) => console.error("Lead sync error:", err));

		res.status(201).json({
			message: "Registration successful! Your digital pass has been issued.",
			registration: {
				id: registration._id,
				ticketId: registration.ticketId,
				tierName: registration.tierName,
				tierId: registration.tierId,
				attendeeName: registration.attendeeName,
				attendeeEmail: registration.attendeeEmail,
				attendeePhone: registration.attendeePhone,
				paymentStatus: registration.paymentStatus,
				amountPaid: registration.amountPaid,
				verificationToken: registration.verificationToken,
				createdAt: registration.createdAt,
			},
			event: {
				id: event._id,
				title: event.title,
				slug: event.slug,
				startDate: event.startDate,
				reportingTime: event.reportingTime,
				venue: event.venue,
				coverImageUrl: event.coverImageUrl,
			},
		});
	} catch (error) {
		if ((error as any)?.code === 11000) {
			res.status(409).json({
				error: "A registration with this email address or phone number already exists for this event.",
				code: "DUPLICATE_REGISTRATION",
			});
			return;
		}
		next(error);
	}
};

/**
 * GET /events/:id/registrations (and /api/v1/events/:id/registrations)
 * List registered attendees for an event (FrontDesk / Admin)
 */
export const getEventRegistrations: RequestHandler = async (req, res, next) => {
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

		// 1. Calculate overall event roster summary (independent of current table filters)
		const allEventRegs = await EventRegistration.find({ eventId: event._id }).lean();
		const totalCheckedIn = allEventRegs.filter((r) => r.checkedIn).length;
		const totalRevenue = allEventRegs.reduce((sum, r) => sum + (r.amountPaid || 0), 0);

		const tierBreakdown = (event.ticketTiers || []).map((t) => {
			const bookedCount = allEventRegs.filter((r) => r.tierId === t.tierId).length;
			return {
				tierId: t.tierId,
				name: t.name,
				badgeLabel: t.badgeLabel,
				badgeColor: t.badgeColor,
				price: t.price,
				totalQuantity: t.totalQuantity,
				bookedCount,
				soldQuantity: t.soldQuantity || bookedCount,
				isSoldOut: (t.soldQuantity || bookedCount) >= t.totalQuantity,
			};
		});

		const summary = {
			totalRegistered: allEventRegs.length,
			totalCapacity: event.totalCapacity || 100,
			totalCheckedIn,
			totalPending: Math.max(0, allEventRegs.length - totalCheckedIn),
			checkedInPercentage: allEventRegs.length > 0 ? Math.round((totalCheckedIn / allEventRegs.length) * 100) : 0,
			totalRevenue,
			tierBreakdown,
		};

		// 2. Apply filters for table view
		const filter: Record<string, any> = { eventId: event._id };
		if (req.query.checkedIn !== undefined) {
			filter.checkedIn = req.query.checkedIn === "true";
		}
		if (req.query.tierId && typeof req.query.tierId === "string") {
			filter.tierId = req.query.tierId.trim();
		}
		if (req.query.paymentStatus && typeof req.query.paymentStatus === "string") {
			filter.paymentStatus = req.query.paymentStatus.trim();
		}
		if (req.query.search && typeof req.query.search === "string") {
			const s = req.query.search.trim();
			filter.$or = [
				{ attendeeName: { $regex: s, $options: "i" } },
				{ attendeeEmail: { $regex: s, $options: "i" } },
				{ attendeePhone: { $regex: s, $options: "i" } },
				{ ticketId: { $regex: s, $options: "i" } },
			];
		}

		const registrations = await EventRegistration.find(filter)
			.sort({ createdAt: -1 })
			.lean();

		res.status(200).json({
			event: {
				id: event._id,
				title: event.title,
				slug: event.slug,
				startDate: event.startDate,
				reportingTime: event.reportingTime,
				venue: event.venue,
			},
			summary,
			total: registrations.length,
			registrations,
		});
	} catch (error) {
		next(error);
	}
};

/**
 * PATCH /events/registrations/:id/toggle-checkin (and /api/v1/events/registrations/:id/toggle-checkin)
 * Protected: Admin and FrontDesk staff only
 * Manually toggle attendee check-in state from the roster table
 */
export const toggleRegistrationCheckIn: RequestHandler = async (req, res, next) => {
	const registrationId = String(req.params.id || "").trim();
	if (!registrationId || !mongoose.Types.ObjectId.isValid(registrationId)) {
		res.status(400).json({ error: "Valid registration ID is required", code: "BAD_REQUEST" });
		return;
	}

	try {
		const registration = await EventRegistration.findById(registrationId);
		if (!registration) {
			res.status(404).json({ error: "Registration record not found", code: "NOT_FOUND" });
			return;
		}

		const newCheckedInState = !registration.checkedIn;
		registration.checkedIn = newCheckedInState;
		registration.checkedInAt = newCheckedInState ? new Date() : null;
		registration.checkedInByStaffId = newCheckedInState && req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : null;
		await registration.save();

		// Update event totalCheckedIn counter atomically
		await FitflixEvent.updateOne(
			{ _id: registration.eventId },
			{
				$inc: {
					totalCheckedIn: newCheckedInState ? 1 : -1,
				},
			},
		);

		res.status(200).json({
			message: newCheckedInState
				? `Attendee ${registration.attendeeName} checked in successfully.`
				: `Check-in undone for ${registration.attendeeName}.`,
			registration: {
				id: registration._id,
				ticketId: registration.ticketId,
				attendeeName: registration.attendeeName,
				checkedIn: registration.checkedIn,
				checkedInAt: registration.checkedInAt,
			},
		});
	} catch (error) {
		next(error);
	}
};

/**
 * GET /events/pass/:ticketId (and /api/v1/events/pass/:ticketId)
 * Retrieve digital event pass details with signed verification payload
 */
export const getDigitalPassByTicketId: RequestHandler = async (req, res, next) => {
	const ticketId = String(req.params.ticketId || "").trim().toUpperCase();
	if (!ticketId) {
		res.status(400).json({ error: "Ticket ID is required", code: "BAD_REQUEST" });
		return;
	}

	try {
		const registration = await EventRegistration.findOne({ ticketId });
		if (!registration) {
			res.status(404).json({ error: "Ticket pass not found", code: "NOT_FOUND" });
			return;
		}

		const event = await FitflixEvent.findById(registration.eventId).lean();
		if (!event) {
			res.status(404).json({ error: "Associated event not found", code: "NOT_FOUND" });
			return;
		}

		// Find tier styling details
		const tier = (event.ticketTiers || []).find((t) => t.tierId === registration.tierId);

		// Signed payload for offline QR scanning
		const qrPayload = JSON.stringify({
			ticketId: registration.ticketId,
			eventId: event._id,
			token: registration.verificationToken,
		});

		res.status(200).json({
			pass: {
				id: registration._id,
				ticketId: registration.ticketId,
				tierId: registration.tierId,
				tierName: registration.tierName,
				badgeLabel: tier?.badgeLabel || "GENERAL PASS",
				badgeColor: tier?.badgeColor || "#10b981",
				perks: tier?.perks || [],
				attendeeName: registration.attendeeName,
				attendeeEmail: registration.attendeeEmail,
				attendeePhone: registration.attendeePhone,
				answers: registration.answers,
				checkedIn: registration.checkedIn,
				checkedInAt: registration.checkedInAt,
				paymentStatus: registration.paymentStatus,
				amountPaid: registration.amountPaid,
				verificationToken: registration.verificationToken,
				qrPayload,
				createdAt: registration.createdAt,
			},
			event: {
				id: event._id,
				title: event.title,
				slug: event.slug,
				tagline: event.tagline,
				description: event.description,
				startDate: event.startDate,
				endDate: event.endDate,
				reportingTime: event.reportingTime,
				venue: event.venue,
				coverImageUrl: event.coverImageUrl,
				collaborators: event.collaborators,
				sponsors: event.sponsors,
			},
		});
	} catch (error) {
		next(error);
	}
};

/**
 * POST /events/verify-checkin (and /api/v1/events/verify-checkin)
 * Protected: Admin and FrontDesk staff only
 * Process live QR scan or ticket code verification at entrance gate
 */
/**
 * GET /events/my-passes (and /api/v1/events/my-passes)
 * Protected (Member): List all event passes booked by logged-in user
 */
export const getMyEventPasses: RequestHandler = async (req, res, next) => {
	if (!req.user || !req.user.id) {
		res.status(401).json({ error: "Unauthorized: Member authentication required", code: "UNAUTHORIZED" });
		return;
	}

	try {
		const userId = new mongoose.Types.ObjectId(req.user.id);
		const user = await User.findById(userId).lean();

		// Find registrations tied to userId, or email/phone fallback
		const orConditions: Array<Record<string, any>> = [{ userId }];
		if (user?.email) orConditions.push({ attendeeEmail: user.email.toLowerCase() });
		if (user?.phone) orConditions.push({ attendeePhone: user.phone });

		const registrations = await EventRegistration.find({ $or: orConditions })
			.populate("eventId", "title slug tagline startDate endDate reportingTime venue coverImageUrl collaborators ticketTiers")
			.sort({ createdAt: -1 })
			.lean();

		const passes = registrations.map((reg) => {
			const evt = reg.eventId as any;
			const tier = evt?.ticketTiers?.find((t: any) => t.tierId === reg.tierId);
			const qrPayload = JSON.stringify({
				ticketId: reg.ticketId,
				token: reg.verificationToken,
				eventId: evt?._id,
			});

			return {
				id: reg._id,
				ticketId: reg.ticketId,
				tierId: reg.tierId,
				tierName: reg.tierName,
				badgeLabel: tier?.badgeLabel || "GENERAL PASS",
				badgeColor: tier?.badgeColor || "#8A965A",
				perks: tier?.perks || [],
				attendeeName: reg.attendeeName,
				attendeeEmail: reg.attendeeEmail,
				attendeePhone: reg.attendeePhone,
				checkedIn: reg.checkedIn,
				checkedInAt: reg.checkedInAt,
				paymentStatus: reg.paymentStatus,
				amountPaid: reg.amountPaid,
				verificationToken: reg.verificationToken,
				createdAt: reg.createdAt,
				qrPayload,
				event: evt
					? {
							id: evt._id,
							title: evt.title,
							slug: evt.slug,
							tagline: evt.tagline,
							startDate: evt.startDate,
							endDate: evt.endDate,
							reportingTime: evt.reportingTime,
							venue: evt.venue,
							coverImageUrl: evt.coverImageUrl,
							collaborators: evt.collaborators,
					  }
					: null,
			};
		});

		res.status(200).json({ passes });
	} catch (error) {
		next(error);
	}
};

export const verifyEventCheckIn: RequestHandler = async (req, res, next) => {
	if (!req.user || !["admin", "frontdesk", "ROLE_FRONT_DESK_STAFF"].includes(req.user.role)) {
		res.status(403).json({
			error: "Forbidden: Only staff and admins can verify ticket check-ins",
			code: "FORBIDDEN",
		});
		return;
	}

	const parsed = verifyCheckInSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	const { payload, eventId: targetEventId } = parsed.data;

	try {
		// 1. Extract ticketId from payload
		let extractedTicketId = "";
		let eventIdFromPayload: string | null = null;
		const trimmedPayload = payload.trim();

		// Case A: JSON object payload
		if (trimmedPayload.startsWith("{") && trimmedPayload.endsWith("}")) {
			try {
				const json = JSON.parse(trimmedPayload);
				if (json.ticketId) extractedTicketId = String(json.ticketId).trim().toUpperCase();
				if (json.eventId) eventIdFromPayload = String(json.eventId).trim();
			} catch {
				// not valid JSON
			}
		}

		// Case B: Delimited string (e.g. ticketId:token:timestamp:sig)
		if (!extractedTicketId && trimmedPayload.includes(":")) {
			const parts = trimmedPayload.split(":");
			if (parts.length >= 1) {
				extractedTicketId = parts[0].trim().toUpperCase();
			}
		}

		// Case C: Raw ticket ID string
		if (!extractedTicketId) {
			extractedTicketId = trimmedPayload.toUpperCase();
		}

		// 2. Query registration by ticketId
		let registration = await EventRegistration.findOne({ ticketId: extractedTicketId });

		// Fallback: If not found by ticket ID, check if input was phone or email for this event
		if (!registration && targetEventId && mongoose.Types.ObjectId.isValid(targetEventId)) {
			registration = await EventRegistration.findOne({
				eventId: targetEventId,
				$or: [
					{ attendeePhone: trimmedPayload },
					{ attendeeEmail: trimmedPayload.toLowerCase() },
				],
			});
		}

		if (!registration) {
			res.status(404).json({
				status: "INVALID",
				error: `Ticket '${extractedTicketId}' not found. Please verify the QR code or check attendee phone.`,
				code: "TICKET_NOT_FOUND",
			});
			return;
		}

		// 3. Verify event matching
		const expectedEventId = targetEventId || eventIdFromPayload;
		if (expectedEventId && registration.eventId.toString() !== expectedEventId) {
			const wrongEvent = await FitflixEvent.findById(registration.eventId).select("title").lean();
			res.status(400).json({
				status: "WRONG_EVENT",
				error: `Wrong Event: This ticket was issued for "${wrongEvent?.title || "another event"}", not this event!`,
				code: "WRONG_EVENT",
				ticketEventId: registration.eventId,
				expectedEventId,
				eventName: wrongEvent?.title,
			});
			return;
		}

		// 4. Fetch event and tier for branding / badge response
		const event = await FitflixEvent.findById(registration.eventId).lean();
		const tier = (event?.ticketTiers || []).find((t) => t.tierId === registration.tierId);

		// 5. Duplicate Entry Guard (Already Checked In)
		if (registration.checkedIn) {
			res.status(409).json({
				status: "ALREADY_CHECKED_IN",
				error: `DUPLICATE ENTRY: ${registration.attendeeName} was ALREADY checked in!`,
				code: "ALREADY_CHECKED_IN",
				registration: {
					id: registration._id,
					ticketId: registration.ticketId,
					attendeeName: registration.attendeeName,
					attendeeEmail: registration.attendeeEmail,
					attendeePhone: registration.attendeePhone,
					tierName: registration.tierName,
					badgeLabel: tier?.badgeLabel || "GENERAL PASS",
					badgeColor: tier?.badgeColor || "#10b981",
					checkedIn: true,
					checkedInAt: registration.checkedInAt,
					checkedInByStaffId: registration.checkedInByStaffId,
				},
				event: event ? { id: event._id, title: event.title } : undefined,
			});
			return;
		}

		// 6. Concurrency-Safe Atomic Check-in
		const checkedInAt = new Date();
		const staffId =
			req.user?.id && mongoose.Types.ObjectId.isValid(req.user.id)
				? new mongoose.Types.ObjectId(req.user.id)
				: null;

		const updatedReg = await EventRegistration.findOneAndUpdate(
			{ _id: registration._id, checkedIn: false },
			{
				$set: {
					checkedIn: true,
					checkedInAt,
					checkedInByStaffId: staffId,
				},
			},
			{ returnDocument: "after" },
		);

		if (!updatedReg) {
			// Another thread completed check-in simultaneously
			res.status(409).json({
				status: "ALREADY_CHECKED_IN",
				error: `DUPLICATE ENTRY: ${registration.attendeeName} was just checked in by another scanner!`,
				code: "ALREADY_CHECKED_IN",
				registration: {
					id: registration._id,
					ticketId: registration.ticketId,
					attendeeName: registration.attendeeName,
					attendeeEmail: registration.attendeeEmail,
					attendeePhone: registration.attendeePhone,
					tierName: registration.tierName,
					checkedIn: true,
				},
			});
			return;
		}

		// Increment event counter atomically
		await FitflixEvent.findByIdAndUpdate(registration.eventId, {
			$inc: { totalCheckedIn: 1 },
		});

		res.status(200).json({
			status: "VALID",
			message: `Welcome, ${registration.attendeeName}! Check-in verified.`,
			registration: {
				id: updatedReg._id,
				ticketId: updatedReg.ticketId,
				attendeeName: updatedReg.attendeeName,
				attendeeEmail: updatedReg.attendeeEmail,
				attendeePhone: updatedReg.attendeePhone,
				tierName: updatedReg.tierName,
				badgeLabel: tier?.badgeLabel || "GENERAL PASS",
				badgeColor: tier?.badgeColor || "#10b981",
				perks: tier?.perks || [],
				checkedIn: true,
				checkedInAt: updatedReg.checkedInAt,
			},
			event: event ? { id: event._id, title: event.title } : undefined,
		});
	} catch (error) {
		next(error);
	}
};
