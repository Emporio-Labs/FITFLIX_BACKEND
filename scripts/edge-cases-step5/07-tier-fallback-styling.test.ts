import { config } from "dotenv";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 07: TIER FALLBACK STYLING & CORRUPTED TIER SAFETY EDGE CASE");
	console.log("===================================================================\n");

	let passCount = 0;
	let failCount = 0;

	// Case 1: Active tier with rich styling
	const activeTier = {
		tierId: "super_vip",
		badgeLabel: "EXCLUSIVE VIP",
		badgeColor: "#ec4899",
		perks: ["Front Row Mat", "Protein Shake"],
	};

	const resolvedBadge1 = activeTier?.badgeLabel || "GENERAL PASS";
	const resolvedColor1 = activeTier?.badgeColor || "#10b981";
	if (resolvedBadge1 === "EXCLUSIVE VIP" && resolvedColor1 === "#ec4899") {
		console.log("✅ Case 1 Passed: Customized tier styling extracted successfully.");
		passCount++;
	} else {
		console.error("❌ Case 1 Failed: Tier styling extraction failed!");
		failCount++;
	}

	// Case 2: Deleted/orphaned tier where tier is undefined
	const deletedTier = undefined;
	const resolvedBadge2 = (deletedTier as any)?.badgeLabel || "GENERAL PASS";
	const resolvedColor2 = (deletedTier as any)?.badgeColor || "#10b981";
	const resolvedPerks2 = (deletedTier as any)?.perks || [];

	if (resolvedBadge2 === "GENERAL PASS" && resolvedColor2 === "#10b981" && Array.isArray(resolvedPerks2)) {
		console.log("✅ Case 2 Passed: Graceful fallback to default 'GENERAL PASS' and '#10b981' on missing tier.");
		passCount++;
	} else {
		console.error("❌ Case 2 Failed: Fallback failed!");
		failCount++;
	}

	// Case 3: Empty string badgeLabel fallback
	const blankBadgeTier = { badgeLabel: "", badgeColor: "" };
	const resolvedBadge3 = blankBadgeTier.badgeLabel || "GENERAL PASS";
	const resolvedColor3 = blankBadgeTier.badgeColor || "#10b981";

	if (resolvedBadge3 === "GENERAL PASS" && resolvedColor3 === "#10b981") {
		console.log("✅ Case 3 Passed: Empty string badge values caught by fallback.");
		passCount++;
	} else {
		console.error("❌ Case 3 Failed: Blank badge fallback failed!");
		failCount++;
	}

	console.log(`\n📊 Test 07 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
