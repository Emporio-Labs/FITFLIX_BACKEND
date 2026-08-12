import User from "../models/User";
import Admin from "../models/Admin";
import Trainer from "../models/Trainer";

export interface EmailCheckResult {
	exists: boolean;
	accountType?: "User" | "Admin" | "Trainer";
}

/**
 * Checks if an email is already registered across any system account collection
 * (User, Admin, or Trainer).
 */
export async function isEmailInUseAcrossSystem(
	email: string,
	excludeId?: string,
): Promise<EmailCheckResult> {
	if (!email || typeof email !== "string" || !email.trim()) {
		return { exists: false };
	}

	const cleanEmail = email.trim().toLowerCase();
	const emailRegex = new RegExp(`^${cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
	const query = { email: { $regex: emailRegex } };

	const [u, a, t] = await Promise.all([
		User.findOne(query).select("_id").lean(),
		Admin.findOne(query).select("_id").lean(),
		Trainer.findOne(query).select("_id").lean(),
	]);

	if (u && (!excludeId || u._id.toString() !== excludeId)) {
		return { exists: true, accountType: "User" };
	}
	if (a && (!excludeId || a._id.toString() !== excludeId)) {
		return { exists: true, accountType: "Admin" };
	}
	if (t && (!excludeId || t._id.toString() !== excludeId)) {
		return { exists: true, accountType: "Trainer" };
	}

	return { exists: false };
}
