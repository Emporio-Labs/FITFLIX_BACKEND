import { Router } from "express";
import { adminCloseFounderSlot, adminCreateFounderSlot, adminGetFounderSettings, adminListFounderLeads, adminPatchFounderSettings, adminUpdateFounderLeadStatus, getFounderSettings, getFounderSlots, getPrivateBookingConfig, getPrivateFounderLead, noStore, requestFounderCall, submitFounderApplication } from "../controllers/presale-founders.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";
import { createRateLimiter } from "../middleware/rate-limit.middleware";
import { hashContact } from "../utils/presale-founders.utils";

const contactRateLimit = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 5, keyPrefix: "presale-founders-submit", keyResolver: (req) => {
  const contact = req.body?.contact;
  if (contact && typeof contact.email === "string" && typeof contact.phone === "string") return `contact:${hashContact(contact.email, contact.phone)}`;
  return `request:${req.ip ?? "unknown"}`;
}, message: "Too many applications for this contact. Please try again later." });

const router = Router();
router.use(noStore);
router.use((req, res, next) => {
	const contentLength = Number(req.header("content-length"));
	const serializedLength = req.body && typeof req.body === "object"
		? Buffer.byteLength(JSON.stringify(req.body), "utf8")
		: 0;
	if ((Number.isFinite(contentLength) && contentLength > 256 * 1024) || serializedLength > 256 * 1024) {
		res.status(413).json({ error: "Request body is too large", code: "BAD_REQUEST" });
		return;
	}
	next();
});
router.get("/settings", getFounderSettings);
router.get("/slots", getFounderSlots);
router.post("/submit", contactRateLimit, submitFounderApplication);
router.post("/lead", getPrivateFounderLead);
router.post("/booking-config", getPrivateBookingConfig);
router.post("/request-call", requestFounderCall);

const adminRouter = Router();
adminRouter.use(authenticateToken, authorize(["admin"]), noStore);
adminRouter.get("/leads", adminListFounderLeads);
adminRouter.patch("/leads/:id/status", adminUpdateFounderLeadStatus);
adminRouter.get("/settings", adminGetFounderSettings);
adminRouter.patch("/settings", adminPatchFounderSettings);
adminRouter.post("/slots", adminCreateFounderSlot);
adminRouter.patch("/slots/:id/close", adminCloseFounderSlot);

export { adminRouter as presaleFoundersAdminRouter };
export default router;
