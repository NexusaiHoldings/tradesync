/**
 * POST /api/webhooks/voice/booking-confirm
 *
 * Voice provider webhook for booking confirmation events.
 * Called by Vapi / Retell / Bland when a caller confirms an appointment
 * time during a voice call. Triggers the booking engine which checks
 * Google Calendar availability, creates the event, and sends SMS.
 *
 * Expected JSON body:
 * {
 *   call_id:       string  — voice provider call identifier
 *   contractor_id: string  — whose calendar to book
 *   caller_phone:  string  — E.164 number for SMS confirmation
 *   caller_name?:  string  — caller name (optional)
 *   start_time:    string  — ISO 8601 appointment start (UTC)
 *   end_time:      string  — ISO 8601 appointment end (UTC)
 *   summary?:      string  — event title (defaults to "Appointment")
 *   description?:  string  — event description
 *   calendar_id?:  string  — Google Calendar ID (defaults to "primary")
 * }
 */

import { NextResponse } from "next/server";
import { bookAppointment, type BookingRequest } from "@/lib/receptionist/booking-engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface BookingConfirmBody {
  call_id?: string;
  contractor_id?: string;
  caller_phone?: string;
  caller_name?: string;
  start_time?: string;
  end_time?: string;
  summary?: string;
  description?: string;
  calendar_id?: string;
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: BookingConfirmBody;
  try {
    body = (await request.json()) as BookingConfirmBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { call_id, contractor_id, caller_phone, start_time, end_time } = body;
  if (!call_id || !contractor_id || !caller_phone || !start_time || !end_time) {
    return NextResponse.json(
      { error: "call_id, contractor_id, caller_phone, start_time, end_time are required" },
      { status: 400 },
    );
  }

  let startTime: Date;
  let endTime: Date;
  try {
    startTime = new Date(start_time);
    endTime = new Date(end_time);
    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      throw new Error("unparseable date string");
    }
    if (endTime <= startTime) {
      throw new Error("end_time must be after start_time");
    }
  } catch (parseErr) {
    return NextResponse.json(
      {
        error: `invalid start_time or end_time: ${
          parseErr instanceof Error ? parseErr.message : String(parseErr)
        }`,
      },
      { status: 400 },
    );
  }

  const bookingRequest: BookingRequest = {
    callId: call_id,
    contractorId: contractor_id,
    callerPhone: caller_phone,
    callerName: body.caller_name,
    startTime,
    endTime,
    summary: body.summary ?? "Appointment",
    description: body.description,
    calendarId: body.calendar_id,
  };

  try {
    const result = await bookAppointment(bookingRequest);
    const httpStatus =
      result.success ? 200
      : result.error === "contractor_unavailable" ? 409
      : 500;
    return NextResponse.json(result, { status: httpStatus });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[webhooks/voice/booking-confirm] unhandled error:", msg);
    return NextResponse.json({ error: "internal server error" }, { status: 500 });
  }
}
