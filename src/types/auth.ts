export const ROLE_FRONT_DESK_STAFF = "admin" as const;
export const ROLE_FRONT_END_STAFF = "frontdesk" as const;
export const ROLE_MEMBER = "user" as const;

export type AppUserRole =
	| "user"
	| "admin"
	| "trainer"
	| "nutritionist"
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
};
