import type { Rarity } from "@exiled/telemetry";

const pad = (n: number) => String(n).padStart(2, "0");

/** Two units at most: `42s`, `1m 05s`, `3h 07m`, `2d 04h`. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
  return `${Math.floor(s / 86400)}d ${pad(Math.floor((s % 86400) / 3600))}h`;
}

export function formatHours(seconds: number): string {
  return (Math.max(0, seconds) / 3600).toFixed(1);
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number): string {
  let v = Math.max(0, bytes);
  let u = 0;
  while (v >= 1024 && u < UNITS.length - 1) {
    v /= 1024;
    u++;
  }
  if (u === 0) return `${Math.round(v)} B`;
  return `${v >= 100 ? Math.round(v) : Number(v.toFixed(1))} ${UNITS[u]}`;
}

/** `share` is 0..1. */
export function formatPct(share: number | null | undefined, digits = 0): string {
  if (share === null || share === undefined || !Number.isFinite(share)) return "-";
  return `${(share * 100).toFixed(digits)} %`;
}

const NUM = new Intl.NumberFormat("en-US");
export function formatNumber(n: number): string {
  return NUM.format(n);
}

/** Error groups and the like, ranked by how many sessions they touched. */
export function rarityTier(sessions: number): Rarity {
  if (sessions >= 50) return "unique";
  if (sessions >= 10) return "rare";
  if (sessions >= 2) return "magic";
  return "normal";
}

/** Local `YYYY-MM-DD HH:mm`. */
export function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDay(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatAgo(ms: number, now = Date.now()): string {
  return `${formatDuration((now - ms) / 1000)} ago`;
}

/** Regional-indicator pair for an ISO 3166 alpha-2 code; empty for anything else. */
export function flagEmoji(iso2: string | null | undefined): string {
  if (!iso2 || !/^[a-z]{2}$/i.test(iso2)) return "";
  const up = iso2.toUpperCase();
  return String.fromCodePoint(0x1f1e6 + up.charCodeAt(0) - 65, 0x1f1e6 + up.charCodeAt(1) - 65);
}

let regions: Intl.DisplayNames | null = null;
export function countryName(iso2: string | null | undefined): string {
  if (!iso2) return "Unknown";
  if (!/^[a-z]{2}$/i.test(iso2)) return iso2;
  try {
    regions ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regions.of(iso2.toUpperCase()) ?? iso2;
  } catch {
    return iso2;
  }
}
