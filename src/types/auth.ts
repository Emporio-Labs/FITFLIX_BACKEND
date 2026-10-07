export const ROLE_FRONT_DESK_STAFF = "admin" as const;
export const ROLE_FRONT_END_STAFF = "frontdesk" as const;
export const ROLE_MEMBER = "user" as const;

export type AppUserRole =
	| "user"
	| "admin"
	| "trainer"
	| "nutritionist"
	| "sports_scientist"
	| "frontdesk"
	| "doctor"
	| "staff"
	| "ROLE_FRONT_DESK_STAFF"
	| "ROLE_FRONT_END_STAFF"
	| "ROLE_MEMBER";

export type AuthenticatedUser = {
	id: string;
	email: string;
	role: AppUserRole;
	// FX-31 — the scoped-console sub-role carried alongside the API role. For an
	// Admin-family account the API `role` stays "admin" while this holds e.g.
	// "manager" or "sales" so the staff web app can route to the right workspace.
	// null/absent = no sub-role (full admin, or an ordinary account).
	staffRole?: string | null;
};
