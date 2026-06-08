/**
 * get-google-tokens.ts
 * 
 * Exchange an authorization code for a refresh token.
 * Usage: bun run scratch/get-google-tokens.ts <AUTH_CODE>
 */
import { config } from "dotenv";
import { google } from "googleapis";

config();

const code = process.argv[2];
if (!code) {
	console.error("Usage: bun run scratch/get-google-tokens.ts <AUTH_CODE>");
	process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
	process.env.GMAIL_CLIENT_ID,
	process.env.GMAIL_CLIENT_SECRET,
	process.env.GMAIL_REDIRECT_URI ?? "http://localhost:3001/oauth/callback",
);

const { tokens } = await oauth2Client.getToken(code);
console.log("\n✅ Tokens received:\n");
console.log(JSON.stringify(tokens, null, 2));
console.log("\n📋 Copy the refresh_token below into your .env as GMAIL_REFRESH_TOKEN=");
console.log("\nGMAIL_REFRESH_TOKEN=" + tokens.refresh_token);
