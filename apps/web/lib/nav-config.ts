/**
 * Top Navigation Configuration — Tradesync (operator-healed shape).
 *
 * Companion to the operator's topnav.tsx self-heal at sha 1446cc20:
 * Tradesync's topnav.tsx was rewritten to `NAV_CONFIG.map(item)` over
 * a flat `NavItem[]`. This file matches that shape so the company
 * stays live.
 *
 * Substrate canonical shape (NavLink / NavGroup / NavConfig with
 * primary+groups) is preserved in the substrate template and is
 * the contract every NEW portfolio company must honor. Restoring
 * Tradesync to the substrate shape requires updating both files
 * together — tracked in substrate-shared-file-shape-contract-001.
 */

export interface NavItem {
  label: string;
  href: string;
  icon?: string;
}

export const NAV_CONFIG: NavItem[] = [
  { label: "Dashboard", href: "/" },
  { label: "Calls", href: "/calls" },
  { label: "Calendar", href: "/calendar" },
  { label: "Contacts", href: "/contacts" },
  { label: "Analytics", href: "/analytics" },
];
