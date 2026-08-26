import { Router } from "express";
import {
	bulkDeleteSlots,
	bulkUpdateSlots,
	createSlot,
	deleteSlotById,
	generateSlots,
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
	authorize(["admin", "trainer", "user"]),
	getAllSlots,
);
slotRouter.get(
	"/available",
	authorize(["admin", "trainer", "user"]),
	getAvailableSlots,
);
slotRouter.get(
	"/:id",
	authorize(["admin", "trainer", "user"]),
	getSlotById,
);
slotRouter.post("/generate", authorize(["admin"]), generateSlots);
slotRouter.post("/bulk-delete", authorize(["admin"]), bulkDeleteSlots);
slotRouter.post("/bulk-update", authorize(["admin"]), bulkUpdateSlots);
slotRouter.post("/", authorize(["admin"]), createSlot);
slotRouter.patch("/:id", authorize(["admin"]), updateSlotById);
slotRouter.delete("/:id", authorize(["admin"]), deleteSlotById);

export default slotRouter;
