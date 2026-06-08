/**
 * google-meet.service.ts
 *
 * Creates a real Google Meet link by inserting a Google Calendar event
 * using the project's existing OAuth2 credentials (GMAIL_CLIENT_ID /
 * GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN).
 *
 * The Calendar API auto-generates a Google Meet conferenceData entry
 * when `conferenceDataVersion=1` is sent with the request.
 */

import { google } from "googleapis";

const getOAuth2Client = () => {
	const clientId = process.env.GMAIL_CLIENT_ID;
	const clientSecret = process.env.GMAIL_CLIENT_SECRET;
	const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

	if (!clientId || !clientSecret || !refreshToken) {
		throw new Error(
			"Google OAuth credentials are not configured. " +
				"Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN in your .env",
		);
	}

	const oauth2Client = new google.auth.OAuth2(
		clientId,
		clientSecret,
		process.env.GMAIL_REDIRECT_URI ?? "http://localhost:3001/oauth/callback",
	);
	oauth2Client.setCredentials({ refresh_token: refreshToken });
	return oauth2Client;
};

export interface CreateMeetLinkParams {
	/** Human-readable summary shown in Google Calendar */
	summary: string;
	/** ISO 8601 start datetime (e.g. "2026-06-10T10:00:00+05:30") */
	startTime: string;
	/** ISO 8601 end datetime */
	endTime: string;
	/** Optional attendee emails to add to the invite */
	attendeeEmails?: string[];
	/** Timezone string (e.g. "Asia/Kolkata") */
	timezone?: string;
}

/**
 * Creates a Google Calendar event with a Google Meet link and returns the
 * generated meet URL (e.g. "https://meet.google.com/abc-defg-hij").
 *
 * Falls back to null if Calendar API call fails so callers can use
 * a safe fallback URL.
 */
export async function createGoogleMeetLink(
	params: CreateMeetLinkParams,
): Promise<string | null> {
	try {
		const auth = getOAuth2Client();
		const calendar = google.calendar({ version: "v3", auth });

		const event = await calendar.events.insert({
			calendarId: "primary",
			conferenceDataVersion: 1, // <-- triggers Meet link creation
			requestBody: {
				summary: params.summary,
				start: {
					dateTime: params.startTime,
					timeZone: params.timezone ?? "Asia/Kolkata",
				},
				end: {
					dateTime: params.endTime,
					timeZone: params.timezone ?? "Asia/Kolkata",
				},
				attendees: (params.attendeeEmails ?? []).map((email) => ({ email })),
				conferenceData: {
					createRequest: {
						requestId: `fitflix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
						conferenceSolutionKey: { type: "hangoutsMeet" },
					},
				},
			},
		});

		const meetLink =
			event.data.conferenceData?.entryPoints?.find(
				(ep) => ep.entryPointType === "video",
			)?.uri ?? null;

		if (meetLink) {
			console.log(`[Google Meet] Created link: ${meetLink}`);
		} else {
			console.warn("[Google Meet] Event created but no Meet link returned:", JSON.stringify(event.data.conferenceData));
		}

		return meetLink;
	} catch (err: any) {
		console.error("[Google Meet] Failed to create Google Meet link:", err?.message ?? err);
		return null;
	}
}
