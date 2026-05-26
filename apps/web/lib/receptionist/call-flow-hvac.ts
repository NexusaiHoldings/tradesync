/**
 * HVAC Call Flow Orchestrator
 *
 * Strict ordering per safety architecture:
 *   1. Deterministic emergency keyword check (BEFORE any LLM call)
 *   2. Consent disclosure (non-skippable per CA SB 1001 and two-party consent)
 *   3. LLM intent classification
 *   4. Route to appropriate handler
 *
 * Emergency keyword bypass is a non-negotiable architectural element. The LLM is
 * never consulted when gas leak, electrical fire, flooding, or carbon monoxide keywords
 * are detected. This prevents any scenario where AI model degradation or prompt injection
 * could delay emergency response.
 */

import {
  checkEmergencyKeywords,
  escalateToEmergency,
  logEmergencyEscalation,
  type EscalationConfig,
  type EscalationResult,
} from "./emergency-escalation";

import {
  classifyHvacIntent,
  buildEmergencyDispatchResult,
  type IntentClassificationResult,
  type HvacIntent,
} from "./intent-classifier";

import {
  buildConsentRecord,
  logConsent,
  requiresConsentDisclosure,
  CA_SB1001_DISCLOSURE,
  type ConsentRecord,
} from "./consent-logger";

export interface CallFlowDb {
  query: <T>(sql: string, ...params: unknown[]) => Promise<T[]>;
}

export interface CallFlowConfig {
  readonly escalation: EscalationConfig;
  /** ISO 3166-2 state/province code, e.g. "CA", "TX". Used for consent determination. */
  readonly jurisdiction: string;
}

export interface CallFlowInput {
  readonly callId: string;
  readonly callerPhone: string;
  /** Full or partial transcript of caller's opening statement. */
  readonly transcript: string;
  /** Optional structured context from the voice provider (caller ID, IVR selections). */
  readonly callerContext?: string;
  readonly db: CallFlowDb;
  readonly config: CallFlowConfig;
}

export type CallFlowAction =
  | {
      readonly type: "emergency_transfer";
      readonly phone: string;
      readonly message: string;
      readonly escalation: EscalationResult;
    }
  | {
      readonly type: "consent_required";
      readonly script: string;
    }
  | {
      readonly type: "route_to_quote";
      readonly message: string;
      readonly intent: IntentClassificationResult;
    }
  | {
      readonly type: "route_to_scheduling";
      readonly message: string;
      readonly intent: IntentClassificationResult;
    }
  | {
      readonly type: "route_to_emergency_tech";
      readonly message: string;
      readonly intent: IntentClassificationResult;
    }
  | {
      readonly type: "route_to_general";
      readonly message: string;
      readonly intent: IntentClassificationResult;
    };

export interface CallFlowResult {
  readonly callId: string;
  readonly action: CallFlowAction;
  readonly consentRecord: ConsentRecord | null;
  readonly intentResult: IntentClassificationResult | null;
  readonly processingMs: number;
}

function buildRoutingMessage(intent: HvacIntent): string {
  switch (intent) {
    case "emergency_dispatch":
      return "This sounds urgent. I'm connecting you with an available technician right away.";
    case "routine_quote":
      return "I'll connect you with our estimating team to discuss pricing for your HVAC needs.";
    case "scheduling":
      return "Let me help you schedule a service appointment. I'll connect you with our scheduling team.";
    default:
      return "Thank you for calling. Let me connect you with a team member who can assist you.";
  }
}

function buildRoutingAction(intentResult: IntentClassificationResult): CallFlowAction {
  const message = buildRoutingMessage(intentResult.intent);
  switch (intentResult.intent) {
    case "emergency_dispatch":
      return { type: "route_to_emergency_tech", message, intent: intentResult };
    case "routine_quote":
      return { type: "route_to_quote", message, intent: intentResult };
    case "scheduling":
      return { type: "route_to_scheduling", message, intent: intentResult };
    default:
      return { type: "route_to_general", message, intent: intentResult };
  }
}

/**
 * Process an HVAC call from the initial transcript.
 *
 * Returns consent_required when the jurisdiction mandates disclosure and consent
 * has not yet been recorded. The caller should play the disclosure script, then
 * call processHvacCallPostConsent() with the same callId to continue classification.
 *
 * Returns emergency_transfer immediately (without consent gating) when emergency
 * keywords are detected — safety takes precedence over consent timing.
 */
