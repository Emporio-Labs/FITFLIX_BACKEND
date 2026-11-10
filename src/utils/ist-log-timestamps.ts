// Stamps every console line with IST so logs read in the business timezone.
// Fixed +05:30 offset rather than Intl: IST has no DST, and this must not
// depend on the host's timezone database (see the startup check in index.ts).
const IST_OFFSET_MS = 330 * 60_000;

export function istTimestamp(date: Date = new Date()): string {
	const shifted = new Date(date.getTime() + IST_OFFSET_MS).toISOString();
	return `${shifted.slice(0, 10)} ${shifted.slice(11, 23)} IST`;
}

const LEVELS = ["log", "info", "warn", "error", "debug"] as const;

for (const level of LEVELS) {
	const original = console[level].bind(console);
	console[level] = (...args: unknown[]) => {
		const prefix = `[${istTimestamp()}]`;
		// Merge into a leading string so printf-style "%s" formats still work.
		if (typeof args[0] === "string") {
			original(`${prefix} ${args[0]}`, ...args.slice(1));
		} else {
			original(prefix, ...args);
		}
	};
}
