import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { normalizeRole } from "../middleware/rbac.middleware";
import { MembershipStatus } from "../models/Enums";
import Invoice from "../models/Invoice";
import Lead from "../models/Lead";
import Location from "../models/Location";
import Membership from "../models/Membership";
import User from "../models/User";
import { getBranchBoardData } from "../services/branch-board.service";

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

/**
 * FX-43.1 & FX-43.4: Multi-Branch Operations Board Handler.
 * - Admin: sees all active branches (or filters by ?branchId=).
 * - Manager / Frontdesk: only sees their own branch (user.homeLocationId).
 */
export const getBranchBoardMetricsHandler: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const user = req.user;
		if (!user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}

		let branchIds: Array<string | mongoose.Types.ObjectId> | undefined;
		const userRole = normalizeRole(user.role);

		if (userRole === "admin") {
			// Admin can view all branches, or filter by ?branchId=
			const requestedBranchId = req.query.branchId;
			if (
				typeof requestedBranchId === "string" &&
				mongoose.Types.ObjectId.isValid(requestedBranchId)
			) {
				branchIds = [requestedBranchId];
			}
		} else if (userRole === "frontdesk") {
			// FX-43.4: Managers get the view for their own branch only
			const dbUser = await User.findById(user.id).select("homeLocationId").lean();
			const managerBranchId = dbUser?.homeLocationId;

			if (managerBranchId) {
				branchIds = [managerBranchId];
			} else {
				const defaultBranch = await Location.findOne({ isActive: true })
					.select("_id")
					.lean();
				if (defaultBranch) {
					branchIds = [defaultBranch._id];
				} else {
					res.status(200).json({ asOf: new Date().toISOString(), branches: [] });
					return;
				}
			}
		} else {
			res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
			return;
		}

		const requestedTimeframe = req.query.timeframe === "all" ? "all" : "today";
		const data = await getBranchBoardData(
			branchIds,
			new Date(),
			requestedTimeframe,
		);
		res.status(200).json(data);
	} catch (error) {
		next(error);
	}
};

