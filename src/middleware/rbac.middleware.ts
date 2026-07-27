import type { RequestHandler } from "express";
import type { AppUserRole } from "../types/auth";

export function normalizeRole(role: AppUserRole): string {
	if (role === "admin" || role === "ROLE_FRONT_DESK_STAFF") return "admin";
	if (role === "frontdesk" || role === "staff" || role === "ROLE_FRONT_END_STAFF")
		return "frontdesk";
	if (role === "user" || role === "ROLE_MEMBER") return "user";
	return role;
}

export const authorize = (allowedRoles: AppUserRole[]): RequestHandler => {
	return (req, res, next) => {
		if (!req.user) {
			res.status(401).json({ message: "Unauthorized" });
			return;
		}

		const userRole = normalizeRole(req.user.role);
		const normalizedAllowed = allowedRoles.map(normalizeRole);

		if (!normalizedAllowed.includes(userRole)) {
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
