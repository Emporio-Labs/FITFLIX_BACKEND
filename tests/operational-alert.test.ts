import mongoose from "mongoose";
import OperationalAlert from "../src/models/OperationalAlert";
import Location from "../src/models/Location";
import { AlertSeverity, AlertStatus, AlertType } from "../src/models/Enums";
import { autoResolveOperationalAlerts } from "../src/controllers/operational-alert.controller";
import { assert } from "./test-helpers";

async function runTests() {
	console.log("\n🧪 Running Operational Alerts (FX-35) Tests...");

	const mongoUri =
		process.env.MONGODB_URL ||
		process.env.MONGODB_URI ||
		"mongodb://127.0.0.1:27017/hybridhuman";

	if (mongoose.connection.readyState === 0) {
		await mongoose.connect(mongoUri);
	}

	// 1. Setup mock branch
	let branch = await Location.findOne({ code: "TEST_BRANCH" });
	if (!branch) {
		branch = await Location.create({
			name: "Test Branch Club",
			code: "TEST_BRANCH",
			timezone: "Asia/Kolkata",
			isActive: true,
		});
	}

	const branchId = branch._id;

	// FX-35.1: Create an operational alert
	console.log("\n🔎 FX-35.1: Alert records type, severity, branch, roles, and related entity");
	const testLeadId = new mongoose.Types.ObjectId().toString();
	const alert = await OperationalAlert.create({
		type: AlertType.LeadUnclaimed,
		severity: AlertSeverity.Critical,
		status: AlertStatus.Open,
		title: "Urgent Callback: John Doe",
		message: "High intent callback requested",
		branchId,
		targetRoles: ["admin", "frontdesk"],
		relatedEntity: {
			entityType: "lead",
			entityId: testLeadId,
			summary: "John Doe - Weight Loss",
		},
		autoResolveKey: `lead:${testLeadId}`,
	});

	assert(alert._id != null, "Alert was created with an ObjectId");
	assert(alert.severity === AlertSeverity.Critical, "Severity is critical");
	assert(alert.status === AlertStatus.Open, "Initial status is open");
	assert(alert.branchId.toString() === branchId.toString(), "Alert is stamped with branchId");
	assert(alert.relatedEntity.entityId === testLeadId, "Alert is linked to target lead");

	// FX-35.2: Acknowledge alert by a named person
	console.log("\n🔎 FX-35.2: Acknowledging moves alert to acknowledged and logs named person and timestamp");
	const staffUserId = new mongoose.Types.ObjectId();
	alert.status = AlertStatus.Acknowledged;
	alert.acknowledgedBy = {
		userId: staffUserId,
		name: "Sarah Frontdesk",
		role: "frontdesk",
	};
	alert.acknowledgedAt = new Date();
	await alert.save();

	const reloadedAlert = await OperationalAlert.findById(alert._id);
	assert(reloadedAlert?.status === AlertStatus.Acknowledged, "Status updated to acknowledged");
	assert(reloadedAlert?.acknowledgedBy?.name === "Sarah Frontdesk", "Named person is recorded");
	assert(reloadedAlert?.acknowledgedAt != null, "Timestamp is recorded");

	// FX-35.3: Persistence across re-queries
	console.log("\n🔎 FX-35.3: Alert persists in database and is queried by branch and status");
	const activeAlerts = await OperationalAlert.find({
		branchId,
		status: { $in: [AlertStatus.Open, AlertStatus.Acknowledged] },
	});
	assert(activeAlerts.some((a) => a._id.toString() === alert._id.toString()), "Alert is returned in active query");

	// FX-35.4: Acknowledging keeps it on board until auto-resolved
	console.log("\n🔎 FX-35.4: Stays on board until the issue is fixed (auto-resolve on lead claim)");
	const resolvedCount = await autoResolveOperationalAlerts("lead", testLeadId, "Lead claimed by Sarah");
	assert(resolvedCount === 1, "Exactly one alert was auto-resolved");

	const postResolveAlert = await OperationalAlert.findById(alert._id);
	assert(postResolveAlert?.status === AlertStatus.Resolved, "Alert status is now resolved");
	assert(postResolveAlert?.resolutionReason === "Lead claimed by Sarah", "Resolution reason recorded");

	// Cleanup
	await OperationalAlert.findByIdAndDelete(alert._id);
	console.log("\n🎉 All Operational Alert (FX-35) unit tests passed!");
	process.exit(0);
}

runTests().catch((err) => {
	console.error("Test failed:", err);
	process.exit(1);
});
