// Mint a short-lived user-role JWT (backend's own signer) for smoke-testing
// authenticated endpoints locally. Prints the token to stdout; no DB writes.
import { getJwtConfig, signAuthToken } from "../src/utils/jwt";

const config = getJwtConfig();
if (!config) throw new Error("JWT_SECRET missing in .env");

const token = signAuthToken(
	{ id: "000000000000000000000000", email: "smoke@test.local", role: "user" },
	config,
);
console.log(token);
