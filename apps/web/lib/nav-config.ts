/**
 * Top Navigation Configuration — Tradesync (substrate canonical shape).
 *
 * Restored to the substrate contract by tradesync-substrate-realign-001
 * (2026-05-26). F1-001's original rewrite renamed NavLink -> NavItem,
 * dropped NavGroup + NavConfig, and flattened NAV_CONFIG to NavItem[],
 * which broke the substrate's topnav.tsx import. This file + topnav.tsx
 * are restored together to the substrate's {primary, groups} shape with
 * the canonical NavLink / NavGroup / NavConfig exports preserved.
 *
 * Agents extending nav-config.ts must keep these four exports and the
 * NAV_CONFIG object shape (substrate-shared-file-shape-contract-001).
 */

export type NavLink = {
  /** URL path (without route-group parens). */
  href: string;
  /** Visible label. */
  label: string;
};

export type NavGroup = {
  /** Group label (e.g. "Account", "Admin"). */
  label: string;
  /** Child links shown inline (flat) inside the group. */
  links: NavLink[];
};

export type NavConfig = {
  primary: NavLink[];
  groups: NavGroup[];
};

export const NAV_CONFIG: NavConfig = {
  primary: [
    { href: "/",          label: "Dashboard" },
    { href: "/calls",     label: "Calls" },
    { href: "/calendar",  label: "Calendar" },
    { href: "/contacts",  label: "Contacts" },
    { href: "/analytics", label: "Analytics" },
  ],
  groups: [],
};
