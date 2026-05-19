export type AppUserRole =
	| "user"
	| "admin"
	| "doctor"
	| "trainer"
	| "nutritionist";

export type AuthenticatedUser = {
	id: string;
	email: string;
	role: AppUserRole;
};
