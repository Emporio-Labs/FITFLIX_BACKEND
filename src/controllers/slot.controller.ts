import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { ExpertType } from "../models/Enums";
import Slot from "../models/Slots";
import {
	createSlotBodySchema,
	updateSlotBodySchema,
} from "../validators/slot.validator";

const formatToTimeZoneTime = (isoString: string, timeZone: string): string => {
	const date = new Date(isoString);
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).formatToParts(date);
	const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
	const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
	const hh = hour === "24" ? "00" : hour;
	return `${hh}:${minute}`;
};

const normalizeToUtcDayStart = (value: Date): Date =>
	new Date(
		Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
	);

const normalizeToUtcDayEnd = (value: Date): Date => {
	const start = normalizeToUtcDayStart(value);
	return new Date(start.getTime() + 24 * 60 * 60 * 1000);
};

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (
		typeof idParam !== "string" ||
		!mongoose.Types.ObjectId.isValid(idParam)
	) {
		return null;
	}

	return idParam;
};

const deriveSlotState = (input: {
	date?: Date;
	isDaily?: boolean;
	capacity?: number;
	remainingCapacity?: number;
	isBooked?: boolean;
}) => {
	const isDaily = input.isDaily ?? !input.date;
	const capacity = input.capacity ?? 1;
	const remainingCapacity = input.remainingCapacity ?? capacity;

	return {
		date: isDaily ? null : input.date,
		isDaily,
		capacity,
		remainingCapacity,
		isBooked: remainingCapacity <= 0,
	};
};

export const createSlot: RequestHandler = async (req, res, next) => {
	const parsedBody = createSlotBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid slot payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	try {
		const derivedState = deriveSlotState(parsedBody.data);

		if (!derivedState.isDaily && !derivedState.date) {
			res.status(400).json({
				message: "date is required when isDaily is false",
			});
			return;
		}

		if (derivedState.remainingCapacity > derivedState.capacity) {
			res.status(400).json({
				message: "remainingCapacity cannot exceed capacity",
			});
			return;
		}

		// Guard against duplicate daily templates for the same window. Prod
		// currently carries 16-19 duplicates per window from before this check
		// existed — each one used to inflate /slots/available's summed count
		// while only one of them was ever reachable by a booking. A DB-level
		// unique index isn't safe to add on top of that existing duplicate
		// data (Mongoose would fail to build it against the live collection),
		// so this is enforced here at write time instead.
		const expertType = parsedBody.data.expertType ?? ExpertType.Nutritionist;

		if (derivedState.isDaily) {
			// Scoped by expertType: a nutritionist and a sports-scientist template
			// are allowed to occupy the same time window — they draw from
			// separate capacity pools, so they are not duplicates of each other.
			const duplicate = await Slot.findOne({
				isDaily: true,
				parentTemplate: null,
				expertType,
				startTime: parsedBody.data.startTime,
				endTime: parsedBody.data.endTime,
			}).select("_id");

			if (duplicate) {
				res.status(409).json({
					message: "A daily template already exists for this time window",
					code: "DUPLICATE_TEMPLATE",
					existingSlotId: duplicate._id,
				});
				return;
			}
		}

		const slot = await Slot.create({
			date: derivedState.date,
			isDaily: derivedState.isDaily,
			expertType,
			startTime: parsedBody.data.startTime,
			endTime: parsedBody.data.endTime,
			capacity: derivedState.capacity,
			remainingCapacity: derivedState.remainingCapacity,
			isBooked: derivedState.isBooked,
		});
		res.status(201).json({ message: "Slot created", slot });
	} catch (error) {
		next(error);
	}
};

