import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Notification from "../models/Notification";
import type { AuthenticatedUser } from "../types/auth";
import { registerFcmToken } from "../services/fcm.service";

const getIdParam = (v: unknown): string | null => {
	if (typeof v !== "string" || !mongoose.Types.ObjectId.isValid(v)) return null;
	return v;
};

export const listNotifications: RequestHandler = async (req, res, next) => {
	const user = req.user as AuthenticatedUser | undefined;
	if (!user) {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}

	try {
		const page = Math.max(1, Number(req.query.page ?? 1));
		const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));
		const skip = (page - 1) * limit;

		const [notifications, total, unread] = await Promise.all([
			Notification.find({ userId: user.id })
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(limit)
				.lean(),
			Notification.countDocuments({ userId: user.id }),
			Notification.countDocuments({ userId: user.id, readAt: null }),
		]);

		res.status(200).json({
			notifications,
			unread,
			pagination: { total, page, limit, pages: Math.ceil(total / limit) },
		});
	} catch (err) {
		next(err);
	}
};

export const markNotificationRead: RequestHandler = async (req, res, next) => {
	const user = req.user as AuthenticatedUser | undefined;
	if (!user) {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}

	const id = getIdParam(req.params.id);
	if (!id) {
		res.status(400).json({ error: "Invalid notification ID", code: "BAD_REQUEST" });
		return;
	}

	try {
		const notification = await Notification.findOneAndUpdate(
			{ _id: id, userId: user.id },
			{ $set: { readAt: new Date() } },
			{ returnDocument: "after" },
		);

		if (!notification) {
			res.status(404).json({ error: "Notification not found", code: "NOT_FOUND" });
			return;
		}

		res.status(200).json({ notification });
	} catch (err) {
		next(err);
	}
};

export const markAllRead: RequestHandler = async (req, res, next) => {
	const user = req.user as AuthenticatedUser | undefined;
	if (!user) {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}

	try {
		await Notification.updateMany(
			{ userId: user.id, readAt: null },
			{ $set: { readAt: new Date() } },
		);
		res.status(200).json({ message: "All notifications marked as read" });
	} catch (err) {
		next(err);
	}
};

export const registerToken: RequestHandler = async (req, res, next) => {
	const user = req.user as AuthenticatedUser | undefined;
	if (!user) {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}

	const { token, platform } = req.body as { token?: string; platform?: string };
	if (!token || !platform || !["ios", "android"].includes(platform)) {
		res.status(400).json({
			error: "token and platform (ios|android) are required",
			code: "VALIDATION_ERROR",
		});
		return;
	}

	try {
		await registerFcmToken(user.id, token, platform as "ios" | "android");
		res.status(200).json({ message: "FCM token registered" });
	} catch (err) {
		next(err);
	}
};
