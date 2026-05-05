import type { RequestHandler } from "express";
import Admin from "../models/Admin";
import Doctor from "../models/Doctor";
import Trainer from "../models/Trainer";
import User from "../models/User";
import {
	hashPassword,
	isHashedPassword,
	verifyPassword,
} from "../utils/password";

type AppRole = "admin" | "doctor" | "trainer" | "user";

type AuthDocument = {
	_id: { toString(): string };
	email: string;
	passwordHash: string;
	save: () => Promise<unknown>;
};

const getCredentialsFromHeader = (
	authorization: string | undefined,
): { email: string; password: string } | null => {
	if (!authorization) {
		return null;
	}

	const [scheme, encodedCredentials] = authorization.split(" ");

	if (scheme !== "Basic" || !encodedCredentials) {
		return null;
	}

	const decodedCredentials = Buffer.from(encodedCredentials, "base64").toString(
		"utf8",
	);
	const separatorIndex = decodedCredentials.indexOf(":");

	if (separatorIndex === -1) {
		return null;
	}

	const email = decodedCredentials.slice(0, separatorIndex).trim();
	const password = decodedCredentials.slice(separatorIndex + 1);

	if (!email || !password) {
		return null;
	}

	return { email, password };
};

export const authenticateBasicCredentials: RequestHandler = async (
	req,
	res,
	next,
) => {
	const credentials = getCredentialsFromHeader(req.header("authorization"));

	if (!credentials) {
		res
			.status(401)
			.json({ message: "Missing or invalid Authorization header" });
		return;
	}

	const { email, password } = credentials;

	try {
		const [admin, doctor, trainer, user] = await Promise.all([
			Admin.findOne({ email }).select("_id email +passwordHash"),
			Doctor.findOne({ email }).select("_id email +passwordHash"),
			Trainer.findOne({ email }).select("_id email +passwordHash"),
			User.findOne({ email }).select("_id email +passwordHash"),
		]);

		const candidates: Array<{ role: AppRole; account: AuthDocument | null }> = [
			{ role: "admin", account: admin },
			{ role: "doctor", account: doctor },
			{ role: "trainer", account: trainer },
			{ role: "user", account: user },
		];

		for (const candidate of candidates) {
			if (!candidate.account) {
				continue;
			}

			const valid = await verifyPassword(
				password,
				candidate.account.passwordHash,
			);
			if (!valid) {
				continue;
			}

			if (!isHashedPassword(candidate.account.passwordHash)) {
				candidate.account.passwordHash = await hashPassword(password);
				await candidate.account.save();
			}

			req.user = {
				id: candidate.account._id.toString(),
				email: candidate.account.email,
				role: candidate.role,
			};
			next();
			return;
		}

		res.status(401).json({ message: "Invalid email or password" });
	} catch (error) {
		next(error);
	}
};