export const getAvailableSlots: RequestHandler = async (req, res, next) => {
	const rawDate = req.query.date as string;
	if (!rawDate || isNaN(Date.parse(rawDate))) {
		res.status(400).json({
			error: "Invalid query parameter: date is required (YYYY-MM-DD)",
			code: "VALIDATION_ERROR",
			details: { date: "Invalid date" },
		});
		return;
	}

	// Defaults to nutritionist so callers that predate this parameter (the
	// member app sent `&expertType=nutritionist` even before the backend
	// understood it) keep seeing exactly what they saw before expertType
	// existed — every pre-existing slot was backfilled to that value.
	const rawExpertType = req.query.expertType as string | undefined;
	const expertType = rawExpertType?.trim() || ExpertType.Nutritionist;
	if (!Object.values(ExpertType).includes(expertType as ExpertType)) {
		res.status(400).json({
			error: `Invalid query parameter: expertType must be one of ${Object.values(ExpertType).join(", ")}`,
			code: "VALIDATION_ERROR",
			details: { expertType: "Invalid expert type" },
		});
		return;
	}

	// Slots created before `expertType` existed carry no such field at all:
	// Mongoose applies `default` only when it creates a document, never
	// retroactively, and never injects the default into a query. So a strict
	// `{ expertType: "nutritionist" }` filter silently drops every legacy slot
	// whenever scripts/backfill-slot-expert-type.ts has not been run against
	// that database — which is exactly how the member app's slot list went
	// empty. Treat an untagged slot as nutritionist inventory, which is what it
	// was: the nutritionist flow was /slots/available's only consumer before
	// expertType shipped. `$in: [..., null]` matches a null field *and* a
	// missing one. Every other expert type stays strictly filtered — an
	// untagged row must never leak into sports-scientist inventory.
	const expertTypeFilter =
		expertType === ExpertType.Nutritionist
			? { $in: [ExpertType.Nutritionist, null] }
			: expertType;

	try {
		const parsedDate = new Date(rawDate);

		const dayStart = normalizeToUtcDayStart(parsedDate);
		const dayEnd = normalizeToUtcDayEnd(parsedDate);

		const concreteSlots = await Slot.find({
			expertType: expertTypeFilter,
			date: { $gte: dayStart, $lt: dayEnd },
			remainingCapacity: { $gt: 0 },
			isBooked: false,
		})
			.select(
				"_id date startTime endTime capacity remainingCapacity parentTemplate expertType",
			)
			.sort({ startTime: 1 });

		const allConcreteForDay = await Slot.find({
			expertType: expertTypeFilter,
			date: { $gte: dayStart, $lt: dayEnd },
			parentTemplate: { $exists: true, $ne: null },
		}).select("parentTemplate startTime endTime");

		const templatesWithConcrete = new Set(
			allConcreteForDay.map(
				(s) =>
					`${s.parentTemplate?.toString() ?? ""}::${s.startTime}::${s.endTime}`,
			),
		);

		// `remainingCapacity`/`isBooked` selected (and filtered) here too: a
		// template drained by a booking against it directly — the bug the
		// nutritionist flow used to have, before reservations were moved to
		// per-date concrete children — must stop being offered, not keep
		// advertising its original `capacity` forever.
		const dailyTemplates = await Slot.find({
			expertType: expertTypeFilter,
			isDaily: true,
			parentTemplate: null,
			capacity: { $gt: 0 },
			remainingCapacity: { $gt: 0 },
			isBooked: false,
		})
			.select("_id startTime endTime capacity remainingCapacity expertType")
			.sort({ startTime: 1 });

		const templateRows = dailyTemplates
			.filter(
				(t) =>
					!templatesWithConcrete.has(
						`${t._id.toString()}::${t.startTime}::${t.endTime}`,
					),
			)
			.map((t) => ({
				slotId: t._id,
				date: dayStart,
				expertType: t.expertType ?? ExpertType.Nutritionist,
				startTime: t.startTime,
				endTime: t.endTime,
				capacity: t.capacity,
				// A template's own remainingCapacity should normally equal its
				// capacity (per-date bookings drain a materialized child instead —
				// see resolveConcreteSlotForBooking), but take the min defensively
				// so a template left over-drained by old data never overstates
				// what a booking against it can actually reserve.
				remainingCapacity: Math.min(t.capacity, t.remainingCapacity),
				parentTemplate: null as string | null,
			}));

		const concreteRows = concreteSlots.map((s) => ({
			slotId: s._id,
			date: s.date,
			expertType: s.expertType ?? ExpertType.Nutritionist,
			startTime: s.startTime,
			endTime: s.endTime,
			capacity: s.capacity,
			remainingCapacity: s.remainingCapacity,
			parentTemplate: s.parentTemplate ? s.parentTemplate.toString() : null,
		}));

		// Multiple daily-template rows can legitimately exist for the same
		// startTime/endTime window (no uniqueness constraint on templates).
		// Collapse them into one card per window so the UI never shows
		// duplicate "same time, different count" slots — but unlike before,
		// keep only the single row with the most capacity rather than summing
		// every row's remainingCapacity onto one row's id. Summing let a card
		// advertise e.g. "107 spots" while the one bookable id behind it had 0
		// left, because the other 16 templates' capacity was folded into a
		// number nobody could actually claim.
		const grouped = new Map<string, (typeof concreteRows)[number]>();

		for (const row of [...concreteRows, ...templateRows]) {
			const key = `${row.startTime}::${row.endTime}`;
			const existing = grouped.get(key);
			if (!existing || row.remainingCapacity > existing.remainingCapacity) {
				grouped.set(key, row);
			}
		}

		const slots = Array.from(grouped.values()).sort((a, b) =>
			a.startTime.localeCompare(b.startTime),
		);

		res.status(200).json({ date: dayStart, slots });
	} catch (error) {
		next(error);
	}
};

