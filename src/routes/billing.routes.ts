import express from "express";
import {
	createCallbackInquiryHandler,
	createOrderHandler,
	getBillingConfigHandler,
	purchaseWithCreditsHandler,
	razorpayWebhookHandler,
	verifyPaymentHandler,
} from "../controllers/billing.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";

const router = express.Router();

router.get("/config", getBillingConfigHandler);
router.post("/create-order", authenticateToken, createOrderHandler);
router.post("/verify-payment", authenticateToken, verifyPaymentHandler);
router.post("/purchase-with-credits", authenticateToken, purchaseWithCreditsHandler);
router.post("/callback-inquiry", createCallbackInquiryHandler);
router.post("/webhook", razorpayWebhookHandler);

export default router;
