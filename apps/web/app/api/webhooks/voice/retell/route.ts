/**
 * POST /api/webhooks/voice/retell — ingest Retell voice provider webhooks.
 *
 * Events handled:
 *   call_started           → call.started
 *   call_ended             → call.ended
 *   call_analyzed          → call.ended  (includes analysis/summary)
 *   agent_start_talking    → transcript
 *   agent_stop_talking     → transcript
 *   update_only            → transcript
 *   custom_llm_tool_call   → function_call
 *
 * Signature verification: HMAC-SHA256 over raw request body using
 * RETELL_API_KEY. Header: x-retell-signature.
 * If RETELL_API_KEY is not set, verification is skipped (dev mode).
 */

import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import {
  normalizeRetellEvent,
  recordHealthPing,
} from "@/lib/receptionist/voice-router";
import type { RetellWebhookPayload } from "@/lib/receptionist/voice-provider-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function verifyRetellSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) {
    // Dev / test environment — skip verification
    return true;
  }
  if (!signatureHeader) return false;

  const expected = createHmac("sha256", apiKey)
    .update(rawBody, "utf8")
    .digest("hex");

  try {
    const expectedBuf = Buffer.from(expected, "hex");
    const receivedBuf = Buffer.from(signatureHeader, "hex");
    if (expectedBuf.length !== receivedBuf.length) return false;
    return timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const startMs = Date.now();

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: "failed to read request body" }, { status: 400 });
  }

  const signature = request.headers.get("x-retell-signature");
  if (!verifyRetellSignature(rawBody, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: RetellWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as RetellWebhookPayload;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!payload.event) {
    return NextResponse.json({ error: "missing event field" }, { status: 400 });
  }

  const normalized = normalizeRetellEvent(payload);

  const latencyMs = Date.now() - startMs;
  recordHealthPing("retell", latencyMs);

  if (!normalized) {
    console.log(
      JSON.stringify({
        level: "info",
        provider: "retell",
        event: payload.event,
        callId: payload.call_id,
        msg: "unhandled event type — acknowledged",
      }),
    );
    return NextResponse.json({ received: true }, { status: 200 });
  }

  console.log(
    JSON.stringify({
      level: "info",
      provider: "retell",
      event: normalized.eventType,
      callId: normalized.callId,
      callerPhone: normalized.callerPhone,
      functionName: normalized.functionName,
      latencyMs,
    }),
  );

  return NextResponse.json(
    {
      received: true,
      provider: "retell",
      eventType: normalized.eventType,
      callId: normalized.callId,
    },
    { status: 200 },
  );
}
