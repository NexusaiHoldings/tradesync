/**
 * Voice provider router — selects the active provider based on health state.
 *
 * Priority: Vapi (primary) → Retell (fallback) → Bland (tertiary).
 * Failover triggers after one consecutive missed health ping (threshold = 1).
 *
 * Health state is module-level (in-memory). On Vercel serverless each cold
 * start resets state, so providers always begin healthy. Unhealthy marks
 * propagate within the same warm instance lifetime.
 */

import type {
  VoiceProvider,
  ProviderHealth,
  VoiceRouterConfig,
  NormalizedCallEvent,
  VapiWebhookMessage,
  RetellWebhookPayload,
  RetellTranscriptItem,
  BlandWebhookPayload,
} from "./voice-provider-types";

// ─── Default configuration ────────────────────────────────────────────────────

export const DEFAULT_ROUTER_CONFIG: VoiceRouterConfig = {
  primaryProvider: "vapi",
  fallbackProvider: "retell",
  tertiaryProvider: "bland",
  failoverThreshold: 1,
};

// ─── In-memory health state ───────────────────────────────────────────────────

function freshHealth(provider: VoiceProvider): ProviderHealth {
  return {
    provider,
    healthy: true,
    lastPingMs: 0,
    consecutiveFailures: 0,
    lastCheckedAt: new Date(),
  };
}

const healthState = new Map<VoiceProvider, ProviderHealth>([
  ["vapi", freshHealth("vapi")],
  ["retell", freshHealth("retell")],
  ["bland", freshHealth("bland")],
]);

// ─── Router public API ────────────────────────────────────────────────────────

/**
 * Return the highest-priority healthy provider.
 * Falls back through primary → fallback → tertiary in order.
 * If all are unhealthy, returns the primary as last resort.
 */
export function getActiveProvider(
  config: VoiceRouterConfig = DEFAULT_ROUTER_CONFIG,
): VoiceProvider {
  const priority: VoiceProvider[] = [
    config.primaryProvider,
    config.fallbackProvider,
    config.tertiaryProvider,
  ];

  for (const provider of priority) {
    const health = healthState.get(provider);
    if (health && health.consecutiveFailures < config.failoverThreshold) {
      return provider;
    }
  }

  return config.primaryProvider;
}

/**
 * Record a successful health ping for a provider.
 * Resets consecutive failure count and marks the provider healthy.
 */
export function recordHealthPing(
  provider: VoiceProvider,
  latencyMs: number,
): void {
  const current = healthState.get(provider);
  if (!current) return;

  healthState.set(provider, {
    ...current,
    healthy: true,
    lastPingMs: latencyMs,
    consecutiveFailures: 0,
    lastCheckedAt: new Date(),
  });
}

/**
 * Mark a provider as having failed one health check.
 * Once consecutiveFailures reaches the threshold, it is excluded from routing.
 */
export function markProviderUnhealthy(provider: VoiceProvider): void {
  const current = healthState.get(provider);
  if (!current) return;

  const consecutiveFailures = current.consecutiveFailures + 1;
  healthState.set(provider, {
    ...current,
    healthy: consecutiveFailures < DEFAULT_ROUTER_CONFIG.failoverThreshold,
    consecutiveFailures,
    lastCheckedAt: new Date(),
  });
}

/** Return a snapshot of all provider health states. */
export function getProviderHealth(): Record<VoiceProvider, ProviderHealth> {
  return Object.fromEntries(healthState) as Record<VoiceProvider, ProviderHealth>;
}

/** Reset all health state (useful for testing). */
export function resetHealthState(): void {
  healthState.set("vapi", freshHealth("vapi"));
  healthState.set("retell", freshHealth("retell"));
  healthState.set("bland", freshHealth("bland"));
}

// ─── Vapi event normalizer ────────────────────────────────────────────────────

/**
 * Normalize a Vapi webhook payload to the common NormalizedCallEvent shape.
 * Returns null for event types that don't map to a known VoiceEventType.
 */
