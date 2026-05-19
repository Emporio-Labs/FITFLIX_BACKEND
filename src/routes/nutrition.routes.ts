import { Router } from "express";
import {
	createCustomFood,
	createSystemFood,
	listFoods,
	patchFood,
	removeFood,
} from "../controllers/nutrition-food.controller";
import {
	getMyAdherence,
	getPlanAdherence,
	rebuildPlanAdherence,
} from "../controllers/nutrition-adherence.controller";
import {
	addHydrationIntake,
	getMyHydration,
	updateHydrationGoal,
} from "../controllers/nutrition-hydration.controller";
import {
	completePlanMeal,
	createMealLog,
	listMyMealLogs,
	patchMealLog,
	removeMealLog,
} from "../controllers/nutrition-meal-log.controller";
import {
	addMyProgress,
	addPlanProgressEntry,
	listMyProgress,
	listPlanProgress,
} from "../controllers/nutrition-progress.controller";
import {
	assignTemplate,
	changePlanStatus,
	createPlan,
	generatePlanPdfHandler,
	getMyPlanById,
	getPlanById,
	getPlanPdfHandler,
	listManagedPlans,
	listMyPlans,
	patchPlan,
} from "../controllers/nutrition-plan.controller";
import {
	createNutritionTemplate,
	deleteNutritionTemplate,
	getNutritionTemplate,
	listNutritionTemplates,
	updateNutritionTemplate,
} from "../controllers/nutrition-template.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const nutritionRouter = Router();

nutritionRouter.use(authenticateToken);

const STAFF = authorize(["nutritionist", "admin"]);
const USER = authorize(["user"]);
const ADMIN = authorize(["admin"]);

// ---- Admin ----
nutritionRouter.post("/admin/foods", ADMIN, createSystemFood);
nutritionRouter.post(
	"/admin/adherence/rebuild",
	ADMIN,
	rebuildPlanAdherence,
);

// ---- Food catalog ----
// Static/specific routes before parameterized ones.
nutritionRouter.get(
	"/foods",
	authorize(["nutritionist", "admin", "user"]),
	listFoods,
);
nutritionRouter.post("/foods", STAFF, createCustomFood);
nutritionRouter.patch("/foods/:id", STAFF, patchFood);
nutritionRouter.delete("/foods/:id", STAFF, removeFood);

// ---- Templates (nutritionist-owned) ----
nutritionRouter.post("/templates", STAFF, createNutritionTemplate);
nutritionRouter.get("/templates", STAFF, listNutritionTemplates);
nutritionRouter.get("/templates/:id", STAFF, getNutritionTemplate);
nutritionRouter.patch("/templates/:id", STAFF, updateNutritionTemplate);
nutritionRouter.delete("/templates/:id", STAFF, deleteNutritionTemplate);
nutritionRouter.post("/templates/:id/assign", STAFF, assignTemplate);

// ---- User-assigned plans (managed by nutritionist) ----
// User-scoped reads first so /my/* never collides with /plans/:id.
nutritionRouter.get("/my/plans", USER, listMyPlans);
nutritionRouter.get("/my/plans/:id", USER, getMyPlanById);
nutritionRouter.get("/my/plans/:id/pdf", USER, getPlanPdfHandler);
nutritionRouter.post(
	"/my/plans/:id/meals/complete",
	USER,
	completePlanMeal,
);

// ---- User meal logging ----
nutritionRouter.post("/my/meal-logs", USER, createMealLog);
nutritionRouter.get("/my/meal-logs", USER, listMyMealLogs);
nutritionRouter.patch("/my/meal-logs/:id", USER, patchMealLog);
nutritionRouter.delete("/my/meal-logs/:id", USER, removeMealLog);

// ---- User hydration ----
nutritionRouter.post("/my/hydration", USER, addHydrationIntake);
nutritionRouter.patch("/my/hydration/goal", USER, updateHydrationGoal);
nutritionRouter.get("/my/hydration", USER, getMyHydration);

// ---- User progress ----
nutritionRouter.post("/my/progress", USER, addMyProgress);
nutritionRouter.get("/my/progress", USER, listMyProgress);

// ---- Adherence ----
nutritionRouter.get("/my/adherence", USER, getMyAdherence);

nutritionRouter.post("/plans", STAFF, createPlan);
nutritionRouter.get("/plans", STAFF, listManagedPlans);
nutritionRouter.get("/plans/:id", STAFF, getPlanById);
nutritionRouter.patch("/plans/:id", STAFF, patchPlan);
nutritionRouter.patch("/plans/:id/status", STAFF, changePlanStatus);
nutritionRouter.post("/plans/:id/pdf", STAFF, generatePlanPdfHandler);
nutritionRouter.get("/plans/:id/adherence", STAFF, getPlanAdherence);
nutritionRouter.get("/plans/:id/progress", STAFF, listPlanProgress);
nutritionRouter.post("/plans/:id/progress", STAFF, addPlanProgressEntry);

export default nutritionRouter;
