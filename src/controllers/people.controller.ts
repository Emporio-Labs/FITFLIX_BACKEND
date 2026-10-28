import type { RequestHandler } from "express";
import type mongoose from "mongoose";
import { LeadStatus, MembershipStatus } from "../models/Enums";
import Invoice from "../models/Invoice";
import Lead from "../models/Lead";
import Membership from "../models/Membership";
import User from "../models/User";
import {
	OPEN_INVOICE_STATUSES,
	pendingInvoiceIdsByLead,
} from "../utils/lead-pending-invoice";

type Id = mongoose.Types.ObjectId;

const RESULT_LIMIT = 10;

// A membership that still counts as the member's current one. "Upcoming"
// (sold, not yet started) is written as a literal until MembershipStatus
// gains it; matching a value no document has yet is harmless.
const CURRENT_MEMBERSHIP_STATUSES = [
	MembershipStatus.Active,
	MembershipStatus.Paused,
	"Upcoming",
];

const escapeRegex = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The search filter for `q`. Four or more digits (spaces, +, -, brackets
 * allowed) is a phone search on the last 10 digits, so "+91 98765 43210" and
 * "98765" both find 9876543210. The digits may be split by separators in the
 * stored value — lead phones are saved as typed. Anything else is a
 * case-insensitive name/email search.
 */
const buildMatch = (q: string, nameField: string): Record<string, unknown> => {
	const digits = q.replace(/\D/g, "");
	if (/^[\d\s+()-]+$/.test(q) && digits.length >= 4) {
		const pattern = digits.slice(-10).split("").join("\\D*");
		return { phone: { $regex: pattern } };
	}
	const rx = { $regex: escapeRegex(q), $options: "i" };
	return { $or: [{ [nameField]: rx }, { email: rx }] };
};

/**
 * GET /people/lookup?q= — the New sale stepper's first step: is this person
 * already a member, a lead, or someone with an unpaid invoice? Searches every
 * branch, since a member of one branch may be buying at another.
 */
export const lookupPeople: RequestHandler = async (req, res, next) => {
	const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
	if (q.length < 2 || q.length > 100) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: {
				q: "Enter 2 to 100 characters: a phone number, name or email",
			},
		});
		return;
	}

	try {
		const [users, leads] = await Promise.all([
			User.find(buildMatch(q, "username"))
				.select("username phone email homeLocationId")
				.sort({ updatedAt: -1 })
				.limit(RESULT_LIMIT)
				.lean<
					Array<{
						_id: Id;
						username: string;
						phone: string;
						email?: string;
						homeLocationId?: Id | null;
					}>
				>(),
			// A converted lead is a member now; the member row stands for them.
			Lead.find({
				...buildMatch(q, "leadName"),
				status: { $ne: LeadStatus.Converted },
			})
				.select("leadName phone email status locationId interestedIn")
				.sort({ updatedAt: -1 })
				.limit(RESULT_LIMIT)
				.lean<
					Array<{
						_id: Id;
						leadName: string;
						phone?: string;
						email?: string;
						status: string;
						locationId?: Id | null;
						interestedIn?: string;
					}>
				>(),
		]);

		const userIds = users.map((u) => u._id);
		const leadIds = leads.map((l) => l._id);

		const [currentRows, pendingByLead, pendingInvoices] = await Promise.all([
			userIds.length === 0
				? []
				: Membership.aggregate<{
						_id: Id;
						membership: {
							_id: Id;
							planId?: Id | null;
							planName: string;
							status: string;
							startDate: Date;
							endDate?: Date | null;
							locationId?: Id | null;
						};
					}>([
						{
							$match: {
								user: { $in: userIds },
								status: { $in: CURRENT_MEMBERSHIP_STATUSES },
							},
						},
						{ $sort: { endDate: -1 } },
						{ $group: { _id: "$user", membership: { $first: "$$ROOT" } } },
					]),
			pendingInvoiceIdsByLead(leadIds),
			userIds.length === 0 && leadIds.length === 0
				? []
				: Invoice.find({
						paymentStatus: { $in: OPEN_INVOICE_STATUSES },
						$or: [{ userId: { $in: userIds } }, { leadId: { $in: leadIds } }],
					})
						.select("invoiceNumber total userId leadId locationId")
						.sort({ createdAt: -1 })
						.limit(RESULT_LIMIT)
						.lean<
							Array<{
								_id: Id;
								invoiceNumber: string;
								total: number;
								userId?: Id | null;
								leadId?: Id | null;
								locationId?: Id | null;
							}>
						>(),
		]);

		const currentByUser = new Map(
			currentRows.map((r) => [String(r._id), r.membership]),
		);

		res.status(200).json({
			members: users.map((u) => {
				const m = currentByUser.get(String(u._id));
				return {
					_id: u._id,
					username: u.username,
					phone: u.phone,
					email: u.email ?? null,
					homeLocationId: u.homeLocationId ?? null,
					currentMembership: m
						? {
								_id: m._id,
								planId: m.planId ?? null,
								planName: m.planName,
								status: m.status,
								startDate: m.startDate,
								endDate: m.endDate ?? null,
								locationId: m.locationId ?? null,
							}
						: null,
				};
			}),
			leads: leads.map((l) => ({
				_id: l._id,
				name: l.leadName,
				phone: l.phone ?? "",
				email: l.email ?? "",
				status: l.status,
				locationId: l.locationId ?? null,
				interestedIn: l.interestedIn ?? "",
				pendingInvoiceId: pendingByLead.get(String(l._id)) ?? null,
			})),
			pendingInvoices: pendingInvoices.map((inv) => ({
				_id: inv._id,
				invoiceNumber: inv.invoiceNumber,
				total: inv.total,
				userId: inv.userId ?? null,
				leadId: inv.leadId ?? null,
				locationId: inv.locationId ?? null,
			})),
		});
	} catch (error) {
		next(error);
	}
};
