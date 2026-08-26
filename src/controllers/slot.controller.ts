import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { ExpertType, SlotResourceType } from "../models/Enums";
import Slot from "../models/Slots";
import {
	calculateDurationMinutes,
	isIntervalOverlapping,
	minutesToTime,
	timeToMinutes,
} from "../utils/time.util";
import {
	bulkDeleteSlotsBodySchema,
	bulkUpdateSlotsBodySchema,
	createSlotBodySchema,
	generateSlotsBodySchema,
	updateSlotBodySchema,
} from "../validators/slot.validator";

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

export const resolveResourceType = (input: {
	resourceType?: string;
	expertType?: string;
}): SlotResourceType => {
	if (
		input.resourceType &&
		Object.values(SlotResourceType).includes(
			input.resourceType as SlotResourceType,
		)
	) {
		return input.resourceType as SlotResourceType;
	}

	if (input.expertType) {
		const exp = input.expertType.toLowerCase();
		if (exp === "sports_scientist" || exp === "sportsscientist") {
			return SlotResourceType.SPORTS_SCIENTIST;
		}
		if (exp === "nutritionist") {
			return SlotResourceType.NUTRITIONIST;
		}
	}

	return SlotResourceType.NUTRITIONIST;
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

		const resourceType = resolveResourceType(parsedBody.data);
		const locationId = parsedBody.data.locationId && mongoose.Types.ObjectId.isValid(parsedBody.data.locationId)
			? new mongoose.Types.ObjectId(parsedBody.data.locationId)
			: null;
		const resourceId = parsedBody.data.resourceId && mongoose.Types.ObjectId.isValid(parsedBody.data.resourceId)
			? new mongoose.Types.ObjectId(parsedBody.data.resourceId)
			: null;

		const startMin = timeToMinutes(parsedBody.data.startTime);
		const endMin = timeToMinutes(parsedBody.data.endTime);

		if (startMin === null || endMin === null) {
			res.status(400).json({ message: "Invalid startTime or endTime" });
			return;
		}

		// Scoped duplicate check for daily templates
		if (derivedState.isDaily) {
			const duplicateQuery: Record<string, unknown> = {
				isDaily: true,
				parentTemplate: null,
				resourceType,
				startTime: parsedBody.data.startTime,
				endTime: parsedBody.data.endTime,
			};
			if (locationId) duplicateQuery.locationId = locationId;
			if (resourceId) duplicateQuery.resourceId = resourceId;
			else duplicateQuery.resourceId = null;

			const duplicate = await Slot.findOne(duplicateQuery).select("_id");
			if (duplicate) {
				res.status(409).json({
					message: "A daily template already exists for this time window and resource",
					code: "DUPLICATE_TEMPLATE",
					existingSlotId: duplicate._id,
				});
				return;
			}
		}

		// Overlap check for dedicated resources (resourceId !== null)
		if (resourceId) {
			const overlapFilter: Record<string, unknown> = {
				resourceType,
				resourceId,
				parentTemplate: null,
			};
			if (locationId) overlapFilter.locationId = locationId;

			if (derivedState.isDaily) {
				overlapFilter.isDaily = true;
			} else if (derivedState.date) {
				const dayStart = normalizeToUtcDayStart(derivedState.date);
				const dayEnd = normalizeToUtcDayEnd(derivedState.date);
				overlapFilter.date = { $gte: dayStart, $lt: dayEnd };
			}

			const existingSlots = await Slot.find(overlapFilter).select("startTime endTime");
			for (const existing of existingSlots) {
				const exStart = timeToMinutes(existing.startTime);
				const exEnd = timeToMinutes(existing.endTime);
				if (exStart !== null && exEnd !== null && isIntervalOverlapping(startMin, endMin, exStart, exEnd)) {
					res.status(409).json({
						message: `Slot overlaps with existing slot ${existing.startTime} - ${existing.endTime}`,
						code: "SLOT_OVERLAP",
					});
					return;
				}
			}
		}

		const durationMinutes = parsedBody.data.durationMinutes ?? calculateDurationMinutes(parsedBody.data.startTime, parsedBody.data.endTime);

		const slot = await Slot.create({
			locationId,
			resourceType,
			resourceId,
			durationMinutes,
			date: derivedState.date,
			isDaily: derivedState.isDaily,
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

export const generateSlots: RequestHandler = async (req, res, next) => {
	const parsedBody = generateSlotsBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid slot generation payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	try {
		const {
			locationId: rawLocationId,
			isDaily = true,
			replaceExisting = false,
			dateFrom,
			dateTo,
			daysOfWeek,
			windows,
			slotDurationMinutes,
			bufferMinutes = 0,
			capacity = 1,
			dryRun = false,
		} = parsedBody.data;

		const resourceType = resolveResourceType(parsedBody.data);
		const locationId = rawLocationId && mongoose.Types.ObjectId.isValid(rawLocationId)
			? new mongoose.Types.ObjectId(rawLocationId)
			: null;
		const resourceId = parsedBody.data.resourceId && mongoose.Types.ObjectId.isValid(parsedBody.data.resourceId)
			? new mongoose.Types.ObjectId(parsedBody.data.resourceId)
			: null;

		// 1. Calculate time slices across windows
		const intervals: Array<{ startTime: string; endTime: string; startMin: number; endMin: number }> = [];
		for (const win of windows) {
			const winStart = timeToMinutes(win.startTime);
			const winEnd = timeToMinutes(win.endTime);

			if (winStart === null || winEnd === null || winStart >= winEnd) {
				continue;
			}

			for (let cursor = winStart; cursor + slotDurationMinutes <= winEnd; cursor += slotDurationMinutes + bufferMinutes) {
				const sMin = cursor;
				const eMin = cursor + slotDurationMinutes;
				intervals.push({
					startTime: minutesToTime(sMin),
					endTime: minutesToTime(eMin),
					startMin: sMin,
					endMin: eMin,
				});
			}
		}

		if (intervals.length === 0) {
			res.status(400).json({
				message: "No valid time intervals could be generated from the given windows and duration",
			});
			return;
		}

		// 2. Fetch existing slots for conflict & duplicate checks
		const conflictQuery: Record<string, unknown> = {
			resourceType,
			parentTemplate: null,
		};
		if (locationId) conflictQuery.locationId = locationId;
		if (resourceId) conflictQuery.resourceId = resourceId;

		const existingSlots = await Slot.find(conflictQuery).select(
			"date isDaily startTime endTime resourceId locationId",
		);

		const toCreate: Array<Record<string, unknown>> = [];
		const conflicts: Array<{ startTime: string; endTime: string; date?: string; reason: string }> = [];

		if (isDaily) {
			for (const interval of intervals) {
				// Check exact duplicate daily template (only if not replacing existing grid)
				const isDuplicate = !replaceExisting && existingSlots.some(
					(s) =>
						s.isDaily &&
						s.startTime === interval.startTime &&
						s.endTime === interval.endTime &&
						(resourceId ? String(s.resourceId ?? "") === String(resourceId) : !s.resourceId),
				);

				if (isDuplicate) {
					conflicts.push({
						startTime: interval.startTime,
						endTime: interval.endTime,
						reason: "Daily template already exists for this time window",
					});
					continue;
				}

				// Check overlap for dedicated resource (only if not replacing existing grid)
				if (resourceId && !replaceExisting) {
					const isOverlap = existingSlots.some((s) => {
						if (!s.isDaily || String(s.resourceId ?? "") !== String(resourceId)) return false;
						const exS = timeToMinutes(s.startTime);
						const exE = timeToMinutes(s.endTime);
						return exS !== null && exE !== null && isIntervalOverlapping(interval.startMin, interval.endMin, exS, exE);
					});

					if (isOverlap) {
						conflicts.push({
							startTime: interval.startTime,
							endTime: interval.endTime,
							reason: "Overlaps with an existing daily slot for this resource",
						});
						continue;
					}
				}

				toCreate.push({
					locationId,
					resourceType,
					resourceId,
					durationMinutes: slotDurationMinutes,
					isDaily: true,
					date: null,
					startTime: interval.startTime,
					endTime: interval.endTime,
					capacity,
					remainingCapacity: capacity,
					isBooked: false,
					parentTemplate: null,
				});
			}
		} else {
			// Dated slots generation across date range
			if (!dateFrom || !dateTo) {
				res.status(400).json({ message: "dateFrom and dateTo are required for dated generation" });
				return;
			}

			const startDate = new Date(dateFrom);
			const endDate = new Date(dateTo);
			const allowedDays = daysOfWeek && daysOfWeek.length > 0 ? new Set(daysOfWeek) : null;

			const current = new Date(startDate);
			while (current <= endDate) {
				const dayOfWeek = current.getUTCDay();
				if (!allowedDays || allowedDays.has(dayOfWeek)) {
					const dayStart = normalizeToUtcDayStart(current);
					const dateStr = current.toISOString().slice(0, 10);

					for (const interval of intervals) {
						const isDuplicate = existingSlots.some((s) => {
							if (s.isDaily || !s.date) return false;
							const sDate = s.date.toISOString().slice(0, 10);
							return (
								sDate === dateStr &&
								s.startTime === interval.startTime &&
								s.endTime === interval.endTime &&
								(resourceId ? String(s.resourceId ?? "") === String(resourceId) : !s.resourceId)
							);
						});

						if (isDuplicate) {
							conflicts.push({
								date: dateStr,
								startTime: interval.startTime,
								endTime: interval.endTime,
								reason: "Slot already exists for this date and time",
							});
							continue;
						}

						if (resourceId) {
							const isOverlap = existingSlots.some((s) => {
								if (s.isDaily || !s.date) return false;
								const sDate = s.date.toISOString().slice(0, 10);
								if (sDate !== dateStr || String(s.resourceId ?? "") !== String(resourceId)) return false;
								const exS = timeToMinutes(s.startTime);
								const exE = timeToMinutes(s.endTime);
								return exS !== null && exE !== null && isIntervalOverlapping(interval.startMin, interval.endMin, exS, exE);
							});

							if (isOverlap) {
								conflicts.push({
									date: dateStr,
									startTime: interval.startTime,
									endTime: interval.endTime,
									reason: "Overlaps with existing slot on this date",
								});
								continue;
							}
						}

						toCreate.push({
							locationId,
							resourceType,
							resourceId,
							durationMinutes: slotDurationMinutes,
							isDaily: false,
							date: dayStart,
							startTime: interval.startTime,
							endTime: interval.endTime,
							capacity,
							remainingCapacity: capacity,
							isBooked: false,
							parentTemplate: null,
						});
					}
				}
				current.setUTCDate(current.getUTCDate() + 1);
			}
		}

		if (dryRun) {
			res.status(200).json({
				dryRun: true,
				totalCalculated: intervals.length,
				proposedCount: toCreate.length,
				preview: toCreate,
				conflicts,
				conflictCount: conflicts.length,
			});
			return;
		}

		let createdSlots: any[] = [];
		if (toCreate.length > 0) {
			if (replaceExisting && isDaily) {
				const deleteQuery: Record<string, unknown> = {
					isDaily: true,
					parentTemplate: null,
					resourceType,
				};
				if (locationId) deleteQuery.locationId = locationId;
				if (resourceId) deleteQuery.resourceId = resourceId;
				const deletedTemplates = await Slot.find(deleteQuery).select("_id");
				const templateIds = deletedTemplates.map((t) => t._id);
				await Slot.deleteMany({ _id: { $in: templateIds } });
				await Slot.deleteMany({ parentTemplate: { $in: templateIds } });
			}
			createdSlots = await Slot.insertMany(toCreate);
		}

		res.status(201).json({
			message: `Successfully generated ${createdSlots.length} slots`,
			createdCount: createdSlots.length,
			created: createdSlots,
			conflicts,
			conflictCount: conflicts.length,
		});
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

	const rawResourceType = req.query.resourceType as string | undefined;
	const rawExpertType = req.query.expertType as string | undefined;
	const resourceType = resolveResourceType({
		resourceType: rawResourceType,
		expertType: rawExpertType,
	});

	const locationId = req.query.locationId as string | undefined;
	const resourceId = req.query.resourceId as string | undefined;

	try {
		const parsedDate = new Date(rawDate);
		const dayStart = normalizeToUtcDayStart(parsedDate);
		const dayEnd = normalizeToUtcDayEnd(parsedDate);

		const baseFilter: Record<string, unknown> = {
			resourceType,
		};

		if (locationId && mongoose.Types.ObjectId.isValid(locationId)) {
			baseFilter.locationId = new mongoose.Types.ObjectId(locationId);
		}

		if (resourceId) {
			if (resourceId === "null" || resourceId === "pool") {
				baseFilter.resourceId = null;
			} else if (mongoose.Types.ObjectId.isValid(resourceId)) {
				baseFilter.resourceId = new mongoose.Types.ObjectId(resourceId);
			}
		}

		const concreteSlots = await Slot.find({
			...baseFilter,
			date: { $gte: dayStart, $lt: dayEnd },
			remainingCapacity: { $gt: 0 },
			isBooked: false,
		})
			.select(
				"_id date startTime endTime capacity remainingCapacity parentTemplate expertType resourceType resourceId locationId durationMinutes",
			)
			.sort({ startTime: 1 });

		const allConcreteForDay = await Slot.find({
			...baseFilter,
			date: { $gte: dayStart, $lt: dayEnd },
			parentTemplate: { $exists: true, $ne: null },
		}).select("parentTemplate startTime endTime");

		const templatesWithConcrete = new Set(
			allConcreteForDay.map(
				(s) =>
					`${s.parentTemplate?.toString() ?? ""}::${s.startTime}::${s.endTime}`,
			),
		);

		const dailyTemplates = await Slot.find({
			...baseFilter,
			isDaily: true,
			parentTemplate: null,
			capacity: { $gt: 0 },
			remainingCapacity: { $gt: 0 },
			isBooked: false,
		})
			.select("_id startTime endTime capacity remainingCapacity expertType resourceType resourceId locationId durationMinutes")
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
				expertType: t.expertType,
				resourceType: t.resourceType,
				resourceId: t.resourceId ? t.resourceId.toString() : null,
				locationId: t.locationId ? t.locationId.toString() : null,
				durationMinutes: t.durationMinutes ?? calculateDurationMinutes(t.startTime, t.endTime),
				startTime: t.startTime,
				endTime: t.endTime,
				capacity: t.capacity,
				remainingCapacity: Math.min(t.capacity, t.remainingCapacity),
				parentTemplate: null as string | null,
			}));

		const concreteRows = concreteSlots.map((s) => ({
			slotId: s._id,
			date: s.date,
			expertType: s.expertType,
			resourceType: s.resourceType,
			resourceId: s.resourceId ? s.resourceId.toString() : null,
			locationId: s.locationId ? s.locationId.toString() : null,
			durationMinutes: s.durationMinutes ?? calculateDurationMinutes(s.startTime, s.endTime),
			startTime: s.startTime,
			endTime: s.endTime,
			capacity: s.capacity,
			remainingCapacity: s.remainingCapacity,
			parentTemplate: s.parentTemplate ? s.parentTemplate.toString() : null,
		}));

		// Scoped grouping key by resourceType, resourceId, and time window
		const grouped = new Map<string, (typeof concreteRows)[number]>();

		for (const row of [...concreteRows, ...templateRows]) {
			const resIdStr = row.resourceId ?? "pool";
			const locIdStr = row.locationId ?? "any";
			const key = `${row.resourceType}::${locIdStr}::${resIdStr}::${row.startTime}::${row.endTime}`;
			const existing = grouped.get(key);
			if (!existing || row.remainingCapacity > existing.remainingCapacity) {
				grouped.set(key, row);
			}
		}

		const slots = Array.from(grouped.values()).sort((a, b) => {
			const aStart = timeToMinutes(a.startTime) ?? 0;
			const bStart = timeToMinutes(b.startTime) ?? 0;
			return aStart - bStart;
		});

		res.status(200).json({ date: dayStart, slots });
	} catch (error) {
		next(error);
	}
};

export const getAllSlots: RequestHandler = async (req, res, next) => {
	try {
		const query: Record<string, unknown> = {};

		if (req.query.locationId && mongoose.Types.ObjectId.isValid(req.query.locationId as string)) {
			query.locationId = new mongoose.Types.ObjectId(req.query.locationId as string);
		}

		if (req.query.resourceType) {
			const rType = resolveResourceType({ resourceType: req.query.resourceType as string });
			query.resourceType = rType;
		} else if (req.query.expertType) {
			const rType = resolveResourceType({ expertType: req.query.expertType as string });
			query.resourceType = rType;
		}

		if (req.query.resourceId) {
			if (req.query.resourceId === "null" || req.query.resourceId === "pool") {
				query.resourceId = null;
			} else if (mongoose.Types.ObjectId.isValid(req.query.resourceId as string)) {
				query.resourceId = new mongoose.Types.ObjectId(req.query.resourceId as string);
			}
		}

		if (req.query.isDaily !== undefined) {
			query.isDaily = req.query.isDaily === "true";
		}

		if (req.query.date) {
			const parsed = new Date(req.query.date as string);
			if (!isNaN(parsed.getTime())) {
				const start = normalizeToUtcDayStart(parsed);
				const end = normalizeToUtcDayEnd(parsed);
				query.date = { $gte: start, $lt: end };
			}
		}

		const slots = await Slot.find(query)
			.populate("locationId", "name address")
			.sort({ isDaily: -1, date: 1, startTime: 1 });

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
		const slot = await Slot.findById(id).populate("locationId", "name address");

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

		const updatePayload: Record<string, unknown> = {
			isBooked: effectiveRemainingCapacity <= 0,
		};

		if (parsedBody.data.locationId !== undefined) {
			updatePayload.locationId = parsedBody.data.locationId
				? new mongoose.Types.ObjectId(parsedBody.data.locationId)
				: null;
		}
		if (parsedBody.data.resourceType !== undefined) {
			updatePayload.resourceType = parsedBody.data.resourceType;
		}
		if (parsedBody.data.resourceId !== undefined) {
			updatePayload.resourceId = parsedBody.data.resourceId
				? new mongoose.Types.ObjectId(parsedBody.data.resourceId)
				: null;
		}
		if (parsedBody.data.expertType !== undefined) {
			updatePayload.expertType = parsedBody.data.expertType;
			if (parsedBody.data.expertType === ExpertType.SportsScientist) {
				updatePayload.resourceType = SlotResourceType.SPORTS_SCIENTIST;
			} else if (parsedBody.data.expertType === ExpertType.Nutritionist) {
				updatePayload.resourceType = SlotResourceType.NUTRITIONIST;
			}
		}
		if (parsedBody.data.startTime !== undefined) {
			updatePayload.startTime = parsedBody.data.startTime;
		}
		if (parsedBody.data.endTime !== undefined) {
			updatePayload.endTime = parsedBody.data.endTime;
		}
		if (parsedBody.data.capacity !== undefined) {
			updatePayload.capacity = parsedBody.data.capacity;
		}
		if (parsedBody.data.remainingCapacity !== undefined) {
			updatePayload.remainingCapacity = parsedBody.data.remainingCapacity;
		}
		if (parsedBody.data.isDaily !== undefined) {
			updatePayload.isDaily = parsedBody.data.isDaily;
		}
		if (parsedBody.data.date !== undefined) {
			updatePayload.date = effectiveIsDaily ? null : parsedBody.data.date;
		} else if (effectiveIsDaily) {
			updatePayload.date = null;
		}

		const effectiveStartTime = (updatePayload.startTime as string) || existingSlot.startTime;
		const effectiveEndTime = (updatePayload.endTime as string) || existingSlot.endTime;
		updatePayload.durationMinutes = calculateDurationMinutes(effectiveStartTime, effectiveEndTime);

		const updatedSlot = await Slot.findByIdAndUpdate(
			id,
			updatePayload,
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

		// Also clean up any children if this was a parent template
		if (deletedSlot.isDaily && !deletedSlot.parentTemplate) {
			await Slot.deleteMany({ parentTemplate: deletedSlot._id });
		}

		res.status(200).json({ message: "Slot deleted" });
	} catch (error) {
		next(error);
	}
};

export const bulkDeleteSlots: RequestHandler = async (req, res, next) => {
	const parsedBody = bulkDeleteSlotsBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid bulk delete payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	try {
		const { slotIds } = parsedBody.data;
		const validIds = slotIds
			.filter((id) => mongoose.Types.ObjectId.isValid(id))
			.map((id) => new mongoose.Types.ObjectId(id));

		if (validIds.length === 0) {
			res.status(400).json({ message: "No valid slot IDs provided" });
			return;
		}

		const result = await Slot.deleteMany({ _id: { $in: validIds } });
		// Also clean up any children if any deleted slots were parent templates
		await Slot.deleteMany({ parentTemplate: { $in: validIds } });

		res.status(200).json({
			message: `Successfully deleted ${result.deletedCount} slots`,
			deletedCount: result.deletedCount,
		});
	} catch (error) {
		next(error);
	}
};

export const bulkUpdateSlots: RequestHandler = async (req, res, next) => {
	const parsedBody = bulkUpdateSlotsBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid bulk update payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	try {
		const { slotIds, capacity } = parsedBody.data;
		const validIds = slotIds
			.filter((id) => mongoose.Types.ObjectId.isValid(id))
			.map((id) => new mongoose.Types.ObjectId(id));

		if (validIds.length === 0) {
			res.status(400).json({ message: "No valid slot IDs provided" });
			return;
		}

		const updatePayload: Record<string, unknown> = {};
		if (capacity !== undefined) {
			updatePayload.capacity = capacity;
			updatePayload.remainingCapacity = capacity;
		}

		if (Object.keys(updatePayload).length === 0) {
			res.status(400).json({ message: "No update fields provided" });
			return;
		}

		const result = await Slot.updateMany({ _id: { $in: validIds } }, updatePayload);

		res.status(200).json({
			message: `Successfully updated ${result.modifiedCount} slots`,
			modifiedCount: result.modifiedCount,
		});
	} catch (error) {
		next(error);
	}
};
