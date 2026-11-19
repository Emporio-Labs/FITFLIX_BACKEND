import { Router } from "express";
import {
	createSlot,
	deleteSlotById,
	getAllSlots,
	getAvailableSlots,
	getSlotById,
	updateSlotById,
} from "../controllers/slot.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const slotRouter = Router();

slotRouter.use(authenticateToken);
slotRouter.get(
	"/",
	authorize(["admin", "trainer", "nutritionist", "sports_scientist", "frontdesk", "manager", "user"]),
	getAllSlots,
);
slotRouter.get(
	"/available",
	authorize(["admin", "trainer", "nutritionist", "sports_scientist", "frontdesk", "manager", "user"]),
	getAvailableSlots,
);
slotRouter.get(
	"/:id",
	authorize(["admin", "trainer", "nutritionist", "sports_scientist", "frontdesk", "manager", "user"]),
	getSlotById,
);
slotRouter.post("/", authorize(["admin", "manager"]), createSlot);
slotRouter.patch("/:id", authorize(["admin", "manager"]), updateSlotById);
slotRouter.delete("/:id", authorize(["admin"]), deleteSlotById);

export default slotRouter;

