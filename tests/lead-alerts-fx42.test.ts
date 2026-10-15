import mongoose from "mongoose";
import {
	AlertSeverity,
	AlertStatus,
	AlertType,
	LeadStatus,
} from "../src/models/Enums";
import Lead from "../src/models/Lead";
import Location from "../src/models/Location";
import OperationalAlert from "../src/models/OperationalAlert";
import { runLeadSlaAndEscalationSweep } from "../src/schedulers/callback-escalation.scheduler";
import { setSalesStaffOnDutyOverride } from "../src/services/staff-presence.service";
import { autoResolveOperationalAlerts } from "../src/controllers/operational-alert.controller";
import connectDB from "../src/utils/db";
import { assert } from "./test-helpers";

async function runTests() {
	console.log("\n🧪 Running Lead SLA Alerts & Escalation (FX-42) Tests...");

	await connectDB();

	// Setup mock test branch
	let branch = await Location.findOne({ code: "fx42_test_branch" });
	if (!branch) {
		branch = await Location.create({
			name: "FX42 Test Branch",
			code: "fx42_test_branch",
			timezone: "Asia/Kolkata",
			isActive: true,
		});
	}
	const branchId = branch._id;

	// Reset any on-duty override
	setSalesStaffOnDutyOverride(null);

	// -------------------------------------------------------------
	// 🔎 FX-42.1: An alert fires when a new lead stays unclaimed past its time limit
	// -------------------------------------------------------------
	console.log("\n🔎 FX-42.1: Alert fires when a new lead stays unclaimed past its time limit");

	const pastTime = new Date(Date.now() - 25 * 60_000); // 25 minutes ago
	const unclaimedLead = await Lead.create({
		leadName: `Unclaimed Lead ${Date.now()}`,
		phone: "+919988776655",
		email: `unclaimed_${Date.now()}@example.com`,
		status: LeadStatus.New,
		locationId: branchId,
	});
	await Lead.collection.updateOne(
		{ _id: unclaimedLead._id },
		{ $set: { createdAt: pastTime } },
	);

	// Simulate sales person on duty for branch
	setSalesStaffOnDutyOverride((_bId) => true);

	const metrics1 = await runLeadSlaAndEscalationSweep();
	assert(metrics1.unclaimedAlerted >= 1, "Sweep raised alert for unclaimed lead");

	const alert1 = await OperationalAlert.findOne({
		"relatedEntity.entityId": unclaimedLead._id.toString(),
		status: AlertStatus.Open,
	});
	assert(alert1 != null, "OperationalAlert was created in MongoDB");
	assert(alert1?.type === AlertType.LeadUnclaimed, "Alert type is LeadUnclaimed");
	assert(
		alert1?.targetRoles?.includes("frontdesk") === true,
		"Target role is frontdesk when sales is on duty",
	);

	// Verify deduplication: second sweep should NOT create a duplicate alert
	const metricsDedupe = await runLeadSlaAndEscalationSweep();
	const alertCount = await OperationalAlert.countDocuments({
		"relatedEntity.entityId": unclaimedLead._id.toString(),
		status: AlertStatus.Open,
	});
	assert(alertCount === 1, "Alert is not duplicated on subsequent sweeps");

	// -------------------------------------------------------------
	// 🔎 FX-42.2: An alert fires when a requested callback hasn't been made by its due time
	// -------------------------------------------------------------
	console.log("\n🔎 FX-42.2: Alert fires when a requested callback hasn't been made by its due time");

	const callbackDueTime = new Date(Date.now() - 10 * 60_000); // 10 minutes overdue
	const callbackLead = await Lead.create({
		leadName: `Callback Overdue Lead ${Date.now()}`,
		phone: "+919988776644",
		status: LeadStatus.New,
		tags: ["callback"],
		followUpDate: callbackDueTime,
		locationId: branchId,
	});

	const metrics2 = await runLeadSlaAndEscalationSweep();
	assert(metrics2.callbacksAlerted >= 1, "Sweep raised alert for overdue callback lead");

	const callbackAlert = await OperationalAlert.findOne({
		"relatedEntity.entityId": callbackLead._id.toString(),
		status: AlertStatus.Open,
	});
	assert(callbackAlert != null, "OperationalAlert exists for overdue callback");
	assert(
		callbackAlert?.title?.includes("Overdue Callback") === true,
		"Title indicates overdue callback",
	);

	// -------------------------------------------------------------
	// 🔎 FX-42.3: If no sales person is on duty at the branch, alert goes straight to manager
	// -------------------------------------------------------------
	console.log("\n🔎 FX-42.3: If no sales person is on duty, alert goes straight to manager");

	// Simulate NO sales staff on duty
	setSalesStaffOnDutyOverride((_bId) => false);

	const noStaffLead = await Lead.create({
		leadName: `No Staff Lead ${Date.now()}`,
		phone: "+919988776633",
		status: LeadStatus.New,
		locationId: branchId,
	});
	await Lead.collection.updateOne(
		{ _id: noStaffLead._id },
		{ $set: { createdAt: pastTime } },
	);

	await runLeadSlaAndEscalationSweep();

	const managerAlert = await OperationalAlert.findOne({
		"relatedEntity.entityId": noStaffLead._id.toString(),
		status: AlertStatus.Open,
	});
	assert(managerAlert != null, "OperationalAlert created when no sales staff on duty");
	assert(
		managerAlert?.targetRoles?.includes("branch_manager") === true,
		"Target role is branch_manager when no sales staff is on duty",
	);
	assert(
		managerAlert?.title?.includes("[Direct to Manager]") === true,
		"Title explicitly notes Direct to Manager escalation",
	);

	// -------------------------------------------------------------
	// 🔎 FX-42.4: Each alert resolves on its own once lead is claimed or callback logged
	// -------------------------------------------------------------
	console.log("\n🔎 FX-42.4: Each alert resolves on its own once lead is claimed or callback logged");

	// 1. Lead claimed
	const resolvedClaimCount = await autoResolveOperationalAlerts(
		"lead",
		unclaimedLead._id.toString(),
		"Lead claimed by staff member",
	);
	assert(resolvedClaimCount === 1, "Unclaimed alert auto-resolved when lead is claimed");

	const postClaimAlert = await OperationalAlert.findById(alert1?._id);
	assert(postClaimAlert?.status === AlertStatus.Resolved, "Alert status is now resolved");
	assert(
		postClaimAlert?.resolutionReason === "Lead claimed by staff member",
		"Resolution reason is recorded",
	);

	// 2. Callback logged
	const resolvedCallbackCount = await autoResolveOperationalAlerts(
		"lead",
		callbackLead._id.toString(),
		"Callback logged and completed",
	);
	assert(resolvedCallbackCount === 1, "Callback alert auto-resolved when callback is logged");

	const postCallbackAlert = await OperationalAlert.findById(callbackAlert?._id);
	assert(
		postCallbackAlert?.status === AlertStatus.Resolved,
		"Callback alert status is now resolved",
	);

	// Cleanup test data
	setSalesStaffOnDutyOverride(null);
	await Lead.deleteMany({
		_id: { $in: [unclaimedLead._id, callbackLead._id, noStaffLead._id] },
	});
	await OperationalAlert.deleteMany({
		_id: { $in: [alert1?._id, callbackAlert?._id, managerAlert?._id] },
	});

	console.log("\n🎉 All Lead SLA Alerts & Escalation (FX-42) unit tests passed!\n");
	process.exit(0);
}

runTests().catch((err) => {
	console.error("Test execution failed:", err);
	process.exit(1);
});
