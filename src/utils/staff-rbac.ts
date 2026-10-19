/**
 * FX-17.6 — master switch for branch-scoped staff RBAC enforcement.
 *
 * Off by default. While off, every branch-scope check is a transparent
 * pass-through and `normalizeRole` keeps its legacy behaviour, so the server
 * behaves exactly as it did before FX-17. Turning the switch back off is the
 * complete rollback — no data migration or redeploy of logic is required.
 *
 * Read per call (not cached at module load) so a process can be flipped via an
 * env change + restart, and so tests can toggle `process.env.STAFF_RBAC_ENFORCE`
 * between cases. Mirrors the boolean-env idiom in captcha.middleware.ts.
 */
export const isStaffRbacEnforced = (): boolean => {
	const value = process.env.STAFF_RBAC_ENFORCE;
	if (!value) {
		return false;
	}
	const normalized = value.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes";
};
