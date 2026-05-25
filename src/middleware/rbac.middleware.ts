import type { RequestHandler } from "express";
import type { AppUserRole } from "../types/auth";

export const authorize = (allowedRoles: AppUserRole[]): RequestHandler => {
	return (req, res, next) => {
		if (!req.user) {
			res.status(401).json({ message: "Unauthorized" });
			return;
		}

		if (!allowedRoles.includes(req.user.role)) {
			console.warn("[RBAC] Forbidden", {
				path: req.originalUrl,
				method: req.method,
				userRole: req.user.role,
				userId: req.user.id,
				allowedRoles,
			});
			res.status(403).json({ message: "Forbidden" });
			return;
		}

		next();
	};
};
