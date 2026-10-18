import type { IconName } from "./icons";
import type { PageId } from "./router";

export interface NavItem {
  page: PageId;
  label: string;
  icon: IconName;
}
export interface NavGroup {
  id: string;
  name: string;
  icon: IconName;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "overview",
    name: "Overview",
    icon: "overview",
    items: [
      { page: "dashboard", label: "Dashboard", icon: "dashboard" },
      { page: "live", label: "Live", icon: "live" },
    ],
  },
  {
    id: "exiles",
    name: "Exiles",
    icon: "exiles",
    items: [
      { page: "sessions", label: "Sessions", icon: "sessions" },
      { page: "retention", label: "Retention", icon: "retention" },
      { page: "atlas", label: "Atlas", icon: "atlas" },
    ],
  },
  {
    id: "game",
    name: "Game",
    icon: "game",
    items: [
      { page: "gameplay", label: "Gameplay", icon: "gameplay" },
      { page: "performance", label: "Performance", icon: "performance" },
    ],
  },
  {
    id: "operations",
    name: "Operations",
    icon: "operations",
    items: [
      { page: "errors", label: "Errors", icon: "errors" },
      { page: "health", label: "Health", icon: "health" },
      { page: "logs", label: "Logs", icon: "logs" },
      { page: "traffic", label: "Traffic", icon: "traffic" },
      { page: "builds", label: "Builds", icon: "builds" },
    ],
  },
];

/** Top-level items under the groups. */
export const NAV_PLAIN: NavItem[] = [
  { page: "liveops", label: "Live ops", icon: "liveops" },
  { page: "audit", label: "Audit", icon: "audit" },
];

export function navItem(page: PageId): NavItem {
  for (const g of NAV_GROUPS) for (const it of g.items) if (it.page === page) return it;
  return NAV_PLAIN.find((it) => it.page === page)!;
}

/** Breadcrumb group: the nav group, or "Console" for the plain items. */
export function groupOf(page: PageId): NavGroup | null {
  return NAV_GROUPS.find((g) => g.items.some((it) => it.page === page)) ?? null;
}
