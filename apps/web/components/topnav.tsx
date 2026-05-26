/**
 * Substrate Top Navigation — substrate-topnav-001 (2026-05-24).
 *
 * Renders the navigation strip at the top of every page. Reads its
 * link manifest from apps/web/lib/nav-config.ts so agents can extend
 * the nav by editing config, not by re-implementing the component.
 *
 * Per the Spec the substrate ships with a flat NAV_CONFIG (NavItem[]).
 * Agents extend it by adding entries to the array in nav-config.ts;
 * they do not re-shape the manifest here.
 *
 * Server component — zero client JS bundled.
 */

import Link from "next/link";
import type { JSX } from "react";

import { NAV_CONFIG, type NavItem } from "@/lib/nav-config";

export function TopNav(): JSX.Element {
  const companyName = process.env.COMPANY_NAME || "Portfolio Company";

  return (
    <nav
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 24px",
        borderBottom: "1px solid rgba(0,0,0,0.08)",
        background: "var(--substrate-bg, #fff)",
        color: "var(--substrate-fg, #111)",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    >
      <Link
        href="/"
        style={{
          fontWeight: 700,
          fontSize: 18,
          color: "inherit",
          textDecoration: "none",
        }}
      >
        {companyName}
      </Link>

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        {NAV_CONFIG.map((item) => (
          <NavItemLink key={item.href} item={item} />
        ))}
      </div>
    </nav>
  );
}

function NavItemLink({ item }: { item: NavItem }): JSX.Element {
  return (
    <Link
      href={item.href}
      style={{
        padding: "6px 12px",
        borderRadius: 6,
        color: "inherit",
        textDecoration: "none",
        fontSize: 14,
        fontWeight: 500,
      }}
    >
      {item.label}
    </Link>
  );
}
