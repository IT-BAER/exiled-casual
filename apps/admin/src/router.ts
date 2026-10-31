import { useEffect, useState } from "react";

export const PAGES = [
  "dashboard",
  "live",
  "sessions",
  "retention",
  "atlas",
  "gameplay",
  "performance",
  "behaviour",
  "errors",
  "health",
  "logs",
  "traffic",
  "builds",
  "liveops",
  "audit",
] as const;
export type PageId = (typeof PAGES)[number];

/** Pages that open one record at `#/<page>/<id>`. */
const DETAIL: ReadonlySet<PageId> = new Set(["sessions", "errors"]);

export interface Route {
  page: PageId | "notfound";
  id?: string;
  query: Record<string, string>;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, "");
  const q = raw.indexOf("?");
  const path = q < 0 ? raw : raw.slice(0, q);
  const query: Record<string, string> = {};
  if (q >= 0) new URLSearchParams(raw.slice(q + 1)).forEach((v, k) => (query[k] = v));
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return { page: "dashboard", query };
  const page = parts[0] as PageId;
  if (!(PAGES as readonly string[]).includes(page) || parts.length > 2) return { page: "notfound", query: {} };
  if (parts.length === 1) return { page, query };
  if (!DETAIL.has(page)) return { page: "notfound", query: {} };
  let id: string;
  try {
    id = decodeURIComponent(parts[1]!);
  } catch {
    return { page: "notfound", query: {} };
  }
  return { page, id, query };
}

/** Empty query values are dropped, so a cleared filter leaves no `q=` behind. */
export function hrefFor(route: { page: PageId; id?: string; query?: Record<string, string | number | undefined> }): string {
  let out = route.page === "dashboard" && route.id === undefined ? "#/" : `#/${route.page}`;
  if (route.id !== undefined) out += `/${encodeURIComponent(route.id)}`;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(route.query ?? {})) if (v !== undefined && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${out}?${s}` : out;
}

export function navigate(href: string): void {
  window.location.hash = href;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
