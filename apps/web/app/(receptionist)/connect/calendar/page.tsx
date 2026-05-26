/**
 * /connect/calendar — Google Calendar OAuth connection page.
 *
 * Displays the contractor's current Google Calendar connection status
 * and allows them to connect (or reconnect) via Google OAuth2.
 *
 * OAuth callback is handled here: when Google redirects back with ?code=,
 * the page exchanges the code for tokens and stores them, then redirects
 * to show the success state.
 *
 * Server component — no 'use client' needed; all state is URL-driven.
 */

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import {
  buildOAuthUrl,
  exchangeCodeForTokens,
  storeCalendarTokens,
  getCalendarTokenRow,
  deleteCalendarTokens,
  type CalendarTokenRow,
} from "@/lib/receptionist/calendar-google";

// ── session resolution ────────────────────────────────────────────────────

/**
 * Reads the NextAuth session cookie and resolves the user_id from the
 * sessions table (standard NextAuth database adapter schema).
 * Returns null when unauthenticated or the DB is unavailable.
 */
async function resolveContractorId(): Promise<string | null> {
  const cookieStore = cookies();
  const sessionToken =
    cookieStore.get("next-auth.session-token")?.value ??
    cookieStore.get("__Secure-next-auth.session-token")?.value;
  if (!sessionToken) return null;

  try {
    const { Pool: PgPool } = eval("require")("pg") as {
      Pool: new (c: Record<string, unknown>) => {
        query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }>;
      };
    };
    const pool = new PgPool({
      connectionString: process.env.DATABASE_URL,
      max: 2,
      idleTimeoutMillis: 10_000,
    });
    const res = await pool.query(
      "SELECT user_id FROM sessions WHERE session_token = $1 AND expires > NOW() LIMIT 1",
      [sessionToken],
    );
    const rows = res.rows as Array<{ user_id: string }>;
    return rows[0]?.user_id ?? null;
  } catch {
    return null;
  }
}

// ── page ──────────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export default async function CalendarConnectPage({ searchParams }: PageProps) {
  const sp = searchParams;
  const code = typeof sp.code === "string" ? sp.code : undefined;
  const state = typeof sp.state === "string" ? sp.state : undefined;
  const oauthErrorParam = typeof sp.error === "string" ? sp.error : undefined;

  // ── handle disconnect ────────────────────────────────────────────────────
  if (sp.disconnect === "true" && state) {
    await deleteCalendarTokens(state);
    redirect("/connect/calendar?disconnected=true");
  }

  // ── handle OAuth callback ─────────────────────────────────────────────
  if (code && state) {
    try {
      const tokens = await exchangeCodeForTokens(code);
      const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null;
      await storeCalendarTokens(
        state,
        tokens.access_token,
        tokens.refresh_token,
        expiresAt,
        tokens.scope,
      );
      redirect("/connect/calendar?connected=true");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      redirect(`/connect/calendar?error=${encodeURIComponent(msg.slice(0, 200))}`);
    }
  }

  // ── resolve current contractor ────────────────────────────────────────
  const contractorId = await resolveContractorId();
  const tokenRow: CalendarTokenRow | null = contractorId
    ? await getCalendarTokenRow(contractorId)
    : null;
  const isConnected = tokenRow !== null;

  const showConnected = sp.connected === "true";
  const showDisconnected = sp.disconnected === "true";
  const errorMessage =
    typeof sp.error === "string" ? decodeURIComponent(sp.error) : null;

  const oauthUrl = contractorId ? buildOAuthUrl(contractorId) : null;
  const disconnectUrl = contractorId
    ? `/connect/calendar?disconnect=true&state=${encodeURIComponent(contractorId)}`
    : null;

  return (
    <div
      style={{
        maxWidth: 560,
        margin: "64px auto",
        padding: "0 24px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: "#111827",
      }}
    >
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
        Google Calendar
      </h1>
      <p style={{ color: "#6b7280", marginBottom: 32, lineHeight: 1.6 }}>
        Connect your Google Calendar so the receptionist can check your availability
        in real time and automatically book appointments on your behalf.
      </p>

      {oauthErrorParam && (
        <Banner variant="error">
          <strong>OAuth error:</strong> {oauthErrorParam}
        </Banner>
      )}
      {errorMessage && (
        <Banner variant="error">
          <strong>Error:</strong> {errorMessage}
        </Banner>
      )}
      {showConnected && (
        <Banner variant="success">Google Calendar connected successfully.</Banner>
      )}
      {showDisconnected && (
        <Banner variant="warning">Google Calendar has been disconnected.</Banner>
      )}
      {!contractorId && (
        <Banner variant="warning">
          Sign in to manage your Google Calendar connection.
        </Banner>
      )}

      <div
        style={{
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 24,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: isConnected && tokenRow ? 12 : 0,
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: isConnected ? "#22c55e" : "#d1d5db",
              flexShrink: 0,
              display: "inline-block",
            }}
          />
          <span style={{ fontWeight: 600, fontSize: 16 }}>
            {isConnected ? "Connected" : "Not connected"}
          </span>
        </div>

        {isConnected && tokenRow && (
          <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 20px 22px" }}>
            Last updated{" "}
            {new Date(tokenRow.updated_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        )}

        {oauthUrl && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
            <a
              href={oauthUrl}
              style={{
                display: "inline-block",
                padding: "10px 20px",
                background: "#4285f4",
                color: "#fff",
                borderRadius: 8,
                textDecoration: "none",
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              {isConnected ? "Reconnect Google Calendar" : "Connect Google Calendar"}
            </a>
            {isConnected && disconnectUrl && (
              <a
                href={disconnectUrl}
                style={{
                  display: "inline-block",
                  padding: "10px 20px",
                  background: "#fff",
                  color: "#dc2626",
                  borderRadius: 8,
                  textDecoration: "none",
                  fontWeight: 600,
                  fontSize: 14,
                  border: "1px solid #fca5a5",
                }}
              >
                Disconnect
              </a>
            )}
          </div>
        )}
      </div>

      <div
        style={{
          background: "#f0f9ff",
          border: "1px solid #bae6fd",
          borderRadius: 8,
          padding: "12px 16px",
          fontSize: 13,
          color: "#0369a1",
          lineHeight: 1.5,
        }}
      >
        <strong>Permissions requested:</strong> View free/busy information and create
        calendar events on your behalf. We never read existing event details or
        contacts.
      </div>
    </div>
  );
}

// ── shared Banner component ───────────────────────────────────────────────

function Banner({
  variant,
  children,
}: {
  variant: "error" | "success" | "warning";
  children: React.ReactNode;
}) {
  const styles: Record<string, { bg: string; border: string; text: string }> = {
    error: { bg: "#fef2f2", border: "#fca5a5", text: "#991b1b" },
    success: { bg: "#f0fdf4", border: "#86efac", text: "#166534" },
    warning: { bg: "#fffbeb", border: "#fcd34d", text: "#92400e" },
  };
  const s = styles[variant];
  return (
    <div
      style={{
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: 8,
        padding: "12px 16px",
        marginBottom: 20,
        color: s.text,
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}
