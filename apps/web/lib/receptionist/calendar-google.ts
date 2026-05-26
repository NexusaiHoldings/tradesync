/**
 * Google Calendar client for the receptionist domain.
 *
 * OAuth2 flow, token storage/refresh, FreeBusy availability checks,
 * and calendar event creation via Google Calendar REST API.
 * All HTTP calls use native fetch — no googleapis SDK required.
 *
 * Tables created on first use:
 *   calendar_tokens — contractor OAuth tokens (access + refresh)
 */

import { randomUUID } from "node:crypto";

// ── constants ─────────────────────────────────────────────────────────────

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
].join(" ");

// ── types ─────────────────────────────────────────────────────────────────

export interface CalendarTokenRow {
  id: string;
  contractor_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scope: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateEventInput {
  summary: string;
  description: string;
  start: Date;
  end: Date;
  attendeeEmail?: string;
  calendarId?: string;
}

export interface CreatedEvent {
  eventId: string;
  htmlLink: string;
  calendarId: string;
}

export interface FreeBusyResult {
  available: boolean;
  busySlots: Array<{ start: string; end: string }>;
}

// ── DB pool ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pgPool: any = null;

function getPool(): {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
} {
  if (_pgPool) return _pgPool;
  const { Pool: PgPool } = eval("require")("pg") as {
    Pool: new (config: Record<string, unknown>) => {
      query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    };
  };
  _pgPool = new PgPool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30_000,
  });
  return _pgPool;
}

async function dbQuery<T = Record<string, unknown>>(
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const pool = getPool();
  const res = await pool.query(sql, params);
  return res.rows as T[];
}

async function dbExecute(sql: string, ...params: unknown[]): Promise<void> {
  const pool = getPool();
  await pool.query(sql, params);
}

// ── schema init ───────────────────────────────────────────────────────────

let _calendarSchemaReady = false;

async function ensureCalendarSchema(): Promise<void> {
  if (_calendarSchemaReady) return;
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS calendar_tokens (
      id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      contractor_id text        NOT NULL,
      access_token  text        NOT NULL,
      refresh_token text,
      expires_at    timestamptz,
      scope         text,
      created_at    timestamptz NOT NULL DEFAULT NOW(),
      updated_at    timestamptz NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS calendar_tokens_contractor_id_uidx
      ON calendar_tokens(contractor_id)
  `);
  _calendarSchemaReady = true;
}

// ── OAuth config helpers ──────────────────────────────────────────────────

function googleClientId(): string {
  const val = process.env.GOOGLE_CLIENT_ID;
  if (!val) throw new Error("calendar-google: GOOGLE_CLIENT_ID env var not set");
  return val;
}

function googleClientSecret(): string {
  const val = process.env.GOOGLE_CLIENT_SECRET;
  if (!val) throw new Error("calendar-google: GOOGLE_CLIENT_SECRET env var not set");
  return val;
}

function googleRedirectUri(): string {
  const base = (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/connect/calendar`;
}

// ── public OAuth API ──────────────────────────────────────────────────────

/**
 * Returns the Google OAuth2 authorization URL.
 * `state` encodes the contractor's ID so the callback can associate
 * tokens with the correct account.
 */
export function buildOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: googleClientId(),
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: CALENDAR_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchanges an authorization code (from the OAuth callback) for tokens.
 */
export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
  scope: string;
}> {
  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `calendar-google: token exchange failed (${resp.status}): ${text.slice(0, 500)}`,
    );
  }
  return resp.json() as Promise<{
    access_token: string;
    refresh_token: string | null;
    expires_in: number;
    scope: string;
  }>;
}

// ── token CRUD ────────────────────────────────────────────────────────────

