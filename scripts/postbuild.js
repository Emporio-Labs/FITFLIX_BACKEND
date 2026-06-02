import fs from "node:fs";
import path from "node:path";

const filePath = path.resolve("api/index.bundle.cjs");
if (fs.existsSync(filePath)) {
	fs.appendFileSync(filePath, "\nmodule.exports = handler;\n");
	console.log("✓ Successfully appended handler export to api/index.bundle.cjs");
} else {
	console.error("✗ Error: api/index.bundle.cjs not found!");
	process.exit(1);
}
