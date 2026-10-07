import type { RequestHandler } from "express";
import type { AppUserRole } from "../types/auth";
import { isStaffRbacEnforced } from "../utils/staff-rbac";

export function normalizeRole(role: AppUserRole): string {
	// FX-17.7 — the ROLE_FRONT_DESK_STAFF alias historically collapsed to
	// "admin", so front-desk staff passed every authorize(["admin"]) guard.
	// Under enforcement they become plain "frontdesk" and are refused admin-only
	// routes by the server. Flag off keeps the legacy behaviour (rollback).
	if (role === "ROLE_FRONT_DESK_STAFF") {
		return isStaffRbacEnforced() ? "frontdesk" : "admin";
	}
	if (role === "admin") return "admin";
	if (role === "frontdesk" || role === "staff" || role === "ROLE_FRONT_END_STAFF")
		return "frontdesk";
	if (role === "user" || role === "ROLE_MEMBER") return "user";
	if ((role as string) === "sports-scientist") return "sports_scientist";
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

