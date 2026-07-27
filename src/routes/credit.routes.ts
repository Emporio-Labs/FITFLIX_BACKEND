import { Router } from "express";
import {
	getCreditsBalance,
	getCreditsLedger,
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

creditRouter.get("/balance", authorize(["user", "admin"]), getCreditsBalance);
creditRouter.get("/ledger", authorize(["user", "admin"]), getCreditsLedger);
creditRouter.get("/me/balance", authorize(["user"]), getMyCreditBalance);
creditRouter.get("/me/history", authorize(["user"]), getMyCreditHistory);
creditRouter.get(
	"/users/:userId/balance",
	authorize(["admin", "user"]),
	getUserCreditBalanceById,
);
creditRouter.get(
	"/users/:userId/history",
	authorize(["admin", "user"]),
	getUserCreditHistoryById,
);
creditRouter.post(
	"/users/:userId/topup",
	authorize(["admin"]),
	topUpUserCreditsById,
);

export default creditRouter;
