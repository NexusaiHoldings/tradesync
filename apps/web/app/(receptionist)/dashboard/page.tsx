import { type JSX, type ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { handleSession } from "@nexus/identity-and-access";
import { buildDb } from "@/lib/db";
import { buildEventBus } from "@/lib/events";
import {
  getDashboardStats,
  getCallLogs,
  type CallSummary,
  type DashboardStats,
} from "@/lib/receptionist/dashboard-queries";

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

export default async function DashboardPage(): Promise<JSX.Element> {
  const contractorId = await getContractorId();
  if (!contractorId) redirect("/api/auth/login");

  const [stats, calls] = await Promise.all([
    getDashboardStats(contractorId),
    getCallLogs(contractorId, 50, 0),
  ]);

  return (
    <main style={{ fontFamily: "system-ui,-apple-system,sans-serif", maxWidth: 960, margin: "0 auto", padding: "2rem 1rem" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: "0.25rem" }}>Call Log &amp; Booked Jobs</h1>
      <p style={{ color: "#6b7280", fontSize: 14, marginBottom: "2rem" }}>
        Read-only view of all inbound calls, intent classifications, and booking outcomes.
      </p>
      <StatsRow stats={stats} />
      <CallTable calls={calls} />
    </main>
  );
}

function StatsRow({ stats }: { stats: DashboardStats }): JSX.Element {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "1rem", marginBottom: "2rem" }}>
      <StatCard label="Total Calls" value={stats.total_calls} />
      <StatCard label="Booked Jobs" value={stats.booked_calls} accent="#16a34a" />
      <StatCard label="Missed Calls" value={stats.missed_calls} accent="#dc2626" />
      <StatCard label="Jobs Recovered" value={stats.jobs_recovered} accent="#2563eb" />
    </div>
  );
}

function StatCard({ label, value, accent = "#111827" }: { label: string; value: number; accent?: string }): JSX.Element {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "1.25rem", background: "#fafafa" }}>
      <div style={{ fontSize: 32, fontWeight: 700, color: accent, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 13, color: "#6b7280", marginTop: 6 }}>{label}</div>
    </div>
  );
}

function CallTable({ calls }: { calls: CallSummary[] }): JSX.Element {
  if (calls.length === 0) {
    return (
      <section>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: "1rem" }}>Recent Calls</h2>
        <p style={{ color: "#9ca3af", fontSize: 14 }}>No calls recorded yet.</p>
      </section>
    );
  }
  return (
    <section>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: "1rem" }}>
        Recent Calls <span style={{ fontWeight: 400, color: "#9ca3af", fontSize: 14 }}>({calls.length})</span>
      </h2>
      <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
              <Th>Date &amp; Time</Th>
              <Th>Caller</Th>
              <Th>Intent</Th>
              <Th>Outcome</Th>
              <Th>Duration</Th>
              <Th>Detail</Th>
            </tr>
          </thead>
          <tbody>
            {calls.map((call) => (
              <tr key={call.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <Td>{formatDateTime(call.called_at)}</Td>
                <Td><span style={{ fontFamily: "monospace" }}>{call.caller_phone}</span></Td>
                <Td><IntentBadge intent={call.intent} confidence={call.intent_confidence} /></Td>
                <Td><OutcomeBadge outcome={call.outcome} status={call.status} recovered={call.status === "missed" && call.booking_id !== null} /></Td>
                <Td>{call.duration_seconds != null ? formatDuration(call.duration_seconds) : "—"}</Td>
                <Td>
                  <Link href={`/calls/${call.id}`} style={{ color: "#2563eb", textDecoration: "none", fontWeight: 500 }}>
                    View →
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Th({ children }: { children: ReactNode }): JSX.Element {
  return <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600, color: "#374151", fontSize: 13 }}>{children}</th>;
}

function Td({ children }: { children: ReactNode }): JSX.Element {
  return <td style={{ padding: "0.75rem 1rem", color: "#374151" }}>{children}</td>;
}

function IntentBadge({ intent, confidence }: { intent: string | null; confidence: number | null }): JSX.Element {
  if (!intent) return <span style={{ color: "#d1d5db" }}>—</span>;
  const pct = confidence != null ? ` ${Math.round(confidence * 100)}%` : "";
  return (
    <span style={{ background: "#eff6ff", color: "#1d4ed8", borderRadius: 4, padding: "2px 8px", fontSize: 12, fontWeight: 500 }}>
      {intent}{pct && <span style={{ opacity: 0.7 }}>{pct}</span>}
    </span>
  );
}

function OutcomeBadge({ outcome, status, recovered }: { outcome: string | null; status: string; recovered: boolean }): JSX.Element {
  const label = outcome ?? status;
  const palette: Record<string, { bg: string; fg: string }> = {
    booked:             { bg: "#dcfce7", fg: "#15803d" },
    missed:             { bg: "#fee2e2", fg: "#b91c1c" },
    declined:           { bg: "#fef9c3", fg: "#854d0e" },
    callback_requested: { bg: "#eff6ff", fg: "#1d4ed8" },
    completed:          { bg: "#f0fdf4", fg: "#15803d" },
  };
  const { bg, fg } = palette[label] ?? { bg: "#f3f4f6", fg: "#374151" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span style={{ background: bg, color: fg, borderRadius: 4, padding: "2px 8px", fontSize: 12, fontWeight: 500 }}>{label}</span>
      {recovered && <span style={{ background: "#dbeafe", color: "#1d4ed8", borderRadius: 4, padding: "2px 6px", fontSize: 11, fontWeight: 600 }}>recovered</span>}
    </span>
  );
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}
