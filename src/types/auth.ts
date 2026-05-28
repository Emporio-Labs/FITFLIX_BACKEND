export type AppUserRole = "user" | "admin" | "doctor" | "trainer" | "frontdesk";

export type AuthenticatedUser = {
	id: string;
	email: string;
	role: AppUserRole;
};
