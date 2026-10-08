import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { MembershipStatus } from "../models/Enums";
import Invoice from "../models/Invoice";
import Lead from "../models/Lead";
import Membership from "../models/Membership";
import User from "../models/User";
import { scopedLocationFilter } from "../utils/location.resolver";

export const getDashboardMetrics: RequestHandler = async (req, res, next) => {
	try {
		const thirtyDaysAgo = new Date();
		thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

		// FX-18.1 — branch scope. A scoped staffer's dashboard counts only their
		// branches; a global admin (or enforcement off) sees everything. Honour an
		// explicit selected branch from ?locationId or the X-Location-Id header.
		const headerLocationId = req.header("x-location-id");
		const rawExplicit =
			(typeof req.query.locationId === "string" && req.query.locationId) ||
			(headerLocationId && headerLocationId.trim()) ||
			undefined;
		const explicitLocationId =
			rawExplicit && mongoose.Types.ObjectId.isValid(rawExplicit)
				? rawExplicit
				: undefined;
		// Entities carry the branch on `locationId`; members on `homeLocationId`.
		const branchMatch = scopedLocationFilter(
			req.allowedBranchIds,
			explicitLocationId,
		);
		const userBranchMatch = scopedLocationFilter(
			req.allowedBranchIds,
			explicitLocationId,
			"homeLocationId",
		);
		// Only prepend a $match stage when there is actually something to scope.
		const branchStage =
			Object.keys(branchMatch).length > 0 ? [{ $match: branchMatch }] : [];

		const [
			leadsByStatus,
			invoicesByStatus,
			invoiceTotals,
			activeMembershipCount,
			totalUserCount,
			recentLeadCount,
		] = await Promise.all([
			Lead.aggregate([
				...branchStage,
				{ $group: { _id: "$status", count: { $sum: 1 } } },
				{ $sort: { count: -1 } },
			]),
			Invoice.aggregate([
				...branchStage,
				{ $group: { _id: "$paymentStatus", count: { $sum: 1 } } },
			]),
			Invoice.aggregate([
				...branchStage,
				{
					$group: {
						_id: "$paymentStatus",
						total: { $sum: "$total" },
					},
				},
			]),
			Membership.countDocuments({
				...branchMatch,
				status: MembershipStatus.Active,
			}),
			User.countDocuments(userBranchMatch),
			Lead.countDocuments({
				...branchMatch,
				createdAt: { $gte: thirtyDaysAgo },
			}),
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
