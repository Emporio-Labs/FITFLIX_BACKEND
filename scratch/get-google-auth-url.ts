/**
 * get-google-auth-url.ts
 * 
 * Run this script once to get the Google OAuth authorization URL.
 * Visit the URL in your browser, authorize, then paste the code below
 * into get-google-tokens.ts to get a fresh refresh token.
 */
import { config } from "dotenv";
import { google } from "googleapis";

config();

const oauth2Client = new google.auth.OAuth2(
	process.env.GMAIL_CLIENT_ID,
	process.env.GMAIL_CLIENT_SECRET,
	process.env.GMAIL_REDIRECT_URI ?? "http://localhost:3001/oauth/callback",
);

const authUrl = oauth2Client.generateAuthUrl({
	access_type: "offline",
	prompt: "consent", // forces refresh_token in response
	scope: [
		"https://www.googleapis.com/auth/calendar.events",
		"https://www.googleapis.com/auth/calendar",
	],
});

console.log("\n🔗 Open this URL in your browser to authorize Google Meet access:\n");
console.log(authUrl);
console.log("\nAfter authorizing, you will be redirected to:");
console.log(process.env.GMAIL_REDIRECT_URI ?? "http://localhost:3001/oauth/callback");
console.log("\nCopy the 'code' query parameter from the redirect URL.");
console.log("Then run: bun run scratch/get-google-tokens.ts <code>");
