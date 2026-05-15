import { Router } from "express";
import {
    createMembershipPlan,
    deleteMembershipPlanById,
    getAllMembershipPlans,
    getMembershipPlanById,
    updateMembershipPlanById,
} from "../controllers/membershipPlan.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const router = Router();

router.use(authenticateToken);
router.get("/", authorize(["admin", "user", "doctor", "trainer"]), getAllMembershipPlans);
router.get("/:id", authorize(["admin", "user", "doctor", "trainer"]), getMembershipPlanById);
router.post("/", authorize(["admin"]), createMembershipPlan);
router.patch("/:id", authorize(["admin"]), updateMembershipPlanById);
router.delete("/:id", authorize(["admin"]), deleteMembershipPlanById);

export default router;
