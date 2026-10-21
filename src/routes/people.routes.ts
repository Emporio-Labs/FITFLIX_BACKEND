import { Router } from "express";
import { lookupPeople } from "../controllers/people.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const peopleRouter = Router();

peopleRouter.use(authenticateToken);

peopleRouter.get("/lookup", authorize(["admin", "frontdesk"]), lookupPeople);

export default peopleRouter;
