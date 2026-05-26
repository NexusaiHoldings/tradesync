/**
 * POST /api/webhooks/voice/vapi — ingest Vapi voice provider webhooks.
 *
 * Events handled:
 *   call-start          → call.started
 *   call-end            → call.ended
 *   end-of-call-report  → call.ended  (includes transcript + summary)
 *   transcript          → transcript
 *   function-call       → function_call
 *   tool-calls          → function_call
 *
 * Signature verification: HMAC-SHA256 over raw request body using
 * VAPI_WEBHOOK_SECRET. Header: x-vapi-signature.
 * If VAPI_WEBHOOK_SECRET is not set, verification is skipped (dev mode).
 */

import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import {
  normalizeVapiEvent,
  recordHealthPing,
} from "@/lib/receptionist/voice-router";
import type { VapiWebhookMessage } from "@/lib/receptionist/voice-provider-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function verifyVapiSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (!secret) {
    // Dev / test environment — skip verification
    return true;
  }
  if (!signatureHeader) return false;

  const expected = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");

  try {
    const expectedBuf = Buffer.from(expected, "hex");
    const receivedBuf = Buffer.from(signatureHeader.replace(/^sha256=/, ""), "hex");
    if (expectedBuf.length !== receivedBuf.length) return false;
    return timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const startMs = Date.now();

  // Read raw body for signature verification before parsing JSON
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: "failed to read request body" }, { status: 400 });
  }

  const signature = request.headers.get("x-vapi-signature");
  if (!verifyVapiSignature(rawBody, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: VapiWebhookMessage;
  try {
    payload = JSON.parse(rawBody) as VapiWebhookMessage;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!payload.message?.type) {
    return NextResponse.json({ error: "missing message.type" }, { status: 400 });
  }

  const normalized = normalizeVapiEvent(payload);

  const latencyMs = Date.now() - startMs;
  recordHealthPing("vapi", latencyMs);

  if (!normalized) {
    // Unknown event type — acknowledge without processing
    console.log(
      JSON.stringify({
        level: "info",
        provider: "vapi",
        event: payload.message.type,
        msg: "unhandled event type — acknowledged",
      }),
    );
    return NextResponse.json({ received: true }, { status: 200 });
  }

  console.log(
    JSON.stringify({
      level: "info",
      provider: "vapi",
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
      provider: "vapi",
      eventType: normalized.eventType,
      callId: normalized.callId,
    },
    { status: 200 },
  );
}
