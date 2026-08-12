import type { AppUserRole } from "../types/auth";

// The set of collections a plan/session/set can be attributed to. Kept
// separate from AppUserRole because "doctor"/"nutritionist"/"frontdesk"
// don't (yet) author workout content — they fall back to "User" here,
// which only matters if a route guard is ever loosened to admit them.
export type StaffActorModel = "User" | "Trainer" | "Admin";

export const actorModelForRole = (role: AppUserRole): StaffActorModel => {
	if (role === "trainer") return "Trainer";
	if (role === "admin") return "Admin";
	return "User";
};
