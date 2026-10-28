// Regression: an expired JWT on the socket.io handshake used to throw out of
// the io.use middleware and crash the process (TokenExpiredError, status=1).
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "test-secret";
process.env.CORS_ALLOWED_ORIGINS = "http://localhost";

const { initSocketIO } = await import("../src/services/realtime.service");

const server = createServer();
initSocketIO(server);
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address() as AddressInfo;

const expired = jwt.sign(
	{
		sub: "u1",
		email: "a@b.c",
		role: "user",
		exp: Math.floor(Date.now() / 1000) - 60,
	},
	"test-secret",
);

const res = await fetch(
	`http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling`,
);
const sid = JSON.parse((await res.text()).slice(1)).sid as string;
const url = `http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling&sid=${sid}`;
await fetch(url, {
	method: "POST",
	body: `40${JSON.stringify({ token: expired })}`,
});
const reply = await (await fetch(url)).text();

server.close();
if (!reply.includes("Invalid or expired token")) {
	console.error("FAIL: expected connect_error, got", reply);
	process.exit(1);
}
console.log("PASS: expired token rejected with connect_error, process alive");
process.exit(0);
