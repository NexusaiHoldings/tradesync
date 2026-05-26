/**
 * Top Navigation Configuration — Tradesync.
 *
 * Substrate contract: exports NavLink, NavGroup, NavConfig types
 * and a NAV_CONFIG of shape { primary: NavLink[], groups: NavGroup[] }.
 * The substrate's TopNav component reads NAV_CONFIG.primary and
 * NAV_CONFIG.groups; renaming or dropping any canonical export
 * breaks the substrate build.
 *
 * Hotfix 2026-05-25 (substrate-shared-file-shape-contract-001 follow-up):
 * F1-001's original rewrite renamed NavLink → NavItem and flattened
 * NAV_CONFIG to a flat array, which broke topnav.tsx's import.
 * This file restores the substrate shape and keeps Tradesync's five
 * primary routes.
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
    { href: "/", label: "Dashboard" },
    { href: "/calls", label: "Calls" },
    { href: "/calendar", label: "Calendar" },
    { href: "/contacts", label: "Contacts" },
    { href: "/analytics", label: "Analytics" },
  ],
  groups: [],
};
