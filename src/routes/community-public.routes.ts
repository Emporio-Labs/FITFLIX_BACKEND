import { Router } from "express";
import {
	publicFeedHandler,
	publicPostDetailHandler,
	publicPostSearchHandler,
	publicShareLinkHandler,
	publicTrainerDetailHandler,
	publicTrainerListHandler,
	publicTrainerPostsHandler,
} from "../controllers/community-public.controller";
import { apiRateLimit } from "../middleware/rate-limit.middleware";

const communityPublicRouter = Router();

// Public/outsider surface. No authentication. Rate-limited to deter scraping.
communityPublicRouter.use(apiRateLimit);

communityPublicRouter.get("/feed", publicFeedHandler);
communityPublicRouter.get("/posts/search", publicPostSearchHandler);
communityPublicRouter.get("/posts/:id/share-link", publicShareLinkHandler);
communityPublicRouter.get("/posts/:id", publicPostDetailHandler);
communityPublicRouter.get("/trainers", publicTrainerListHandler);
communityPublicRouter.get("/trainers/:id/posts", publicTrainerPostsHandler);
communityPublicRouter.get("/trainers/:id", publicTrainerDetailHandler);

export default communityPublicRouter;
