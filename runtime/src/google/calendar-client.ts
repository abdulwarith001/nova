import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import type { calendar_v3 } from "googleapis";
import type { GoogleCredentials } from "./gmail-client.js";

export interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  location: string;
  attendees: string[];
  status: string;
  htmlLink: string;
}

/**
 * Google Calendar API client for Nova.
 * Handles listing, creating, and searching calendar events.
 */
export class CalendarClient {
  private oauth2Client: OAuth2Client;
  private calendar: calendar_v3.Calendar;

  constructor(credentials: GoogleCredentials) {
    this.oauth2Client = new google.auth.OAuth2(
      credentials.clientId,
      credentials.clientSecret,
      "http://localhost:18790/oauth/callback",
    );
    this.oauth2Client.setCredentials({
      refresh_token: credentials.refreshToken,
    });
    this.calendar = google.calendar({ version: "v3", auth: this.oauth2Client });
  }

  async listEvents(params: {
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
  }): Promise<CalendarEvent[]> {
    const now = new Date();
    const timeMin = params.timeMin || now.toISOString();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const timeMax = params.timeMax || weekFromNow.toISOString();

    const response = await this.calendar.events.list({
      calendarId: "primary",
      timeMin,
      timeMax,
      maxResults: params.maxResults || 15,
      singleEvents: true,
      orderBy: "startTime",
    });

    return (response.data.items || []).map((event) => this.toEvent(event));
  }

  async createEvent(params: {
    summary: string;
    start: string;
    end: string;
    description?: string;
    location?: string;
    attendees?: string[];
  }): Promise<CalendarEvent> {
    const event: calendar_v3.Schema$Event = {
      summary: params.summary,
      description: params.description,
      location: params.location,
      start: {
        dateTime: params.start,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      end: {
        dateTime: params.end,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    };

    if (params.attendees?.length) {
      event.attendees = params.attendees.map((email) => ({ email }));
    }

    const response = await this.calendar.events.insert({
      calendarId: "primary",
      requestBody: event,
      sendUpdates: params.attendees?.length ? "all" : "none",
    });

    return this.toEvent(response.data);
  }

  async searchEvents(query: string): Promise<CalendarEvent[]> {
    const now = new Date();
    const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    const sixMonthsAhead = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);

    const response = await this.calendar.events.list({
      calendarId: "primary",
      q: query,
      timeMin: sixMonthsAgo.toISOString(),
      timeMax: sixMonthsAhead.toISOString(),
      maxResults: 15,
      singleEvents: true,
      orderBy: "startTime",
    });

    return (response.data.items || []).map((event) => this.toEvent(event));
  }

  private toEvent(event: calendar_v3.Schema$Event): CalendarEvent {
    return {
      id: event.id || "",
      summary: event.summary || "(no title)",
      description: event.description || "",
      start: event.start?.dateTime || event.start?.date || "",
      end: event.end?.dateTime || event.end?.date || "",
      location: event.location || "",
      attendees: (event.attendees || [])
        .map((a) => a.email || "")
        .filter(Boolean),
      status: event.status || "",
      htmlLink: event.htmlLink || "",
    };
  }
}
