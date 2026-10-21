import { Router, type RequestHandler } from "express";
import multer from "multer";
import {
	createMembership,
	deleteMembershipById,
	getAllMemberships,
	getMembershipById,
	getMyMemberships,
	pauseMembershipHandler,
	resumeMembershipHandler,
	updateMembershipById,
} from "../controllers/membership.controller";
import {
	downloadMigrationTemplate,
	previewMigration,
	executeMigration,
} from "../controllers/membership-migration.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const EXCEL_MIME_TYPES = new Set([
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.ms-excel",
	"application/octet-stream",
	"application/x-zip-compressed",
]);

const excelUpload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 10 * 1024 * 1024, files: 1 },
	fileFilter: (_req, file, cb) => {
		const okExt = /\.xlsx$/i.test(file.originalname);
		if (okExt && (EXCEL_MIME_TYPES.has(file.mimetype) || !file.mimetype)) {
			cb(null, true);
		} else {
			cb(new Error("Please upload an Excel .xlsx file"));
		}
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

const membershipRouter = Router();

membershipRouter.use(authenticateToken);

// ── Migration & Bulk Import routes (must precede /:id) ───────────────
membershipRouter.get(
	"/migration/template",
	authorize(["admin", "frontdesk"]),
	downloadMigrationTemplate,
);
membershipRouter.post(
	"/migration/preview",
	authorize(["admin", "frontdesk"]),
	uploadExcelFile,
	previewMigration,
);
membershipRouter.post(
	"/migration/execute",
	authorize(["admin", "frontdesk"]),
	uploadExcelFile,
	executeMigration,
);

membershipRouter.post("/", authorize(["admin"]), createMembership);
membershipRouter.get("/", authorize(["admin", "frontdesk"]), getAllMemberships);
membershipRouter.get("/me", authorize(["user"]), getMyMemberships);
membershipRouter.get(
	"/:id",
	authorize(["admin", "frontdesk"]),
	getMembershipById,
);
// Freeze/resume is a front-desk retention action, not just an admin one.
membershipRouter.post(
	"/:id/pause",
	authorize(["admin", "frontdesk"]),
	pauseMembershipHandler,
);
membershipRouter.post(
	"/:id/resume",
	authorize(["admin", "frontdesk"]),
	resumeMembershipHandler,
);

membershipRouter.patch("/:id", authorize(["admin"]), updateMembershipById);
membershipRouter.delete("/:id", authorize(["admin"]), deleteMembershipById);

export default membershipRouter;
