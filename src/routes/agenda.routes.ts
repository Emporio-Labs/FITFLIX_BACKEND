import { Router } from "express";
import {
	getMemberAgendaForStaffHandler,
	getMemberAgendaHandler,
} from "../controllers/agenda.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";

const agendaRouter = Router();

agendaRouter.use(authenticateToken);

agendaRouter.get("/me", getMemberAgendaHandler);
agendaRouter.get("/user/:userId", getMemberAgendaForStaffHandler);
agendaRouter.get("/", getMemberAgendaHandler);

export default agendaRouter;
