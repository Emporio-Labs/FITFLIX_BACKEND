import readline from "node:readline";
import { google } from "googleapis";

// paste your credentials here directly to run this script
const CLIENT_ID =
	"705518867246-mlg7sdk378f7409kjt824fhq74pjp56r.apps.googleusercontent.com";
const CLIENT_SECRET = "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";
const REDIRECT_URI = "http://localhost:3001/oauth/callback";

const oauth2Client = new google.auth.OAuth2(
	CLIENT_ID,
	CLIENT_SECRET,
	REDIRECT_URI,
);

const SCOPES = [
	"https://www.googleapis.com/auth/gmail.readonly",
	"https://www.googleapis.com/auth/gmail.modify",
];

const parseAuthCodeInput = (input) => {
	const raw = input.trim();
	if (!raw) return "";

	// Accept full redirect URL, raw query string, or direct code value.
	if (raw.includes("code=")) {
		const queryStart = raw.indexOf("?");
		const queryText = queryStart >= 0 ? raw.slice(queryStart + 1) : raw;
		const params = new URLSearchParams(queryText);
		const codeFromParams = params.get("code");
		if (codeFromParams) {
			return codeFromParams.trim();
		}
	}

	return raw;
};

// step 1 — generate the auth URL and open it in browser
const authUrl = oauth2Client.generateAuthUrl({
	access_type: "offline", // this ensures we get a refresh_token
	prompt: "consent", // force consent screen so refresh token is always returned
	scope: SCOPES,
});

console.log("\n--------------------------------------------------");
console.log("1. Open this URL in your browser:\n");
console.log(authUrl);
console.log("\n--------------------------------------------------");
console.log("2. Login with the Gmail account that receives HPOD emails");
console.log(
	"3. After approval, you'll be redirected to localhost (page will fail to load — that's fine)",
);
console.log(
	"4. Copy the 'code' value from the URL in your browser address bar",
);
console.log(
	"   It looks like: http://localhost:3001/oauth/callback?code=4/0XXXXX...",
);
console.log("--------------------------------------------------\n");

// step 2 — paste the code from the redirect URL
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

rl.question("Paste the code here: ", async (code) => {
	rl.close();

	try {
		const authCode = parseAuthCodeInput(code);
		if (!authCode) {
			throw new Error("No OAuth code found in input.");
		}

		const { tokens } = await oauth2Client.getToken(authCode);
		console.log("\n--------------------------------------------------");
		console.log("SUCCESS. Add this to your .env:\n");
		console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
		console.log("--------------------------------------------------\n");
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		console.error("Error getting token:", errorMessage);
		console.error(
			"Tip: paste either the full redirect URL or only the code= value.",
		);
	}
});
