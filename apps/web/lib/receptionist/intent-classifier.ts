/**
 * HVAC Intent Classifier — GPT structured prompt chain.
 *
 * Classifies inbound HVAC calls into one of four intents:
 *   - emergency_dispatch  (no heat, burst pipe — non-gas/CO/fire handled here after keyword bypass)
 *   - routine_quote       (price estimates, service quotes)
 *   - scheduling          (booking or rescheduling appointments)
 *   - other               (general inquiries, wrong number, etc.)
 *
 * IMPORTANT: checkEmergencyKeywords() from emergency-escalation.ts MUST be called before
 * this classifier. Gas leaks, electrical fires, flooding, and carbon monoxide trigger a
 * deterministic hardcoded bypass that never reaches this function.
 *
 * Uses the AI gateway proxy (AI_GATEWAY_URL) — never calls openai SDK directly.
 * Model: gpt-5.4-mini as required by task constraints.
 */

export type HvacIntent = "emergency_dispatch" | "routine_quote" | "scheduling" | "other";

export interface IntentClassificationResult {
  readonly intent: HvacIntent;
  readonly confidence: number;
  readonly reasoning: string;
  readonly bypassedLLM: boolean;
  readonly model: string | null;
}

interface ClassifierConfig {
  readonly gatewayUrl: string;
  readonly gatewayToken: string;
  readonly model: string;
  readonly maxTokens: number;
}

interface GatewayMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

interface GatewayChoice {
  readonly message: { readonly content: string };
}

interface GatewayResponse {
  readonly choices: readonly GatewayChoice[];
}

interface ParsedClassification {
  readonly intent: string;
  readonly confidence: number;
  readonly reasoning: string;
}

/**
 * System prompt for the HVAC intent classification chain.
 * Structured to elicit a JSON response matching ParsedClassification.
 */
const HVAC_CLASSIFIER_SYSTEM_PROMPT = `You are an expert HVAC call intent classifier for a residential and commercial HVAC company.

Your task is to classify an inbound caller's intent into exactly one of these four categories:

1. "emergency_dispatch" — Urgent situations requiring immediate technician dispatch. Examples:
   - Complete heating failure during cold weather
   - Air conditioning failure during extreme heat
   - Unusual HVAC noises or smells (non-gas, non-CO — those are handled separately)
   - System failure causing property damage risk

2. "routine_quote" — Customer wants a price estimate. Examples:
   - "How much does it cost to replace my AC unit?"
   - "I need a quote for a new furnace"
   - "What would it cost to add a zone?"

3. "scheduling" — Customer wants to book or change an appointment. Examples:
   - "I need to schedule a tune-up"
   - "Can I reschedule my service appointment?"
   - "When is the earliest you can come out?"

4. "other" — Everything else. Examples:
   - General questions about services
   - Billing or invoice questions
   - Wrong number
   - Complaints or compliments

IMPORTANT: Gas leaks, electrical fires, flooding, and carbon monoxide are handled by a
separate safety system before this classifier runs. Do not classify those as emergency_dispatch.

Respond with a JSON object only, no markdown or explanation outside the JSON:
{
  "intent": "<emergency_dispatch | routine_quote | scheduling | other>",
  "confidence": <float 0.0-1.0>,
  "reasoning": "<one sentence explaining your classification>"
}

When uncertain between emergency_dispatch and scheduling, prefer emergency_dispatch.
When uncertain between any category and other, prefer the more specific category.`;

function buildClassifierConfig(): ClassifierConfig {
  const gatewayUrl = process.env.AI_GATEWAY_URL;
  const gatewayToken = process.env.AI_GATEWAY_TOKEN;

  if (!gatewayUrl) {
    throw new Error(
      "intent-classifier: AI_GATEWAY_URL env var missing — set this to the OpenAI-compatible gateway proxy URL."
    );
  }
  if (!gatewayToken) {
    throw new Error(
      "intent-classifier: AI_GATEWAY_TOKEN env var missing — set this to the gateway authentication token."
    );
  }

  return {
    gatewayUrl,
    gatewayToken,
    model: "gpt-5.4-mini",
    maxTokens: 256,
  };
}

async function callGateway(
  config: ClassifierConfig,
  messages: readonly GatewayMessage[]
): Promise<string> {
  const response = await fetch(`${config.gatewayUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.gatewayToken}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_tokens: config.maxTokens,
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `intent-classifier: gateway responded ${response.status}: ${text.slice(0, 200)}`
    );
  }

  const data = (await response.json()) as GatewayResponse;
  const content = data.choices[0]?.message?.content;
  if (!content) {
    throw new Error("intent-classifier: gateway returned empty content in choices[0]");
  }
  return content;
}

function parseClassificationResponse(raw: string): ParsedClassification {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `intent-classifier: LLM response is not valid JSON: ${raw.slice(0, 200)}`
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("intent-classifier: LLM response parsed to non-object");
  }

  const obj = parsed as Record<string, unknown>;
  const intent = typeof obj.intent === "string" ? obj.intent : "other";
  const confidence =
    typeof obj.confidence === "number" ? Math.max(0, Math.min(1, obj.confidence)) : 0.5;
  const reasoning = typeof obj.reasoning === "string" ? obj.reasoning : "no reasoning provided";

  return { intent, confidence, reasoning };
}

function normalizeIntent(raw: string): HvacIntent {
  switch (raw) {
    case "emergency_dispatch":
      return "emergency_dispatch";
    case "routine_quote":
      return "routine_quote";
    case "scheduling":
      return "scheduling";
    default:
      return "other";
  }
}

/**
 * Classify an HVAC call transcript using the GPT structured prompt chain.
 *
 * Must NOT be called when checkEmergencyKeywords() returns shouldBypassLLM=true.
 * On LLM failure, fails open to intent="other" with confidence=0 to avoid dropping calls.
 */
export async function classifyHvacIntent(
  transcript: string,
  callerContext?: string
): Promise<IntentClassificationResult> {
  const config = buildClassifierConfig();

  const userContent = callerContext
    ? `Caller transcript: "${transcript}"\n\nAdditional caller context: ${callerContext}`
    : `Caller transcript: "${transcript}"`;

  const messages: readonly GatewayMessage[] = [
    { role: "system", content: HVAC_CLASSIFIER_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];

  let raw: string;
  try {
    raw = await callGateway(config, messages);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return {
      intent: "other",
      confidence: 0,
      reasoning: `LLM classification unavailable: ${message}`,
      bypassedLLM: false,
      model: config.model,
    };
  }

  let parsed: ParsedClassification;
  try {
    parsed = parseClassificationResponse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : "parse error";
    return {
      intent: "other",
      confidence: 0,
      reasoning: `LLM response parse failed: ${message}`,
      bypassedLLM: false,
      model: config.model,
    };
  }

  return {
    intent: normalizeIntent(parsed.intent),
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
    bypassedLLM: false,
    model: config.model,
  };
}

/**
 * Build a deterministic emergency_dispatch result used when the keyword bypass fires.
 * Signals that LLM evaluation was skipped — confidence is always 1.0.
 */
export function buildEmergencyDispatchResult(): IntentClassificationResult {
  return {
    intent: "emergency_dispatch",
    confidence: 1.0,
    reasoning: "Deterministic emergency keyword match — LLM evaluation bypassed per safety architecture",
    bypassedLLM: true,
    model: null,
  };
}
