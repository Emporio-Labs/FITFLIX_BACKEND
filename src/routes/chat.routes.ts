import { Router } from "express";
import {
	deleteBlock,
	deleteMessageById,
	getAllConversations,
	getAnyConversation,
	getBlocked,
	getContacts,
	getConversationById,
	getConversations,
	getMessages,
	getPeopleOverrides,
	getPolicy,
	getReports,
	getUnread,
	patchReport,
	postBlock,
	postConversation,
	postMessage,
	postPolicyReset,
	postRead,
	postReport,
	putOverride,
	putPolicy,
	putSettings,
} from "../controllers/chat.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { chatRateLimit } from "../middleware/rate-limit.middleware";
import { authorize } from "../middleware/rbac.middleware";

const router = Router();

router.use(authenticateToken);

// Any signed-in person. What they may do is decided per request by the chat
// policy (services/chat/policy.ts), not by role guards here.
router.get("/contacts", getContacts);
router.get("/unread-count", getUnread);
router.get("/conversations", getConversations);
router.post("/conversations", postConversation);
router.get("/conversations/:id", getConversationById);
router.get("/conversations/:id/messages", getMessages);
router.post("/conversations/:id/messages", chatRateLimit, postMessage);
router.post("/conversations/:id/read", postRead);
router.post("/conversations/:id/report", chatRateLimit, postReport);
router.delete("/messages/:id", deleteMessageById);
router.get("/blocks", getBlocked);
router.post("/blocks", postBlock);
router.delete("/blocks/:kind/:id", deleteBlock);

// Admin: who may talk to whom.
router.get("/admin/policy", authorize(["admin"]), getPolicy);
router.put("/admin/policy", authorize(["admin"]), putPolicy);
router.post("/admin/policy/reset", authorize(["admin"]), postPolicyReset);
router.get("/admin/people", authorize(["admin"]), getPeopleOverrides);
router.put("/admin/overrides/:kind/:id", authorize(["admin"]), putOverride);
router.put("/admin/settings", authorize(["admin"]), putSettings);

// Admin: moderation.
router.get("/admin/reports", authorize(["admin"]), getReports);
router.patch("/admin/reports/:id", authorize(["admin"]), patchReport);
router.get("/admin/conversations", authorize(["admin"]), getAllConversations);
router.get(
	"/admin/conversations/:id",
	authorize(["admin"]),
	getAnyConversation,
);

export default router;
