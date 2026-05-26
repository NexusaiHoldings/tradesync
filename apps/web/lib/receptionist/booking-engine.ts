/**
 * Booking engine for the receptionist domain.
 *
 * Orchestrates: availability check → Google Calendar event creation →
 * SMS confirmation to caller via Twilio.
 *
 * Retry: up to 3 attempts with exponential back-off (500 ms, 1 s, 2 s).
 * On persistent failure, writes to receptionist_escalations for ops
 * visibility (feasibility_analysis key_technical_risk #1: calendar sync
 * failures causing silent booking gaps).
 *
 * Tables created on first use:
 *   receptionist_bookings    — booking lifecycle (pending → confirmed/failed)
 *   receptionist_escalations — failed booking audit log for ops team
 */

import { randomUUID } from "node:crypto";
import {
  checkContractorAvailability,
  createContractorEvent,
  type CreateEventInput,
} from "./calendar-google";

// ── types ─────────────────────────────────────────────────────────────────

export interface BookingRequest {
  callId: string;
  contractorId: string;
  callerPhone: string;
  callerName?: string;
  startTime: Date;
  endTime: Date;
  summary: string;
  description?: string;
  calendarId?: string;
}

export interface BookingResult {
  success: boolean;
  bookingId: string;
  googleEventId: string | null;
  googleEventLink: string | null;
  smsSent: boolean;
  smsError: string | null;
  error?: string;
}

// ── DB pool ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pool: any = null;

function getPool(): {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
} {
  if (_pool) return _pool;
  const { Pool: PgPool } = eval("require")("pg") as {
    Pool: new (config: Record<string, unknown>) => {
      query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    };
  };
  _pool = new PgPool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30_000,
  });
  return _pool;
}

async function dbExecute(sql: string, ...params: unknown[]): Promise<void> {
  const pool = getPool();
  await pool.query(sql, params);
}

// ── schema init ───────────────────────────────────────────────────────────

let _schemaReady = false;

