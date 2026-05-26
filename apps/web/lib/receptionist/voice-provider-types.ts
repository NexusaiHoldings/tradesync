/**
 * Shared type definitions for multi-provider voice orchestration.
 *
 * Supports Vapi (primary), Retell (fallback), Bland (tertiary).
 * Normalized event shape lets downstream handlers stay provider-agnostic.
 */

// ─── Provider identity ───────────────────────────────────────────────────────

export type VoiceProvider = "vapi" | "retell" | "bland";

export type VoiceEventType =
  | "call.started"
  | "call.ended"
  | "transcript"
  | "function_call";

// ─── Health & routing ────────────────────────────────────────────────────────

export interface ProviderHealth {
  provider: VoiceProvider;
  healthy: boolean;
  lastPingMs: number;
  consecutiveFailures: number;
  lastCheckedAt: Date;
}

export interface VoiceRouterConfig {
  readonly primaryProvider: VoiceProvider;
  readonly fallbackProvider: VoiceProvider;
  readonly tertiaryProvider: VoiceProvider;
  /** Number of consecutive failures before a provider is considered down. */
  readonly failoverThreshold: number;
}

// ─── Normalized event ────────────────────────────────────────────────────────

export interface NormalizedCallEvent {
  readonly provider: VoiceProvider;
  readonly eventType: VoiceEventType;
  readonly callId: string;
  readonly timestamp: string;
  readonly callerPhone?: string;
  readonly agentId?: string;
  readonly transcript?: string;
  readonly functionName?: string;
  readonly functionArgs?: Record<string, unknown>;
  /** Full raw payload for audit / debugging. */
  readonly raw: Record<string, unknown>;
}

// ─── Vapi payload shapes ─────────────────────────────────────────────────────

export interface VapiCallShape {
  readonly id: string;
  readonly orgId?: string;
  readonly createdAt?: string;
  readonly assistantId?: string;
  readonly endedReason?: string;
  readonly transcript?: string;
  readonly recordingUrl?: string;
  readonly cost?: number;
  readonly durationMs?: number;
  readonly customer?: { readonly number?: string };
  readonly phoneNumber?: {
    readonly number?: string;
    readonly twilioAccountSid?: string;
  };
}

export interface VapiToolCallItem {
  readonly id?: string;
  readonly type?: string;
  readonly function?: {
    readonly name?: string;
    readonly arguments?: string;
  };
}

export interface VapiWebhookMessage {
  readonly message: {
    readonly type: string;
    readonly call?: VapiCallShape;
    readonly artifact?: { readonly transcript?: string };
    readonly transcript?: string;
    readonly transcriptType?: string;
    readonly role?: string;
    readonly functionCall?: {
      readonly name?: string;
      readonly parameters?: Record<string, unknown>;
    };
    readonly toolCallId?: string;
    readonly toolCallList?: VapiToolCallItem[];
  };
}

// ─── Retell payload shapes ────────────────────────────────────────────────────

export interface RetellTranscriptItem {
  readonly role?: string;
  readonly content?: string;
}

export interface RetellWebhookPayload {
  readonly event: string;
  readonly call_id: string;
  readonly call?: {
    readonly call_id: string;
    readonly call_type?: string;
    readonly from_number?: string;
    readonly to_number?: string;
    readonly agent_id?: string;
    readonly call_status?: string;
    readonly start_timestamp?: number;
    readonly end_timestamp?: number;
    readonly transcript?: string;
    readonly recording_url?: string;
    readonly disconnection_reason?: string;
    readonly latency?: { readonly e2e?: number };
  };
  readonly transcript?: RetellTranscriptItem[];
  readonly name?: string;
  readonly args?: Record<string, unknown>;
  readonly call_analysis?: {
    readonly call_summary?: string;
    readonly user_sentiment?: string;
    readonly call_successful?: boolean;
    readonly in_voicemail?: boolean;
    readonly custom_analysis_data?: Record<string, unknown>;
  };
}

// ─── Bland payload shapes ─────────────────────────────────────────────────────

export interface BlandTranscriptItem {
  readonly id?: number;
  readonly created_at?: string;
  readonly text?: string;
  readonly user?: string;
  readonly c_id?: string;
}

export interface BlandWebhookPayload {
  readonly call_id?: string;
  readonly to?: string;
  readonly from?: string;
  readonly completed?: boolean;
  readonly created_at?: string;
  readonly started_at?: string;
  readonly end_at?: string;
  readonly call_length?: number;
  readonly status?: string;
  readonly transcript?: string;
  readonly transcripts?: BlandTranscriptItem[];
  readonly summary?: string;
  readonly record?: boolean;
  readonly recording_url?: string;
  readonly request_data?: {
    readonly name?: string;
    readonly arguments?: Record<string, unknown>;
  };
  readonly answered_by?: string;
  readonly inbound?: boolean;
  readonly transferred_to?: string;
}
