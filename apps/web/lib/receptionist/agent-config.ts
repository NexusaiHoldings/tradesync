'use server';

import { Pool } from 'pg';

export type TradeType =
  | 'hvac'
  | 'electrical'
  | 'landscaping'
  | 'plumbing'
  | 'roofing'
  | 'general';

export interface DayHours {
  open: string;
  close: string;
  enabled: boolean;
}

export interface BusinessHours {
  monday: DayHours;
  tuesday: DayHours;
  wednesday: DayHours;
  thursday: DayHours;
  friday: DayHours;
  saturday: DayHours;
  sunday: DayHours;
}

export interface AgentConfig {
  id: string;
  orgId: string;
  tradeType: TradeType;
  businessHours: BusinessHours;
  emergencyPhone: string;
  greetingText: string;
  serviceZipCodes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UpsertAgentConfigInput {
  orgId: string;
  tradeType: TradeType;
  businessHours: BusinessHours;
  emergencyPhone: string;
  greetingText: string;
  serviceZipCodes: string[];
}

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is not configured');
    }
    _pool = new Pool({ connectionString: url });
  }
  return _pool;
}

async function ensureTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS receptionist_agent_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id TEXT NOT NULL UNIQUE,
      trade_type TEXT NOT NULL,
      business_hours JSONB NOT NULL,
      emergency_phone TEXT NOT NULL,
      greeting_text TEXT NOT NULL,
      service_zip_codes TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function rowToConfig(row: Record<string, unknown>): AgentConfig {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    tradeType: row.trade_type as TradeType,
    businessHours: row.business_hours as BusinessHours,
    emergencyPhone: row.emergency_phone as string,
    greetingText: row.greeting_text as string,
    serviceZipCodes: row.service_zip_codes as string[],
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export async function getAgentConfig(orgId: string): Promise<AgentConfig | null> {
  const pool = getPool();
  await ensureTable(pool);
  const result = await pool.query(
    `SELECT id, org_id, trade_type, business_hours, emergency_phone, greeting_text,
            service_zip_codes, created_at, updated_at
     FROM receptionist_agent_configs
     WHERE org_id = $1`,
    [orgId],
  );
  if (result.rows.length === 0) return null;
  return rowToConfig(result.rows[0]);
}

export async function upsertAgentConfig(input: UpsertAgentConfigInput): Promise<AgentConfig> {
  if (!input.orgId) throw new Error('orgId is required');
  if (!input.tradeType) throw new Error('tradeType is required');
  if (!input.emergencyPhone) throw new Error('emergencyPhone is required');
  if (!input.greetingText) throw new Error('greetingText is required');

  const pool = getPool();
  await ensureTable(pool);

  const result = await pool.query(
    `INSERT INTO receptionist_agent_configs
       (org_id, trade_type, business_hours, emergency_phone, greeting_text, service_zip_codes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (org_id) DO UPDATE SET
       trade_type     = EXCLUDED.trade_type,
       business_hours = EXCLUDED.business_hours,
       emergency_phone = EXCLUDED.emergency_phone,
       greeting_text  = EXCLUDED.greeting_text,
       service_zip_codes = EXCLUDED.service_zip_codes,
       updated_at     = NOW()
     RETURNING id, org_id, trade_type, business_hours, emergency_phone, greeting_text,
               service_zip_codes, created_at, updated_at`,
    [
      input.orgId,
      input.tradeType,
      JSON.stringify(input.businessHours),
      input.emergencyPhone,
      input.greetingText,
      input.serviceZipCodes,
    ],
  );

  return rowToConfig(result.rows[0]);
}
