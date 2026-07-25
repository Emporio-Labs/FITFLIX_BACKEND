export type AppUserRole =
	| "user"
	| "admin"
	| "trainer"
	| "nutritionist"
	| "frontdesk";

export type AuthenticatedUser = {
	id: string;
	email: string;
	role: AppUserRole;
};
