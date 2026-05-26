import { type JSX, type ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { handleSession } from "@nexus/identity-and-access";
import { buildDb } from "@/lib/db";
import { buildEventBus } from "@/lib/events";
import { getCallDetail, type CallDetail, type ConsentEvent } from "@/lib/receptionist/dashboard-queries";

async function getContractorId(): Promise<string | null> {
  const cookieStore = cookies();
  const token =
    cookieStore.get("__Secure-next-auth.session-token")?.value ??
    cookieStore.get("next-auth.session-token")?.value;
  if (!token) return null;
  const result = await handleSession({
    authorizationHeader: `Bearer ${token}`,
    ctx: { db: buildDb(), events: buildEventBus() },
  });
  if (result.status !== 200) return null;
  const body = result.body as { user_id?: string };
  return body.user_id ?? null;
}

interface PageProps {
  params: { id: string };
}

export default async function CallDetailPage({ params }: PageProps): Promise<JSX.Element> {
  const contractorId = await getContractorId();
  if (!contractorId) redirect("/api/auth/login");

  const call = await getCallDetail(params.id, contractorId);
  if (!call) notFound();

  return (
    <main style={{ fontFamily: "system-ui,-apple-system,sans-serif", maxWidth: 800, margin: "0 auto", padding: "2rem 1rem" }}>
      <nav style={{ marginBottom: "1.5rem" }}>
        <Link href="/dashboard" style={{ color: "#6b7280", fontSize: 14, textDecoration: "none" }}>
          ← Back to Dashboard
        </Link>
      </nav>

      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: "0.25rem" }}>Call Detail</h1>
      <p style={{ color: "#6b7280", fontSize: 13, marginBottom: "2rem", fontFamily: "monospace" }}>{call.id}</p>

      <CallMetaSection call={call} />
      <ClassificationSection call={call} />
      <TranscriptSection transcript={call.transcript} />
      <ConsentEventSection events={call.consent_events} />
    </main>
  );
}

function CallMetaSection({ call }: { call: CallDetail }): JSX.Element {
  const rows: Array<[string, string]> = [
    ["Caller", call.caller_phone],
    ["Called At", formatDateTime(call.called_at)],
    ["Duration", call.duration_seconds != null ? formatDuration(call.duration_seconds) : "—"],
    ["Status", call.status],
    ["Outcome", call.outcome ?? "—"],
    ["Provider", call.provider ?? "—"],
  ];
  if (call.booking_id) {
    rows.push(["Booking ID", call.booking_id]);
    if (call.booking_scheduled_at) rows.push(["Scheduled At", formatDateTime(call.booking_scheduled_at)]);
    if (call.booking_job_type) rows.push(["Job Type", call.booking_job_type]);
  }
  return (
    <Section title="Call Information">
      <dl style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: "0.5rem 1rem" }}>
        {rows.map(([label, value]) => (
          <span key={label} style={{ display: "contents" }}>
            <dt style={{ color: "#6b7280", fontSize: 13, fontWeight: 500, alignSelf: "start", paddingTop: 2 }}>{label}</dt>
            <dd style={{ color: "#111827", fontSize: 14, margin: 0 }}>{value}</dd>
          </span>
        ))}
      </dl>
    </Section>
  );
}

function ClassificationSection({ call }: { call: CallDetail }): JSX.Element {
  if (!call.intent && !call.intent_reasoning) {
    return (
      <Section title="Intent Classification">
        <p style={{ color: "#9ca3af", fontSize: 14 }}>No classification data available.</p>
      </Section>
    );
  }
  const confidence = call.intent_confidence != null ? `${Math.round(call.intent_confidence * 100)}%` : "—";
  return (
    <Section title="Intent Classification">
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <MetaBadge label="Intent" value={call.intent ?? "—"} color="#1d4ed8" bg="#eff6ff" />
        <MetaBadge label="Confidence" value={confidence} color="#7c3aed" bg="#f5f3ff" />
      </div>
      {call.intent_reasoning && (
        <div>
          <p style={{ fontSize: 13, color: "#6b7280", fontWeight: 600, marginBottom: 6 }}>Reasoning</p>
          <blockquote style={{ borderLeft: "3px solid #e5e7eb", margin: 0, paddingLeft: "1rem", color: "#374151", fontSize: 14, lineHeight: 1.6 }}>
            {call.intent_reasoning}
          </blockquote>
        </div>
      )}
    </Section>
  );
}

function TranscriptSection({ transcript }: { transcript: string | null }): JSX.Element {
  return (
    <Section title="Full Transcript">
      {transcript ? (
        <pre
          style={{
            background: "#f9fafb",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            padding: "1rem",
            fontSize: 13,
            lineHeight: 1.7,
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: "#111827",
          }}
        >
          {transcript}
        </pre>
      ) : (
        <p style={{ color: "#9ca3af", fontSize: 14 }}>Transcript not available.</p>
      )}
    </Section>
  );
}

function ConsentEventSection({ events }: { events: ConsentEvent[] }): JSX.Element {
  return (
    <Section title="Consent Event Log">
      {events.length === 0 ? (
        <p style={{ color: "#9ca3af", fontSize: 14 }}>No consent events recorded.</p>
      ) : (
        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {events.map((ev) => (
            <li
              key={ev.id}
              style={{ display: "flex", gap: "1rem", alignItems: "flex-start", padding: "0.75rem", background: "#f9fafb", borderRadius: 6, border: "1px solid #e5e7eb" }}
            >
              <span style={{ background: "#dcfce7", color: "#15803d", borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", marginTop: 2 }}>
                {ev.event_type}
              </span>
              <div>
                <div style={{ fontSize: 13, color: "#374151" }}>{formatDateTime(ev.occurred_at)}</div>
                {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                  <pre style={{ margin: "0.25rem 0 0", fontSize: 11, color: "#6b7280", background: "transparent" }}>
                    {JSON.stringify(ev.metadata, null, 2)}
                  </pre>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section style={{ marginBottom: "2rem" }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, color: "#111827", marginBottom: "0.75rem", paddingBottom: "0.5rem", borderBottom: "1px solid #e5e7eb" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function MetaBadge({ label, value, color, bg }: { label: string; value: string; color: string; bg: string }): JSX.Element {
  return (
    <div style={{ background: bg, borderRadius: 6, padding: "0.5rem 0.75rem" }}>
      <div style={{ fontSize: 11, color, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}