export async function storeCalendarTokens(
  contractorId: string,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: Date | null,
  scope: string | null,
): Promise<void> {
  await ensureCalendarSchema();
  await dbExecute(
    `INSERT INTO calendar_tokens
       (id, contractor_id, access_token, refresh_token, expires_at, scope, created_at, updated_at)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (contractor_id) DO UPDATE
       SET access_token  = EXCLUDED.access_token,
           refresh_token = COALESCE(EXCLUDED.refresh_token, calendar_tokens.refresh_token),
           expires_at    = EXCLUDED.expires_at,
           scope         = EXCLUDED.scope,
           updated_at    = NOW()`,
    randomUUID(),
    contractorId,
    accessToken,
    refreshToken,
    expiresAt?.toISOString() ?? null,
    scope,
  );
}

export async function getCalendarTokenRow(
  contractorId: string,
): Promise<CalendarTokenRow | null> {
  await ensureCalendarSchema();
  const rows = await dbQuery<CalendarTokenRow>(
    "SELECT * FROM calendar_tokens WHERE contractor_id = $1 LIMIT 1",
    contractorId,
  );
  return rows[0] ?? null;
}

export async function deleteCalendarTokens(contractorId: string): Promise<void> {
  await ensureCalendarSchema();
  await dbExecute(
    "DELETE FROM calendar_tokens WHERE contractor_id = $1",
    contractorId,
  );
}

// ── token refresh ─────────────────────────────────────────────────────────

async function refreshAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      grant_type: "refresh_token",
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `calendar-google: token refresh failed (${resp.status}): ${text.slice(0, 500)}`,
    );
  }
  return resp.json() as Promise<{ access_token: string; expires_in: number }>;
}

/**
 * Returns a valid access token for the contractor, refreshing automatically
 * when the stored token is expired or will expire within 60 seconds.
 */
export async function getValidAccessToken(contractorId: string): Promise<string> {
  const row = await getCalendarTokenRow(contractorId);
  if (!row) {
    throw new Error(
      `calendar-google: no OAuth tokens found for contractor ${contractorId}`,
    );
  }

  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null;
  const expiresWithin60s = expiresAt !== null && Date.now() + 60_000 >= expiresAt;

  if (expiresWithin60s && row.refresh_token) {
    const refreshed = await refreshAccessToken(row.refresh_token);
    const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
    await storeCalendarTokens(
      contractorId,
      refreshed.access_token,
      row.refresh_token,
      newExpiresAt,
      row.scope,
    );
    return refreshed.access_token;
  }

  return row.access_token;
}

// ── availability checking ─────────────────────────────────────────────────

export async function checkContractorAvailability(
  contractorId: string,
  start: Date,
  end: Date,
  calendarId = "primary",
): Promise<FreeBusyResult> {
  const accessToken = await getValidAccessToken(contractorId);
  const resp = await fetch(`${CALENDAR_API}/freeBusy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      items: [{ id: calendarId }],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `calendar-google: freeBusy failed (${resp.status}): ${text.slice(0, 500)}`,
    );
  }
  const data = (await resp.json()) as {
    calendars: Record<string, { busy: Array<{ start: string; end: string }> }>;
  };
  const busy = data.calendars[calendarId]?.busy ?? [];
  return { available: busy.length === 0, busySlots: busy };
}

// ── event creation ────────────────────────────────────────────────────────

export async function createContractorEvent(
  contractorId: string,
  input: CreateEventInput,
): Promise<CreatedEvent> {
  const accessToken = await getValidAccessToken(contractorId);
  const calendarId = input.calendarId ?? "primary";

  const eventBody: Record<string, unknown> = {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.start.toISOString(), timeZone: "UTC" },
    end: { dateTime: input.end.toISOString(), timeZone: "UTC" },
  };
  if (input.attendeeEmail) {
    eventBody.attendees = [{ email: input.attendeeEmail }];
  }

  const resp = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventBody),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `calendar-google: create event failed (${resp.status}): ${text.slice(0, 500)}`,
    );
  }
  const created = (await resp.json()) as { id: string; htmlLink: string };
  return { eventId: created.id, htmlLink: created.htmlLink, calendarId };
}
