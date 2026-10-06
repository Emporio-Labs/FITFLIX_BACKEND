import mongoose from "mongoose";
import AlertRule from "../src/models/AlertRule";
import OperationalAlert from "../src/models/OperationalAlert";
import Location from "../src/models/Location";
import { AlertSeverity, AlertStatus, AlertType } from "../src/models/Enums";
import {
	DEFAULT_ALERT_RULES,
	getEffectiveAlertRule,
} from "../src/utils/default-alert-rules";
import { assert } from "./test-helpers";

async function runTests() {
	console.log("\n🧪 Running Alert Rules Configuration (FX-36) Tests...");

	const mongoUri =
		process.env.MONGODB_URL ||
		process.env.MONGODB_URI ||
		"mongodb://127.0.0.1:27017/hybridhuman";

	if (mongoose.connection.readyState === 0) {
		await mongoose.connect(mongoUri);
	}

	// Clean up previous test rules
	await AlertRule.deleteMany({ alertType: { $in: [AlertType.TrainerMissing, AlertType.LeadUnclaimed] } });

	// FX-36.3: Sensible defaults ship out-of-the-box
	console.log("\n🔎 FX-36.3: Sensible defaults exist for all alert types before configuration");
	const trainerDefault = await getEffectiveAlertRule(AlertType.TrainerMissing);
	assert(trainerDefault.severity === AlertSeverity.Critical, "Trainer missing default severity is critical");
	assert(trainerDefault.firstResponderRole === "frontdesk", "First responder is frontdesk");
	assert(trainerDefault.sound === "siren", "Sound is siren");
	assert(trainerDefault.escalationLadder.length === 2, "Escalation ladder has 2 steps");
	assert(trainerDefault.escalationLadder[0].afterMinutes === 2, "Escalates to manager after 2 minutes");

	const leadDefault = await getEffectiveAlertRule(AlertType.LeadUnclaimed);
	assert(leadDefault.severity === AlertSeverity.Warning, "Lead default severity is warning");
	assert(leadDefault.escalationLadder[0].afterMinutes === 15, "Lead escalates to manager after 15 minutes");

	// FX-36.1 & FX-36.4: Admin customizes an alert rule & records who changed it
	console.log("\n🔎 FX-36.1 & FX-36.4: Admin updates alert rule, ladder, sound, and audit trail is recorded");
	const adminUserId = new mongoose.Types.ObjectId();
	const customTrainerRule = await AlertRule.create({
		alertType: AlertType.TrainerMissing,
		title: "Urgent Trainer Absence",
		description: "Customized rule for immediate manager alert",
		severity: AlertSeverity.Critical,
		firstResponderRole: "branch_manager",
		escalationLadder: [
			{ role: "admin", afterMinutes: 1 },
			{ role: "owner", afterMinutes: 3 },
		],
		sound: "siren",
		updatedBy: {
			userId: adminUserId,
			name: "Head Owner Rajesh",
			role: "admin",
			updatedAt: new Date(),
		},
	});

	assert(customTrainerRule._id != null, "Custom rule created in MongoDB");
	assert(customTrainerRule.updatedBy?.name === "Head Owner Rajesh", "Recorded who changed it");
	assert(customTrainerRule.updatedBy?.updatedAt != null, "Recorded timestamp of change");

	// FX-36.2: Changes apply to new alerts straight away
	console.log("\n🔎 FX-36.2: Changes apply to new alerts straight away");
	const effectiveTrainerRule = await getEffectiveAlertRule(AlertType.TrainerMissing);
	assert(effectiveTrainerRule.firstResponderRole === "branch_manager", "Effective first responder is now branch_manager");
	assert(effectiveTrainerRule.escalationLadder[0].role === "admin", "Effective ladder reflects custom rule");
	assert(effectiveTrainerRule.escalationLadder[0].afterMinutes === 1, "Escalation timer is now 1 min");

	// Clean up
	await AlertRule.findByIdAndDelete(customTrainerRule._id);
	console.log("\n🎉 All Alert Rules Configuration (FX-36) unit tests passed!");
	process.exit(0);
}

runTests().catch((err) => {
	console.error("Test failed:", err);
	process.exit(1);
});
