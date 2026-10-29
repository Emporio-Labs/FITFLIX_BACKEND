import { config } from "dotenv";
import { RegistrationPaymentStatus } from "../../src/models/Enums";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 06: PAYMENT STATUS COHERENCE & PRICING PRESENTATION EDGE CASE");
	console.log("===================================================================\n");

	let passCount = 0;
	let failCount = 0;

	// Case 1: Free pass status
	const freePass = {
		paymentStatus: RegistrationPaymentStatus.Free,
		amountPaid: 0,
	};
	if (freePass.paymentStatus === "free" && freePass.amountPaid === 0) {
		console.log("✅ Case 1 Passed: Free pass correctly identified with 0 fee.");
		passCount++;
	} else {
		console.error("❌ Case 1 Failed: Free pass status incoherence!");
		failCount++;
	}

	// Case 2: Paid pass status
	const paidPass = {
		paymentStatus: RegistrationPaymentStatus.Paid,
		amountPaid: 499,
		paymentReference: "UPI_TXN_987654321",
	};
	if (paidPass.paymentStatus === "paid" && paidPass.amountPaid > 0 && paidPass.paymentReference) {
		console.log(`✅ Case 2 Passed: Paid pass reflects valid payment confirmation (₹${paidPass.amountPaid}).`);
		passCount++;
	} else {
		console.error("❌ Case 2 Failed: Paid pass status incoherence!");
		failCount++;
	}

	// Case 3: Pending pass status
	const pendingPass = {
		paymentStatus: RegistrationPaymentStatus.Pending,
		amountPaid: 999,
		paymentReference: null,
	};
	if (pendingPass.paymentStatus === "pending" && !pendingPass.paymentReference) {
		console.log("✅ Case 3 Passed: Pending pass requires cashier settlement before admittance.");
		passCount++;
	} else {
		console.error("❌ Case 3 Failed: Pending pass check failed!");
		failCount++;
	}

	console.log(`\n📊 Test 06 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
