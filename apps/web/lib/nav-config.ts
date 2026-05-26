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
