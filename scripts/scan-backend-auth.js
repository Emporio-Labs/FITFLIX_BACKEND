import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BACKEND_TARGETS = [
	"jwt.verify",
	"Bearer",
	"401",
	"403",
	"cors",
	"res.status",
	"header",
	"Authorization",
];
const IGNORE_DIRS = ["node_modules", "dist", ".git"];

function scanBackend(dir) {
	const files = readdirSync(dir);
	for (const file of files) {
		const fullPath = join(dir, file);
		if (IGNORE_DIRS.some((d) => fullPath.includes(d))) continue;

		if (statSync(fullPath).isDirectory()) {
			scanBackend(fullPath);
		} else if (/\.(ts|js)$/.test(file)) {
			const content = readFileSync(fullPath, "utf8");
			const lines = content.split("\n");
			lines.forEach((line, index) => {
				BACKEND_TARGETS.forEach((target) => {
					if (line.includes(target)) {
						console.log(
							`[BACKEND] ${fullPath}:${index + 1} -> Target: ${target}`,
						);
						console.log(`   Code: ${line.trim()}`);
					}
				});
			});
		}
	}
}
scanBackend(".");