async function ensureBookingSchema(): Promise<void> {
  if (_schemaReady) return;
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS receptionist_bookings (
      id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      call_id            text,
      contractor_id      text        NOT NULL,
      caller_phone       text        NOT NULL,
      event_start        timestamptz NOT NULL,
      event_end          timestamptz NOT NULL,
      summary            text,
      description        text,
      google_event_id    text,
      google_event_link  text,
      google_calendar_id text,
      status             text        NOT NULL DEFAULT 'pending',
      sms_sent           boolean     NOT NULL DEFAULT false,
      sms_message_id     text,
      created_at         timestamptz NOT NULL DEFAULT NOW(),
      updated_at         timestamptz NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS receptionist_bookings_call_id_idx
      ON receptionist_bookings(call_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS receptionist_bookings_contractor_idx
      ON receptionist_bookings(contractor_id)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS receptionist_escalations (
      id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      booking_id    uuid,
      call_id       text,
      contractor_id text,
      error_type    text        NOT NULL,
      error_message text        NOT NULL,
      payload       jsonb,
      resolved      boolean     NOT NULL DEFAULT false,
      created_at    timestamptz NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS receptionist_escalations_booking_idx
      ON receptionist_escalations(booking_id)
  `);
  _schemaReady = true;
}

// ── retry helper ──────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  baseDelayMs: number,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastErr;
}

// ── escalation writer ─────────────────────────────────────────────────────

async function writeEscalation(
  bookingId: string | null,
  callId: string,
  contractorId: string,
  errorType: string,
  errorMessage: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await dbExecute(
      `INSERT INTO receptionist_escalations
         (id, booking_id, call_id, contractor_id, error_type, error_message, payload, created_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb, NOW())`,
      randomUUID(),
      bookingId,
      callId,
      contractorId,
      errorType,
      errorMessage.slice(0, 2000),
      JSON.stringify(payload),
    );
  } catch (dbErr) {
    console.error("[booking-engine] escalation write failed:", dbErr);
  }
}

// ── SMS confirmation ──────────────────────────────────────────────────────

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

async function sendBookingConfirmationSms(
  toPhone: string,
  startTime: Date,
  bookingId: string,
): Promise<{ success: boolean; messageId: string | null; error: string | null }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromPhone = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromPhone) {
    console.warn("[booking-engine] Twilio not configured — SMS skipped");
    return { success: false, messageId: null, error: "twilio_not_configured" };
  }

  const startFormatted = startTime.toLocaleString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const smsBody = `Booking confirmed! Your appointment is on ${startFormatted}. Ref: ${bookingId.slice(0, 8).toUpperCase()}`;

  const url = `${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: toPhone, From: fromPhone, Body: smsBody }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await resp.json()) as Record<string, unknown>;
    if (resp.status >= 400) {
      return {
        success: false,
        messageId: null,
        error: String(data.message ?? `twilio status ${resp.status}`),
      };
    }
    return { success: true, messageId: String(data.sid ?? ""), error: null };
  } catch (err) {
    return { success: false, messageId: null, error: String(err) };
  }
}

// ── main export ───────────────────────────────────────────────────────────

export async function bookAppointment(request: BookingRequest): Promise<BookingResult> {
  await ensureBookingSchema();

  const bookingId = randomUUID();

  await dbExecute(
    `INSERT INTO receptionist_bookings
       (id, call_id, contractor_id, caller_phone, event_start, event_end,
        summary, description, status, created_at, updated_at)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, 'pending', NOW(), NOW())`,
    bookingId,
    request.callId,
    request.contractorId,
    request.callerPhone,
    request.startTime.toISOString(),
    request.endTime.toISOString(),
    request.summary,
    request.description ?? "",
  );

  try {
    const availability = await withRetry(
      () =>
        checkContractorAvailability(
          request.contractorId,
          request.startTime,
          request.endTime,
          request.calendarId ?? "primary",
        ),
      3,
      500,
    );

    if (!availability.available) {
      await dbExecute(
        "UPDATE receptionist_bookings SET status = 'unavailable', updated_at = NOW() WHERE id = $1::uuid",
        bookingId,
      );
      return {
        success: false,
        bookingId,
        googleEventId: null,
        googleEventLink: null,
        smsSent: false,
        smsError: null,
        error: "contractor_unavailable",
      };
    }

    const eventInput: CreateEventInput = {
      summary: request.summary,
      description: request.description ?? "",
      start: request.startTime,
      end: request.endTime,
      calendarId: request.calendarId,
    };
    const createdEvent = await withRetry(
      () => createContractorEvent(request.contractorId, eventInput),
      3,
      500,
    );

    await dbExecute(
      `UPDATE receptionist_bookings
         SET google_event_id    = $1,
             google_event_link  = $2,
             google_calendar_id = $3,
             status             = 'confirmed',
             updated_at         = NOW()
       WHERE id = $4::uuid`,
      createdEvent.eventId,
      createdEvent.htmlLink,
      createdEvent.calendarId,
      bookingId,
    );

    const smsResult = await sendBookingConfirmationSms(
      request.callerPhone,
      request.startTime,
      bookingId,
    );
    if (smsResult.success) {
      await dbExecute(
        `UPDATE receptionist_bookings
           SET sms_sent = true, sms_message_id = $1, updated_at = NOW()
         WHERE id = $2::uuid`,
        smsResult.messageId,
        bookingId,
      );
    }

    return {
      success: true,
      bookingId,
      googleEventId: createdEvent.eventId,
      googleEventLink: createdEvent.htmlLink,
      smsSent: smsResult.success,
      smsError: smsResult.error,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[booking-engine] booking ${bookingId} failed:`, msg);

    await dbExecute(
      "UPDATE receptionist_bookings SET status = 'failed', updated_at = NOW() WHERE id = $1::uuid",
      bookingId,
    );

    await writeEscalation(
      bookingId,
      request.callId,
      request.contractorId,
      "booking_failed",
      msg,
      {
        booking_id: bookingId,
        start_time: request.startTime.toISOString(),
        end_time: request.endTime.toISOString(),
        caller_phone: request.callerPhone,
        contractor_id: request.contractorId,
      },
    );

    return {
      success: false,
      bookingId,
      googleEventId: null,
      googleEventLink: null,
      smsSent: false,
      smsError: null,
      error: msg,
    };
  }
}
