import { compare, hash } from "bcryptjs";

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

const getSaltRounds = (): number => {
	const parsed = Number(process.env.PASSWORD_SALT_ROUNDS ?? 10);

	if (!Number.isInteger(parsed) || parsed < 4 || parsed > 15) {
		return 10;
	}

	return parsed;
};

export const hashPassword = async (plainPassword: string): Promise<string> => {
	return hash(plainPassword, getSaltRounds());
};

export const isHashedPassword = (passwordHash: string): boolean => {
	return BCRYPT_HASH_PATTERN.test(passwordHash);
};

export const verifyPassword = async (
	plainPassword: string,
	passwordHash: string,
): Promise<boolean> => {
	if (!isHashedPassword(passwordHash)) {
		// Plaintext passwords are no longer accepted.
		// Run `bun run scripts/migrate-passwords.ts` to bcrypt-hash any legacy entries.
		console.error(
			"[AUTH] Rejecting login: stored password is not bcrypt-hashed. Run the migrate-passwords script.",
		);
		return false;
	}

	return compare(plainPassword, passwordHash);
};
