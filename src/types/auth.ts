export type AppUserRole =
	| "user"
	| "admin"
	| "doctor"
	| "trainer"
	| "nutritionist"
	| "frontdesk";

export type AuthenticatedUser = {
	id: string;
	email: string;
	role: AppUserRole;
};