export function normalizeVapiEvent(
  payload: VapiWebhookMessage,
): NormalizedCallEvent | null {
  const msg = payload.message;
  const raw = payload as unknown as Record<string, unknown>;

  switch (msg.type) {
    case "call-start": {
      return {
        provider: "vapi",
        eventType: "call.started",
        callId: msg.call?.id ?? "",
        timestamp: msg.call?.createdAt ?? new Date().toISOString(),
        callerPhone:
          msg.call?.customer?.number ?? msg.call?.phoneNumber?.number,
        agentId: msg.call?.assistantId,
        raw,
      };
    }

    case "call-end":
    case "end-of-call-report": {
      return {
        provider: "vapi",
        eventType: "call.ended",
        callId: msg.call?.id ?? "",
        timestamp: new Date().toISOString(),
        transcript: msg.call?.transcript ?? msg.artifact?.transcript,
        raw,
      };
    }

    case "transcript": {
      return {
        provider: "vapi",
        eventType: "transcript",
        callId: msg.call?.id ?? "",
        timestamp: new Date().toISOString(),
        transcript: msg.transcript,
        raw,
      };
    }

    case "function-call":
    case "tool-calls": {
      let functionArgs: Record<string, unknown> | undefined;
      const rawArgs = msg.toolCallList?.[0]?.function?.arguments;
      if (rawArgs) {
        try {
          functionArgs = JSON.parse(rawArgs) as Record<string, unknown>;
        } catch {
          functionArgs = { _raw: rawArgs };
        }
      } else {
        functionArgs = msg.functionCall?.parameters;
      }

      return {
        provider: "vapi",
        eventType: "function_call",
        callId: msg.call?.id ?? "",
        timestamp: new Date().toISOString(),
        functionName:
          msg.functionCall?.name ?? msg.toolCallList?.[0]?.function?.name,
        functionArgs,
        raw,
      };
    }

    default:
      return null;
  }
}

// ─── Retell event normalizer ──────────────────────────────────────────────────

/**
 * Normalize a Retell webhook payload to the common NormalizedCallEvent shape.
 * Returns null for event types that don't map to a known VoiceEventType.
 */
export function normalizeRetellEvent(
  payload: RetellWebhookPayload,
): NormalizedCallEvent | null {
  const raw = payload as unknown as Record<string, unknown>;
  const callId = payload.call_id;

  switch (payload.event) {
    case "call_started": {
      return {
        provider: "retell",
        eventType: "call.started",
        callId,
        timestamp: payload.call?.start_timestamp
          ? new Date(payload.call.start_timestamp).toISOString()
          : new Date().toISOString(),
        callerPhone: payload.call?.from_number,
        agentId: payload.call?.agent_id,
        raw,
      };
    }

    case "call_ended":
    case "call_analyzed": {
      return {
        provider: "retell",
        eventType: "call.ended",
        callId,
        timestamp: payload.call?.end_timestamp
          ? new Date(payload.call.end_timestamp).toISOString()
          : new Date().toISOString(),
        transcript: payload.call?.transcript,
        raw,
      };
    }

    case "agent_start_talking":
    case "agent_stop_talking":
    case "update_only": {
      const transcriptText = Array.isArray(payload.transcript)
        ? (payload.transcript as RetellTranscriptItem[])
            .map((t) => `${t.role ?? "unknown"}: ${t.content ?? ""}`)
            .join("\n")
        : undefined;

      return {
        provider: "retell",
        eventType: "transcript",
        callId,
        timestamp: new Date().toISOString(),
        transcript: transcriptText,
        raw,
      };
    }

    case "custom_llm_tool_call": {
      return {
        provider: "retell",
        eventType: "function_call",
        callId,
        timestamp: new Date().toISOString(),
        functionName: payload.name,
        functionArgs: payload.args,
        raw,
      };
    }

    default:
      return null;
  }
}

// ─── Bland event normalizer ───────────────────────────────────────────────────

/**
 * Normalize a Bland webhook payload to the common NormalizedCallEvent shape.
 * Bland does not send discrete event-type fields; state is inferred from
 * payload shape (completed flag, end_at presence, request_data presence).
 * Returns null when the payload cannot be classified.
 */
export function normalizeBlandEvent(
  payload: BlandWebhookPayload,
): NormalizedCallEvent | null {
  const raw = payload as unknown as Record<string, unknown>;
  const callId = payload.call_id ?? "";

  if (payload.request_data?.name) {
    return {
      provider: "bland",
      eventType: "function_call",
      callId,
      timestamp: new Date().toISOString(),
      functionName: payload.request_data.name,
      functionArgs: payload.request_data.arguments,
      raw,
    };
  }

  if (
    payload.completed === true ||
    payload.status === "completed" ||
    payload.end_at
  ) {
    const transcriptText =
      payload.transcript ??
      payload.transcripts
        ?.map((t) => `${t.user ?? "unknown"}: ${t.text ?? ""}`)
        .join("\n");

    return {
      provider: "bland",
      eventType: "call.ended",
      callId,
      timestamp: payload.end_at ?? new Date().toISOString(),
      transcript: transcriptText,
      raw,
    };
  }

  if (payload.status === "started" || payload.started_at) {
    return {
      provider: "bland",
      eventType: "call.started",
      callId,
      timestamp: payload.started_at ?? payload.created_at ?? new Date().toISOString(),
      callerPhone: payload.from,
      raw,
    };
  }

  if (payload.transcripts && payload.transcripts.length > 0) {
    const transcriptText = payload.transcripts
      .map((t) => `${t.user ?? "unknown"}: ${t.text ?? ""}`)
      .join("\n");

    return {
      provider: "bland",
      eventType: "transcript",
      callId,
      timestamp: new Date().toISOString(),
      transcript: transcriptText,
      raw,
    };
  }

  return null;
}
