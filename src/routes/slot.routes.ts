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
	authorize(["admin", "doctor", "trainer", "user"]),
	getAllSlots,
);
slotRouter.get(
	"/available",
	authorize(["admin", "doctor", "trainer", "user"]),
	getAvailableSlots,
);
slotRouter.get(
	"/:id",
	authorize(["admin", "doctor", "trainer", "user"]),
	getSlotById,
);
slotRouter.post("/", authorize(["admin"]), createSlot);
slotRouter.patch("/:id", authorize(["admin"]), updateSlotById);
slotRouter.delete("/:id", authorize(["admin"]), deleteSlotById);

export default slotRouter;
