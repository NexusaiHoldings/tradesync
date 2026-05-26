/**
 * Emergency Escalation Engine — deterministic keyword bypass for HVAC calls.
 *
 * Per liability_assessor and CEO/COO research_direction, emergency keywords MUST
 * trigger a hardcoded transfer BEFORE any LLM evaluation. This is a non-negotiable
 * architectural element, not a prompt-engineering afterthought.
 *
 * Emergency misrouting is rated 'critical' severity by the liability_assessor.
 */

export type EmergencySeverity = "critical" | "high" | "medium" | "low";

export interface EmergencyKeyword {
  readonly keyword: string;
  readonly severity: EmergencySeverity;
  readonly category: string;
}

/**
 * Hardcoded deterministic emergency keyword table.
 * Evaluated BEFORE any LLM call — never gated on AI availability.
 */
export const EMERGENCY_KEYWORDS: readonly EmergencyKeyword[] = [
  { keyword: "gas leak", severity: "critical", category: "gas_hazard" },
  { keyword: "gas smell", severity: "critical", category: "gas_hazard" },
  { keyword: "smell gas", severity: "critical", category: "gas_hazard" },
  { keyword: "smell of gas", severity: "critical", category: "gas_hazard" },
  { keyword: "electrical fire", severity: "critical", category: "fire_hazard" },
  { keyword: "house fire", severity: "critical", category: "fire_hazard" },
  { keyword: "flooding", severity: "critical", category: "water_hazard" },
  { keyword: "burst pipe", severity: "critical", category: "water_hazard" },
  { keyword: "pipe burst", severity: "critical", category: "water_hazard" },
  { keyword: "carbon monoxide", severity: "critical", category: "co_hazard" },
  { keyword: "co detector", severity: "critical", category: "co_hazard" },
  { keyword: "co alarm", severity: "critical", category: "co_hazard" },
  { keyword: "no heat", severity: "high", category: "heating_failure" },
  { keyword: "no hot water", severity: "high", category: "heating_failure" },
  { keyword: "furnace not working", severity: "high", category: "heating_failure" },
  { keyword: "heater broken", severity: "high", category: "heating_failure" },
  { keyword: "heat is out", severity: "high", category: "heating_failure" },
] as const;

export interface EmergencyCheckResult {
  readonly isEmergency: boolean;
  readonly matchedKeyword: string | null;
  readonly severity: EmergencySeverity | null;
  readonly category: string | null;
  readonly shouldBypassLLM: boolean;
}

export interface EscalationConfig {
  readonly emergencyPhone: string;
  readonly contractorId: string;
}

export interface EscalationResult {
  readonly escalated: boolean;
  readonly targetPhone: string;
  readonly severity: EmergencySeverity;
  readonly reason: string;
  readonly transferMessage: string;
}

/**
 * Deterministic emergency keyword check. Must be called BEFORE classifyHvacIntent.
 * Returns isEmergency=true and shouldBypassLLM=true on any match.
 */
export function checkEmergencyKeywords(transcript: string): EmergencyCheckResult {
  const normalized = transcript.toLowerCase().trim();

  for (const entry of EMERGENCY_KEYWORDS) {
    if (normalized.includes(entry.keyword)) {
      return {
        isEmergency: true,
        matchedKeyword: entry.keyword,
        severity: entry.severity,
        category: entry.category,
        shouldBypassLLM: true,
      };
    }
  }

  return {
    isEmergency: false,
    matchedKeyword: null,
    severity: null,
    category: null,
    shouldBypassLLM: false,
  };
}

/**
 * Build an escalation result that transfers the caller to the contractor's emergency line.
 * Called only when checkEmergencyKeywords returns isEmergency=true.
 */
export function escalateToEmergency(
  checkResult: EmergencyCheckResult,
  config: EscalationConfig
): EscalationResult {
  const severity: EmergencySeverity = checkResult.severity ?? "critical";
  const reason = checkResult.matchedKeyword
    ? `Emergency keyword detected: "${checkResult.matchedKeyword}" (${checkResult.category})`
    : "Emergency escalation triggered without specific keyword";

  const transferMessage =
    "This sounds like an emergency situation. I'm immediately transferring you to our " +
    "emergency line. Please stay on the line. If this is a life-threatening emergency, " +
    "also call 911 right away.";

  return {
    escalated: true,
    targetPhone: config.emergencyPhone,
    severity,
    reason,
    transferMessage,
  };
}

/**
 * Persist emergency escalation event for audit and liability review.
 * Logs asynchronously — callers should catch errors independently to avoid blocking transfer.
 */
export async function logEmergencyEscalation(
  db: { query: <T>(sql: string, ...params: unknown[]) => Promise<T[]> },
  callId: string,
  contractorId: string,
  result: EscalationResult,
  transcript: string
): Promise<void> {
  const id = crypto.randomUUID();
  await db.query<void>(
    `INSERT INTO receptionist_emergency_logs
       (id, call_id, contractor_id, severity, reason, target_phone, transcript_excerpt, escalated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    id,
    callId,
    contractorId,
    result.severity,
    result.reason,
    result.targetPhone,
    transcript.slice(0, 500)
  );
}
