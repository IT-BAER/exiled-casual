import type { IncomingHttpHeaders, IncomingMessage } from "node:http";

/**
 * The client address: nginx's X-Real-IP (set from CF-Connecting-IP), else the socket.
 * Trusted only because both listeners bind 127.0.0.1. Never persisted or logged.
 */
export function clientIp(req: IncomingMessage): string {
  const h = req.headers["x-real-ip"];
  const v = Array.isArray(h) ? h[0] : h;
  return (v && v.trim()) || req.socket.remoteAddress || "";
}

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Loopback, RFC 1918, IPv6 ULA and link-local. Anything else is the internet. */
export function isPrivateIp(ip: string): boolean {
  const v = ip.trim().replace(/^::ffff:/i, "");
  const m = V4.exec(v);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const g = expandV6(v.toLowerCase());
  if (!g) return false;
  const first = parseInt(g[0]!, 16);
  return g.join(":") === "0:0:0:0:0:0:0:1" || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

function expandV6(ip: string): string[] | null {
  if (!/^[0-9a-f:]+$/i.test(ip)) return null;
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => g.length === 0 || g.length > 4)) return null;
  return groups.map((g) => parseInt(g, 16).toString(16));
}

/** IPv4 -> /24, IPv6 -> /48. The only form of an address that is ever stored. */
export function ipPrefix(ip: string): string | null {
  const v = ip.replace(/^::ffff:/i, "");
  const m = V4.exec(v);
  if (m) {
    const o = m.slice(1, 4).map(Number);
    return o.every((x) => x <= 255) ? `${o.join(".")}.0/24` : null;
  }
  const g = expandV6(v.split("%")[0]!);
  return g ? `${g.slice(0, 3).join(":")}::/48` : null;
}

export interface Geo { country: string | null; city: string | null; region: string | null; lat: number | null; lon: number | null }

function header(h: IncomingHttpHeaders | Record<string, string | undefined>, k: string): string | null {
  const v = h[k];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.trim() ? s.trim().slice(0, 80) : null;
}

function coord(s: string | null, limit: number): number | null {
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) <= limit ? Math.round(n * 10) / 10 : null;
}

export function geoFromHeaders(h: IncomingHttpHeaders | Record<string, string | undefined>): Geo {
  const c = header(h, "cf-ipcountry")?.toUpperCase() ?? null;
  return {
    country: c && /^[A-Z]{2}$/.test(c) && c !== "XX" && c !== "T1" ? c : null,
    city: header(h, "cf-ipcity"),
    region: header(h, "cf-region"),
    lat: coord(header(h, "cf-iplatitude"), 90),
    lon: coord(header(h, "cf-iplongitude"), 180),
  };
}

/** Replaces every IPv4 address in free text with its /24. */
export function maskIps(text: string): string {
  return text.replace(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g, (_m, a, b, c) => `${a}.${b}.${c}.0/24`);
}
