/**
 * Server-side DB queries for the receptionist call log + booked jobs dashboard.
 * Uses eval("require")("pg") to bypass webpack bundling (same pattern as lib/db.ts).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pool: any = null;

function getPool(): {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
} {
  if (_pool) return _pool as typeof _pool;
  const { Pool: PgPool } = eval("require")("pg") as {
    Pool: new (config: Record<string, unknown>) => {
      query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    };
  };
  _pool = new PgPool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return _pool as typeof _pool;
}

async function runQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const pool = getPool();
  const res = await pool.query(sql, params);
  return res.rows as T[];
}

export interface CallSummary {
  id: string;
  caller_phone: string;
  called_at: string;
  duration_seconds: number | null;
  intent: string | null;
  intent_confidence: number | null;
  outcome: string | null;
  status: string;
  booking_id: string | null;
}

export interface DashboardStats {
  total_calls: number;
  booked_calls: number;
  missed_calls: number;
  jobs_recovered: number;
}

export interface ConsentEvent {
  id: string;
  event_type: string;
  occurred_at: string;
  metadata: Record<string, unknown> | null;
}

export interface CallDetail {
  id: string;
  caller_phone: string;
  called_at: string;
  duration_seconds: number | null;
  transcript: string | null;
  intent: string | null;
  intent_confidence: number | null;
  intent_reasoning: string | null;
  outcome: string | null;
  status: string;
  provider: string | null;
  booking_id: string | null;
  booking_scheduled_at: string | null;
  booking_job_type: string | null;
  consent_events: ConsentEvent[];
}

export async function getDashboardStats(contractorId: string): Promise<DashboardStats> {
  const rows = await runQuery<{
    total_calls: string;
    booked_calls: string;
    missed_calls: string;
    jobs_recovered: string;
  }>(
    `
    SELECT
      COUNT(*)::int                                                  AS total_calls,
      COUNT(*) FILTER (WHERE c.outcome = 'booked')::int             AS booked_calls,
      COUNT(*) FILTER (WHERE c.status = 'missed')::int              AS missed_calls,
      COUNT(DISTINCT c.id) FILTER (
        WHERE c.status = 'missed' AND b.id IS NOT NULL
      )::int                                                         AS jobs_recovered
    FROM calls c
    LEFT JOIN bookings b ON b.call_id = c.id
    WHERE c.contractor_id = $1
    `,
    [contractorId],
  );
  const row = rows[0] ?? { total_calls: "0", booked_calls: "0", missed_calls: "0", jobs_recovered: "0" };
  return {
    total_calls: Number(row.total_calls),
    booked_calls: Number(row.booked_calls),
    missed_calls: Number(row.missed_calls),
    jobs_recovered: Number(row.jobs_recovered),
  };
}

export async function getCallLogs(
  contractorId: string,
  limit = 50,
  offset = 0,
): Promise<CallSummary[]> {
  return runQuery<CallSummary>(
    `
    SELECT
      c.id,
      c.caller_phone,
      c.called_at,
      c.duration_seconds,
      c.intent,
      c.intent_confidence,
      c.outcome,
      c.status,
      b.id AS booking_id
    FROM calls c
    LEFT JOIN bookings b ON b.call_id = c.id
    WHERE c.contractor_id = $1
    ORDER BY c.called_at DESC
    LIMIT $2 OFFSET $3
    `,
    [contractorId, limit, offset],
  );
}

export async function getCallDetail(
  callId: string,
  contractorId: string,
): Promise<CallDetail | null> {
  const calls = await runQuery<Omit<CallDetail, "consent_events">>(
    `
    SELECT
      c.id,
      c.caller_phone,
      c.called_at,
      c.duration_seconds,
      c.transcript,
      c.intent,
      c.intent_confidence,
      c.intent_reasoning,
      c.outcome,
      c.status,
      c.provider,
      b.id               AS booking_id,
      b.scheduled_at     AS booking_scheduled_at,
      b.job_type         AS booking_job_type
    FROM calls c
    LEFT JOIN bookings b ON b.call_id = c.id
    WHERE c.id = $1 AND c.contractor_id = $2
    LIMIT 1
    `,
    [callId, contractorId],
  );
  if (calls.length === 0) return null;

  const consentEvents = await runQuery<ConsentEvent>(
    `
    SELECT id, event_type, occurred_at, metadata
    FROM consent_events
    WHERE call_id = $1
    ORDER BY occurred_at ASC
    `,
    [callId],
  );

  return { ...calls[0], consent_events: consentEvents };
}
