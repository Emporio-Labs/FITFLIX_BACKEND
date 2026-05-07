import { Router } from "express";
import {
	getMyCreditBalance,
	getMyCreditHistory,
	getUserCreditBalanceById,
	getUserCreditHistoryById,
	topUpUserCreditsById,
} from "../controllers/credit.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const creditRouter = Router();

creditRouter.use(authenticateToken);

creditRouter.get("/me/balance", authorize(["user"]), getMyCreditBalance);
creditRouter.get("/me/history", authorize(["user"]), getMyCreditHistory);
creditRouter.get(
	"/users/:userId/balance",
	authorize(["admin"]),
	getUserCreditBalanceById,
);
creditRouter.get(
	"/users/:userId/history",
	authorize(["admin"]),
	getUserCreditHistoryById,
);
creditRouter.post(
	"/users/:userId/topup",
	authorize(["admin"]),
	topUpUserCreditsById,
);

export default creditRouter;
