import type { CommunityUser } from "../services/community/roleResolver";
import type { AuthenticatedUser } from "./auth";

declare global {
	namespace Express {
		interface Request {
			user?: AuthenticatedUser;
			// Effective community identity, attached by attachCommunityContext.
			communityUser?: CommunityUser;
		}
	}
}