export const getAllSlots: RequestHandler = async (_req, res, next) => {
	try {
		const slots = await Slot.find();
		res.status(200).json({ slots });
	} catch (error) {
		next(error);
	}
};

export const getSlotById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid slot id" });
		return;
	}

	try {
		const slot = await Slot.findById(id);

		if (!slot) {
			res.status(404).json({ message: "Slot not found" });
			return;
		}

		res.status(200).json({ slot });
	} catch (error) {
		next(error);
	}
};

export const updateSlotById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid slot id" });
		return;
	}

	const parsedBody = updateSlotBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid slot update payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	try {
		const existingSlot = await Slot.findById(id);

		if (!existingSlot) {
			res.status(404).json({ message: "Slot not found" });
			return;
		}

		const effectiveDate =
			parsedBody.data.date !== undefined
				? parsedBody.data.date
				: (existingSlot.date ?? undefined);
		const effectiveIsDaily =
			parsedBody.data.isDaily ?? existingSlot.isDaily ?? !effectiveDate;
		const effectiveCapacity =
			parsedBody.data.capacity ?? existingSlot.capacity ?? 1;
		const effectiveRemainingCapacity =
			parsedBody.data.remainingCapacity ??
			existingSlot.remainingCapacity ??
			effectiveCapacity;

		if (!effectiveIsDaily && !effectiveDate) {
			res.status(400).json({
				message: "date is required when isDaily is false",
			});
			return;
		}

		if (effectiveRemainingCapacity > effectiveCapacity) {
			res.status(400).json({
				message: "remainingCapacity cannot exceed capacity",
			});
			return;
		}

		const updatedSlot = await Slot.findByIdAndUpdate(
			id,
			{
				...(parsedBody.data.date !== undefined
					? { date: effectiveIsDaily ? null : parsedBody.data.date }
					: {}),
				...(parsedBody.data.isDaily !== undefined
					? { isDaily: parsedBody.data.isDaily }
					: {}),
				...(parsedBody.data.expertType !== undefined
					? { expertType: parsedBody.data.expertType }
					: {}),
				...(parsedBody.data.startTime !== undefined
					? { startTime: parsedBody.data.startTime }
					: {}),
				...(parsedBody.data.endTime !== undefined
					? { endTime: parsedBody.data.endTime }
					: {}),
				...(parsedBody.data.capacity !== undefined
					? { capacity: parsedBody.data.capacity }
					: {}),
				...(parsedBody.data.remainingCapacity !== undefined
					? { remainingCapacity: parsedBody.data.remainingCapacity }
					: {}),
				isBooked: effectiveRemainingCapacity <= 0,
				...(effectiveIsDaily ? { date: null } : {}),
			},
			{
				returnDocument: "after",
				runValidators: true,
			},
		);

		if (!updatedSlot) {
			res.status(404).json({ message: "Slot not found" });
			return;
		}

		res.status(200).json({ message: "Slot updated", slot: updatedSlot });
	} catch (error) {
		next(error);
	}
};

export const deleteSlotById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid slot id" });
		return;
	}

	try {
		const deletedSlot = await Slot.findByIdAndDelete(id);

		if (!deletedSlot) {
			res.status(404).json({ message: "Slot not found" });
			return;
		}

		res.status(200).json({ message: "Slot deleted" });
	} catch (error) {
		next(error);
	}
};
