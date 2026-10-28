import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Trainer from "../models/Trainer";
import { normalizeRole } from "./rbac.middleware";

/**
 * Admins and front desk always work leads. A trainer only when an admin has
 * switched on `Trainer.canAccessLeads` — read live, so revoking it applies
 * on the trainer's next request, not their next login.
 */
export const requireLeadAccess: RequestHandler = async (req, res, next) => {
	if (!req.user || normalizeRole(req.user.role) !== "trainer") {
		next();
		return;
	}
	try {
		const allowed =
			mongoose.Types.ObjectId.isValid(req.user.id) &&
			Boolean(
				(await Trainer.findById(req.user.id).select("canAccessLeads").lean())
					?.canAccessLeads,
			);
		if (!allowed) {
			res.status(403).json({
				message: "An admin hasn't given you access to leads",
				code: "LEAD_ACCESS_DENIED",
			});
			return;
		}
		next();
	} catch (error) {
		next(error);
	}
};
