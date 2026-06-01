import type { RequestHandler } from "express";
import Invoice from "../models/Invoice";
import Lead from "../models/Lead";
import Membership from "../models/Membership";
import User from "../models/User";
import { MembershipStatus } from "../models/Enums";

export const getDashboardMetrics: RequestHandler = async (_req, res, next) => {
	try {
		const thirtyDaysAgo = new Date();
		thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

		const [
			leadsByStatus,
			invoicesByStatus,
			invoiceTotals,
			activeMembershipCount,
			totalUserCount,
			recentLeadCount,
		] = await Promise.all([
			Lead.aggregate([
				{ $group: { _id: "$status", count: { $sum: 1 } } },
				{ $sort: { count: -1 } },
			]),
			Invoice.aggregate([
				{ $group: { _id: "$paymentStatus", count: { $sum: 1 } } },
			]),
			Invoice.aggregate([
				{
					$group: {
						_id: "$paymentStatus",
						total: { $sum: "$total" },
					},
				},
			]),
			Membership.countDocuments({ status: MembershipStatus.Active }),
			User.countDocuments(),
			Lead.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
		]);

		res.status(200).json({
			leads: {
				byStatus: Object.fromEntries(
					leadsByStatus.map((s) => [s._id ?? "unknown", s.count]),
				),
				recentCount: recentLeadCount,
			},
			invoices: {
				byStatus: Object.fromEntries(
					invoicesByStatus.map((s) => [s._id ?? "unknown", s.count]),
				),
				totalsByStatus: Object.fromEntries(
					invoiceTotals.map((s) => [s._id ?? "unknown", s.total]),
				),
			},
			memberships: {
				activeCount: activeMembershipCount,
			},
			users: {
				totalCount: totalUserCount,
			},
		});
	} catch (error) {
		next(error);
	}
};
