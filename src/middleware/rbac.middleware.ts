import type { RequestHandler } from "express";
import type { AppUserRole } from "../types/auth";

export const authorize = (allowedRoles: AppUserRole[]): RequestHandler => {
	return (req, res, next) => {
		if (!req.user) {
			res.status(401).json({ message: "Unauthorized" });
			return;
		}

		if (!allowedRoles.includes(req.user.role)) {
			res.status(403).json({ message: "Forbidden" });
			return;
		}

		next();
	};
};
