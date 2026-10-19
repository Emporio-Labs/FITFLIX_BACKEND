import z from "zod";
import { MEMBER_NOTIFICATION_AUDIENCES } from "../models/MemberNotification";

const objectId = z
	.string()
	.trim()
	.regex(/^[a-fA-F0-9]{24}$/, "Invalid location id");

const audience = z
	.enum(MEMBER_NOTIFICATION_AUDIENCES as unknown as [string, ...string[]])
	.default("all");

/**
 * FX-20.3 — composing a club broadcast. `locationId` null / omitted / "" is a
 * company-wide send; a concrete id targets one club (its existence + active
 * state are checked in the controller via resolveLocationId).
 */
export const sendMemberNotificationSchema = z.object({
	title: z.string().trim().min(1, "Title is required").max(140),
	body: z.string().trim().min(1, "Message is required").max(2000),
	locationId: z.preprocess(
		(v) => (v === "" || v === "none" ? null : v),
		objectId.nullable().optional(),
	),
	audience,
});

export const listMemberNotificationsQuerySchema = z.object({
	locationId: objectId.optional(),
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type SendMemberNotificationBody = z.infer<
	typeof sendMemberNotificationSchema
>;
export type ListMemberNotificationsQuery = z.infer<
	typeof listMemberNotificationsQuerySchema
>;
