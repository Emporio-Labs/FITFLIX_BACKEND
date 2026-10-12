import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { NotificationChannel, NotificationKind } from "../models/Enums";
import MemberNotification from "../models/MemberNotification";
import Notification from "../models/Notification";
import { getValidationDetails } from "../services/nutrition/nutrition-errors";
import {
	readExplicitLocationId,
	resolveLocationId,
	scopedLocationFilter,
} from "../utils/location.resolver";
import {
	type ClubNotificationAudience,
	resolveClubRecipientIds,
} from "../utils/member-audience";
import {
	listMemberNotificationsQuerySchema,
	sendMemberNotificationSchema,
} from "../validators/member-notification.validator";

/**
 * FX-20.3 — the staff "Sent" history.
 *
 * Branch-scoped by `scopedLocationFilter` (and the X-Location-Id / ?locationId
 * picker): a global admin sees every broadcast, a branch-scoped staffer sees
 * their branch's. Newest first, paginated so the list never grows unbounded.
 */
export const listMemberNotifications: RequestHandler = async (req, res, next) => {
	try {
		const parsed = listMemberNotificationsQuerySchema.safeParse(req.query);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: getValidationDetails(parsed.error.issues),
			});
			return;
		}

		const { page, limit, locationId } = parsed.data;
		const filter = scopedLocationFilter(
			req.allowedBranchIds,
			locationId ?? readExplicitLocationId(req),
		);

		const [items, total] = await Promise.all([
			MemberNotification.find(filter)
				.sort({ createdAt: -1 })
				.skip((page - 1) * limit)
				.limit(limit),
			MemberNotification.countDocuments(filter),
		]);

		res.status(200).json({
			items,
			pagination: {
				page,
				limit,
				total,
				totalPages: Math.max(1, Math.ceil(total / limit)),
			},
		});
	} catch (error) {
		next(error);
	}
};

/**
 * FX-20.3 — send a club broadcast.
 *
 * `locationId` null is company-wide; a concrete id is validated against the
 * live Location set (existence + active) and reaches only that club's members.
 * Recipients are resolved from the home club + audience, stored as
 * `recipientCount`, and fanned out into the in-app Notification inbox so the
 * message actually lands with exactly those members.
 */
export const sendMemberNotification: RequestHandler = async (req, res, next) => {
	try {
		const parsed = sendMemberNotificationSchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: getValidationDetails(parsed.error.issues),
			});
			return;
		}

		const { title, body } = parsed.data;
		const audience = parsed.data.audience as ClubNotificationAudience;

		// Null locationId = company-wide. A concrete id must resolve to an active
		// branch (resolveLocationId throws LocationError -> 400/404 via the global
		// handler). A branch-scoped staffer cannot broadcast company-wide.
		let locationId: mongoose.Types.ObjectId | null = null;
		if (parsed.data.locationId) {
			locationId = await resolveLocationId(parsed.data.locationId);
		} else if (req.allowedBranchIds != null) {
			res.status(400).json({
				error: "Pick a club to notify — company-wide broadcasts are admin-only.",
				code: "LOCATION_REQUIRED",
			});
			return;
		}

		const recipientIds = await resolveClubRecipientIds({
			locationId: locationId ? String(locationId) : null,
			audience,
		});

		const senderId =
			req.user?.id && mongoose.Types.ObjectId.isValid(req.user.id)
				? new mongoose.Types.ObjectId(req.user.id)
				: null;

		const notification = await MemberNotification.create({
			title,
			body,
			audience,
			locationId,
			sentById: senderId,
			sentBy: req.user?.email || "Staff",
			recipientCount: recipientIds.length,
		});

		// Fan out to the in-app inbox. Best-effort: the broadcast row is the source
		// of truth for the Sent history and recipient count, so a delivery hiccup
		// must not fail the send. One bulk insert, unordered, to keep it cheap.
		if (recipientIds.length > 0) {
			try {
				await Notification.insertMany(
					recipientIds.map((userId) => ({
						userId,
						kind: NotificationKind.ClubAnnouncement,
						title,
						body,
						data: {
							memberNotificationId: String(notification._id),
							locationId: locationId ? String(locationId) : null,
							audience,
						},
						channels: [NotificationChannel.InApp],
					})),
					{ ordered: false },
				);
			} catch (fanOutError) {
				console.error(
					"[member-notifications] inbox fan-out failed (broadcast still recorded):",
					fanOutError,
				);
			}
		}

		res.status(201).json({ message: "Notification sent", notification });
	} catch (error) {
		next(error);
	}
};
