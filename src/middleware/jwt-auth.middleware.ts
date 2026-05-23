import type { RequestHandler } from "express";
import { getJwtConfig, verifyAuthToken } from "../utils/jwt";

const getBearerToken = (authorization: string | undefined): string | null => {
	if (!authorization) {
		return null;
	}

	const [scheme, token] = authorization.split(" ");
	if (scheme !== "Bearer" || !token) {
		return null;
	}

	const trimmed = token.trim();
	return trimmed ? trimmed : null;
};

export const authenticateToken: RequestHandler = (req, res, next) => {
	const config = getJwtConfig();
	if (!config) {
		res.status(503).json({ message: "JWT authentication is not configured" });
		return;
	}

	const token = getBearerToken(req.header("authorization"));
	if (!token) {
		res
			.status(401)
			.json({ message: "Missing or invalid Authorization header" });
		return;
	}

	let user: ReturnType<typeof verifyAuthToken> = null;
	try {
		user = verifyAuthToken(token, config);
	} catch (_error) {
		user = null;
	}
	if (!user) {
		res.status(401).json({ message: "Invalid or expired token" });
		return;
	}

	req.user = user;
	next();
};
