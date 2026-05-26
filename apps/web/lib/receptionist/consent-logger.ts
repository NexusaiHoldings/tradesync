/**
 * Consent Logger — CA SB 1001 and two-party consent compliance for HVAC AI receptionist.
 *
 * CA SB 1001 (Bot Disclosure Law) requires AI systems to disclose their nature before
 * any substantive interaction. Two-party consent states require explicit disclosure that
 * the call is being recorded. Both disclosures are non-skippable per regulatory_risk.
 */

/** States that require two-party (all-party) consent for call recording. */
export const TWO_PARTY_CONSENT_STATES = [
  "CA",
  "FL",
  "IL",
  "MD",
  "MA",
  "MT",
  "NV",
  "NH",
  "OR",
  "PA",
  "WA",
] as const;

export type TwoPartyConsentState = (typeof TWO_PARTY_CONSENT_STATES)[number];

/**
 * Mandatory disclosure script per CA SB 1001 and two-party consent requirements.
 * This script MUST be delivered before any substantive call content.
 */
export const CA_SB1001_DISCLOSURE =
  "Hello, you have reached an AI-powered virtual receptionist. " +
  "I am an automated system, not a human agent. " +
  "This call may be recorded for quality assurance and training purposes. " +
  "By continuing this call, you consent to speaking with an AI assistant and to call recording. " +
  "If you would prefer to speak with a human agent, please press zero at any time.";

export interface ConsentRecord {
  readonly callId: string;
  readonly callerPhone: string;
  readonly consentGiven: boolean;
  readonly consentTimestamp: string;
  readonly disclosureScript: string;
  readonly jurisdiction: string;
}

export interface ConsentLogResult {
  readonly success: boolean;
  readonly consentId: string | null;
  readonly error?: string;
}

/**
 * Returns true if the given jurisdiction requires consent disclosure before recording.
 * Defaults conservative: unknown jurisdictions are treated as requiring disclosure.
 */
export function requiresConsentDisclosure(jurisdiction: string): boolean {
  const upper = jurisdiction.toUpperCase() as TwoPartyConsentState;
  return (TWO_PARTY_CONSENT_STATES as readonly string[]).includes(upper);
}

/**
 * Construct a ConsentRecord for a call. Sets consentTimestamp to now.
 */
export function buildConsentRecord(
  callId: string,
  callerPhone: string,
  consentGiven: boolean,
  jurisdiction: string
): ConsentRecord {
  return {
    callId,
    callerPhone,
    consentGiven,
    consentTimestamp: new Date().toISOString(),
    disclosureScript: CA_SB1001_DISCLOSURE,
    jurisdiction: jurisdiction.toUpperCase(),
  };
}

/**
 * Persist a consent record to the database.
 * Returns success=false with error string on DB failure — callers decide whether to abort.
 */
export async function logConsent(
  db: { query: <T>(sql: string, ...params: unknown[]) => Promise<T[]> },
  record: ConsentRecord
): Promise<ConsentLogResult> {
  const consentId = crypto.randomUUID();
  try {
    await db.query<void>(
      `INSERT INTO receptionist_consent_logs
         (id, call_id, caller_phone, consent_given, consent_timestamp,
          disclosure_script, jurisdiction, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      consentId,
      record.callId,
      record.callerPhone,
      record.consentGiven,
      record.consentTimestamp,
      record.disclosureScript,
      record.jurisdiction
    );
    return { success: true, consentId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return { success: false, consentId: null, error: message };
  }
}

/**
 * Retrieve the most recent consent record for a call, if any.
 * Returns null when no record exists.
 */
export async function getConsentRecord(
  db: { query: <T>(sql: string, ...params: unknown[]) => Promise<T[]> },
  callId: string
): Promise<ConsentRecord | null> {
  interface ConsentRow {
    call_id: string;
    caller_phone: string;
    consent_given: boolean;
    consent_timestamp: string;
    disclosure_script: string;
    jurisdiction: string;
  }

  const rows = await db.query<ConsentRow>(
    `SELECT call_id, caller_phone, consent_given, consent_timestamp,
            disclosure_script, jurisdiction
       FROM receptionist_consent_logs
      WHERE call_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    callId
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return {
    callId: row.call_id,
    callerPhone: row.caller_phone,
    consentGiven: row.consent_given,
    consentTimestamp: row.consent_timestamp,
    disclosureScript: row.disclosure_script,
    jurisdiction: row.jurisdiction,
  };
}
