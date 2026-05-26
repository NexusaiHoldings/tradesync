/**
 * POST /api/webhooks/voice/bland — ingest Bland voice provider webhooks.
 *
 * Bland sends a single payload shape for all call lifecycle events.
 * Event type is inferred from payload fields:
 *   request_data.name present     → function_call
 *   completed/end_at present      → call.ended
 *   status === "started"          → call.started
 *   transcripts array present     → transcript
 *
 * Signature verification: timing-safe comparison of x-bland-secret header
 * against BLAND_WEBHOOK_SECRET env var.
 * If BLAND_WEBHOOK_SECRET is not set, verification is skipped (dev mode).
 */

import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import {
  normalizeBlandEvent,
  recordHealthPing,
} from "@/lib/receptionist/voice-router";
import type { BlandWebhookPayload } from "@/lib/receptionist/voice-provider-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function verifyBlandSecret(secretHeader: string | null): boolean {
  const secret = process.env.BLAND_WEBHOOK_SECRET;
  if (!secret) {
    // Dev / test environment — skip verification
    return true;
  }
  if (!secretHeader) return false;

  try {
    const expectedBuf = Buffer.from(secret, "utf8");
    const receivedBuf = Buffer.from(secretHeader, "utf8");
    if (expectedBuf.length !== receivedBuf.length) return false;
    return timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const startMs = Date.now();

  const secretHeader = request.headers.get("x-bland-secret");
  if (!verifyBlandSecret(secretHeader)) {
    return NextResponse.json({ error: "invalid secret" }, { status: 401 });
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: "failed to read request body" }, { status: 400 });
  }

  let payload: BlandWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as BlandWebhookPayload;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const normalized = normalizeBlandEvent(payload);

  const latencyMs = Date.now() - startMs;
  recordHealthPing("bland", latencyMs);

  if (!normalized) {
    console.log(
      JSON.stringify({
        level: "info",
        provider: "bland",
        callId: payload.call_id,
        status: payload.status,
        msg: "unhandled payload shape — acknowledged",
      }),
    );
    return NextResponse.json({ received: true }, { status: 200 });
  }

  console.log(
    JSON.stringify({
      level: "info",
      provider: "bland",
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
      provider: "bland",
      eventType: normalized.eventType,
      callId: normalized.callId,
    },
    { status: 200 },
  );
}
