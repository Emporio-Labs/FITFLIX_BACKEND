import type { AuthenticatedUser } from "./auth";

declare global {
	namespace Express {
		interface Request {
			user?: AuthenticatedUser;
			// Whose data this request operates on. Equals req.user.id for a
			// member acting on their own data, or the member's id when a
			// trainer/admin is acting on a member's behalf (e.g. PT logging).
			// Set by subjectIsSelf / subjectIsMember middleware.
			subjectUserId?: string;
		}
	}
}