export async function processHvacCall(input: CallFlowInput): Promise<CallFlowResult> {
  const start = Date.now();
  const { callId, callerPhone, transcript, callerContext, db, config } = input;

  // ─── Step 1: Deterministic emergency keyword check ─────────────────────────
  // This MUST run before any LLM call. A hardcoded string match cannot be
  // degraded by model updates, prompt injection, or rate limits.
  const emergencyCheck = checkEmergencyKeywords(transcript);
  if (emergencyCheck.isEmergency && emergencyCheck.shouldBypassLLM) {
    const escalation = escalateToEmergency(emergencyCheck, config.escalation);

    // Log asynchronously — never delay the emergency transfer waiting for DB.
    logEmergencyEscalation(db, callId, config.escalation.contractorId, escalation, transcript).catch(
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          JSON.stringify({
            level: "error",
            service: "call-flow-hvac",
            event: "emergency_log_failed",
            callId,
            error: msg,
          })
        );
      }
    );

    return {
      callId,
      action: {
        type: "emergency_transfer",
        phone: escalation.targetPhone,
        message: escalation.transferMessage,
        escalation,
      },
      consentRecord: null,
      intentResult: buildEmergencyDispatchResult(),
      processingMs: Date.now() - start,
    };
  }

  // ─── Step 2: Consent disclosure ────────────────────────────────────────────
  // Non-skippable per CA SB 1001 and two-party consent regulations.
  // Return consent_required so the voice system can play the disclosure script.
  // Classification resumes in processHvacCallPostConsent().
  if (requiresConsentDisclosure(config.jurisdiction)) {
    const consentRecord = buildConsentRecord(callId, callerPhone, false, config.jurisdiction);
    const logResult = await logConsent(db, consentRecord);
    if (!logResult.success) {
      console.error(
        JSON.stringify({
          level: "error",
          service: "call-flow-hvac",
          event: "consent_log_failed",
          callId,
          error: logResult.error,
        })
      );
    }

    return {
      callId,
      action: { type: "consent_required", script: CA_SB1001_DISCLOSURE },
      consentRecord,
      intentResult: null,
      processingMs: Date.now() - start,
    };
  }

  // ─── Step 3: LLM intent classification (no consent required) ───────────────
  const intentResult = await classifyHvacIntent(transcript, callerContext);

  console.log(
    JSON.stringify({
      level: "info",
      service: "call-flow-hvac",
      event: "intent_classified",
      callId,
      intent: intentResult.intent,
      confidence: intentResult.confidence,
      bypassedLLM: intentResult.bypassedLLM,
    })
  );

  return {
    callId,
    action: buildRoutingAction(intentResult),
    consentRecord: null,
    intentResult,
    processingMs: Date.now() - start,
  };
}

/**
 * Continue call processing after the caller has heard the consent disclosure.
 *
 * Call this function when:
 *   - processHvacCall() returned action.type === "consent_required"
 *   - The voice system has played the disclosure script
 *   - The caller has not pressed 0 (opted out)
 *
 * Records consent as given, then classifies intent and routes.
 */
export async function processHvacCallPostConsent(input: CallFlowInput): Promise<CallFlowResult> {
  const start = Date.now();
  const { callId, callerPhone, transcript, callerContext, db, config } = input;

  // Emergency check always runs first — even post-consent, a caller may mention
  // keywords after the disclosure script has played.
  const emergencyCheck = checkEmergencyKeywords(transcript);
  if (emergencyCheck.isEmergency && emergencyCheck.shouldBypassLLM) {
    const escalation = escalateToEmergency(emergencyCheck, config.escalation);

    logEmergencyEscalation(db, callId, config.escalation.contractorId, escalation, transcript).catch(
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          JSON.stringify({
            level: "error",
            service: "call-flow-hvac",
            event: "emergency_log_failed_post_consent",
            callId,
            error: msg,
          })
        );
      }
    );

    return {
      callId,
      action: {
        type: "emergency_transfer",
        phone: escalation.targetPhone,
        message: escalation.transferMessage,
        escalation,
      },
      consentRecord: null,
      intentResult: buildEmergencyDispatchResult(),
      processingMs: Date.now() - start,
    };
  }

  // Record consent as given — caller continued past the disclosure script.
  const consentRecord = buildConsentRecord(callId, callerPhone, true, config.jurisdiction);
  const logResult = await logConsent(db, consentRecord);
  if (!logResult.success) {
    console.error(
      JSON.stringify({
        level: "error",
        service: "call-flow-hvac",
        event: "consent_log_failed_post_consent",
        callId,
        error: logResult.error,
      })
    );
  }

  // LLM intent classification
  const intentResult = await classifyHvacIntent(transcript, callerContext);

  console.log(
    JSON.stringify({
      level: "info",
      service: "call-flow-hvac",
      event: "intent_classified_post_consent",
      callId,
      intent: intentResult.intent,
      confidence: intentResult.confidence,
      bypassedLLM: intentResult.bypassedLLM,
      consentId: logResult.consentId,
    })
  );

  return {
    callId,
    action: buildRoutingAction(intentResult),
    consentRecord,
    intentResult,
    processingMs: Date.now() - start,
  };
}
