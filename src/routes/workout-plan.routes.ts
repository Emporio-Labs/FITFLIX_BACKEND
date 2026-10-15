import { type RequestHandler, Router } from "express";
import multer from "multer";
import {
	assignPlan,
	completePlanDay,
	getAssignedWorkoutForDay,
	getAssignmentSchedule,
	getMyAssignment,
	getTodayAssignedWorkout,
	getUserAssignment,
	updateMyDayExercises,
	updateUserDayExercises,
} from "../controllers/workout-assignment.controller";
import {
	downloadWorkoutPlanTemplate,
	exportWorkoutPlan,
	importWorkoutPlan,
} from "../controllers/workout-plan-import.controller";
import {
	assignUsers,
	createPlan,
	deletePlan,
	duplicatePlan,
	getPlan,
	listPlans,
	updatePlan,
} from "../controllers/workout-plan.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";
import { uploadRateLimiter } from "../middleware/upload.middleware";

const workoutPlanRouter = Router();

const EXCEL_MIME_TYPES = new Set([
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.ms-excel",
	// Some browsers/OSes send a generic type for .xlsx.
	"application/octet-stream",
	"application/zip",
]);

/**
 * In-memory, 5 MB, spreadsheet-only upload for the Excel plan import. Kept off
 * the shared uploadMiddleware, which is uncapped and writes to disk — the
 * workbook is parsed straight from the buffer and never stored.
 */
const excelUpload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 5 * 1024 * 1024, files: 1 },
	fileFilter: (_req, file, cb) => {
		const okExt = /\.xlsx$/i.test(file.originalname);
		if (okExt && EXCEL_MIME_TYPES.has(file.mimetype)) cb(null, true);
		else cb(new Error("Upload an Excel .xlsx file"));
	},
});

const uploadExcelFile: RequestHandler = (req, res, next) => {
	excelUpload.single("file")(req, res, (err: unknown) => {
		if (!err) {
			next();
			return;
		}
		if (err instanceof multer.MulterError) {
			const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
			res
				.status(status)
				.json({ error: `Upload rejected: ${err.message}`, code: err.code });
			return;
		}
		res.status(415).json({
			error: (err as Error).message || "Unsupported file",
			code: "UNSUPPORTED_MEDIA_TYPE",
		});
	});
};

workoutPlanRouter.use(authenticateToken);

// ── Assignment routes (must come before /:id to avoid collision) ──────────────
workoutPlanRouter.get(
	"/assignments/mine",
	authorize(["user"]),
	getMyAssignment,
);
workoutPlanRouter.get(
	"/assignments/mine/schedule",
	authorize(["user"]),
	getAssignmentSchedule,
);
workoutPlanRouter.get(
	"/assignments/mine/today",
	authorize(["user"]),
	getTodayAssignedWorkout,
);
workoutPlanRouter.get(
	"/assignments/mine/days/:dayNumber",
	authorize(["user"]),
	getAssignedWorkoutForDay,
);
workoutPlanRouter.post(
	"/assignments/mine/complete-day",
	authorize(["user"]),
	completePlanDay,
);
workoutPlanRouter.patch(
	"/assignments/mine/days/:dayNumber",
	authorize(["user"]),
	updateMyDayExercises,
);

// Staff management of member assignments
workoutPlanRouter.get(
	"/assignments/user/:userId",
	authorize(["admin", "trainer"]),
	getUserAssignment,
);
workoutPlanRouter.patch(
	"/assignments/user/:userId/days/:dayNumber",
	authorize(["admin", "trainer"]),
	updateUserDayExercises,
);

// ── Excel import (must come before /:id) ─────────────────────────────────────
workoutPlanRouter.get(
	"/import/template",
	authorize(["admin", "trainer"]),
	downloadWorkoutPlanTemplate,
);
workoutPlanRouter.post(
	"/import",
	authorize(["admin", "trainer"]),
	uploadRateLimiter,
	uploadExcelFile,
	importWorkoutPlan,
);

// ── Plan CRUD ─────────────────────────────────────────────────────────────────
workoutPlanRouter.get("/", authorize(["admin", "trainer"]), listPlans);
workoutPlanRouter.post("/", authorize(["admin", "trainer"]), createPlan);
workoutPlanRouter.get("/:id", authorize(["admin", "trainer"]), getPlan);
workoutPlanRouter.patch("/:id", authorize(["admin", "trainer"]), updatePlan);
workoutPlanRouter.delete("/:id", authorize(["admin", "trainer"]), deletePlan);
workoutPlanRouter.post(
	"/:id/assign",
	authorize(["admin", "trainer"]),
	assignUsers,
);
workoutPlanRouter.get(
	"/:id/export",
	authorize(["admin", "trainer"]),
	exportWorkoutPlan,
);
workoutPlanRouter.post(
	"/:id/duplicate",
	authorize(["admin", "trainer"]),
	duplicatePlan,
);
workoutPlanRouter.post(
	"/:planId/assign-to-me",
	authorize(["user", "trainer", "admin"]),
	assignPlan,
);

export default workoutPlanRouter;
