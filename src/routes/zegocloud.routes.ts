import { Router } from "express";
import {
	getRoomCredentialsHandler,
	getZegocloudConfigHandler,
} from "../controllers/zegocloud.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";

const zegocloudRouter = Router();

zegocloudRouter.use(authenticateToken);

zegocloudRouter.get("/config", getZegocloudConfigHandler);
zegocloudRouter.post("/room-credentials", getRoomCredentialsHandler);

export default zegocloudRouter;
