import { existsSync, readdirSync, readFileSync, statSync, openSync, readSync, closeSync, fstatSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { ipPrefix, maskIps } from "./ip";

export interface Hit {
  t: number;
  ipPrefix: string | null;
  method: string;
  path: string;
  status: number;
  bytes: number;
  referrer: string;
  ua: string;
  bot: boolean;
}

const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

const ACCESS = /^(\S+) \S+ \S+ \[(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})\] "((?:[^"\\]|\\.)*)" (\d{3}) (\d+|-) "((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)"/;

const BOT_UA = /bot|crawl|spider|slurp|scan|curl|wget|python|go-http|censys|zgrab|masscan|nmap|nuclei|httpclient|okhttp|java\/|libwww|perl|ruby|php\/|scrapy|axios|node-fetch|undici|headless|phantom|semrush|ahrefs|mj12|dataprovider|facebookexternalhit|preview|monitor|uptime|^-?$/i;
/**
 * Automation that sends a browser's user agent, read off the access log: crawlers and audits that
 * name themselves somewhere in it, a frozen iOS 13.2.3 Safari string, and a two-part Chrome version,
 * which no real Chrome has sent since the user-agent reduction (always four parts, "126.0.0.0").
 */
const BOT_BROWSER = /nutch|lighthouse|linkcheck|internetmeasurement|iPhone OS 13_2_3 like Mac OS X|Chrome\/\d+\.\d+(?![.\d])/i;
const PROBE = /\.env|wp-|\.php|\/cgi-bin|\/\.git|phpmyadmin|\/actuator|\/\.aws|\/vendor\/|\/boaform|\/HNAP1|\/owa\//i;

export function isBot(ua: string, path: string): boolean {
  return BOT_UA.test(ua.trim()) || BOT_BROWSER.test(ua) || PROBE.test(path);
}

/** A short name for a bot agent: the token that matched, else the first product token. */
export function botAgent(ua: string): string {
  const named = /([A-Za-z][\w.-]*(?:bot|crawler|spider|scanner))/i.exec(ua);
  if (named) return named[1]!.slice(0, 40);
  const product = /^([^\s/;(]+)/.exec(ua.trim());
  return product ? product[1]!.slice(0, 40) : "(empty)";
}

function refHost(r: string): string {
  if (!r || r === "-") return "";
  try {
    return new URL(r).host.slice(0, 100);
  } catch {
    return r.slice(0, 100);
  }
}

export function parseAccessLine(line: string): Hit | null {
  const m = ACCESS.exec(line);
  if (!m) return null;
  const month = MONTHS[m[3]!];
  if (month === undefined) return null;
  const offMin = (m[8] === "-" ? -1 : 1) * (Number(m[9]) * 60 + Number(m[10]));
  const t = Date.UTC(Number(m[4]), month, Number(m[2]), Number(m[5]), Number(m[6]), Number(m[7])) - offMin * 60_000;
  const req = m[11]!.split(" ");
  const method = req.length >= 2 ? req[0]!.slice(0, 10) : "-";
  const rawPath = req.length >= 2 ? req[1]! : m[11]!;
  const path = rawPath.split("?")[0]!.slice(0, 200);
  const ua = m[15]!.replace(/\\"/g, '"').slice(0, 300);
  return {
    t,
    ipPrefix: ipPrefix(m[1]!),
    method,
    path,
    status: Number(m[12]),
    bytes: m[13] === "-" ? 0 : Number(m[13]),
    referrer: refHost(m[14]!),
    ua,
    bot: isBot(ua, rawPath),
  };
}

const ERROR = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2}) \[(\w+)\] (.*)$/;

/** nginx error format; the time has no zone and is read as UTC (the host runs UTC). */
export function parseErrorLine(line: string): { t: number; level: string; text: string } | null {
  const m = ERROR.exec(line);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  return { t, level: m[7]!, text: maskIps(m[8]!).slice(0, 2000) };
}

export interface TailState { ino: string; offset: number }

function inoOf(path: string): string | null {
  try {
    return statSync(path, { bigint: true }).ino.toString();
  } catch {
    return null;
  }
}

/** Reads complete lines from `offset`; returns them and the byte offset after the last newline. */
function readFrom(path: string, offset: number): { lines: string[]; offset: number } {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    if (size <= offset) return { lines: [], offset: Math.min(offset, size) };
    const buf = Buffer.alloc(size - offset);
    let read = 0;
    while (read < buf.length) {
      const n = readSync(fd, buf, read, buf.length - read, offset + read);
      if (n === 0) break;
      read += n;
    }
    const lastNl = buf.lastIndexOf(10, read - 1);
    if (lastNl < 0) return { lines: [], offset };
    const text = buf.subarray(0, lastNl).toString("utf8");
    return { lines: text.split("\n").filter(Boolean), offset: offset + lastNl + 1 };
  } finally {
    closeSync(fd);
  }
}

/**
 * Incremental reader for `access.log` with logrotate in mind. First run backfills the
 * gzipped generations and `access.log.1`; a changed inode means the old file is now
 * `access.log.1`, whose rest is read before the new file from 0.
 */
export function tailAccessLog(dir: string, state: TailState | null): { lines: string[]; state: TailState | null } {
  const cur = join(dir, "access.log");
  const prev = join(dir, "access.log.1");
  if (!existsSync(dir)) return { lines: [], state };
  const lines: string[] = [];
  const ino = inoOf(cur);
  if (!state) {
    const gz = readdirSync(dir)
      .map((f) => /^access\.log\.(\d+)\.gz$/.exec(f))
      .filter((m): m is RegExpExecArray => !!m)
      .sort((a, b) => Number(b[1]) - Number(a[1]));
    for (const m of gz) {
      try {
        lines.push(...gunzipSync(readFileSync(join(dir, m[0]))).toString("utf8").split("\n").filter(Boolean));
      } catch {
        /* a corrupt archive is skipped, not fatal */
      }
    }
    if (existsSync(prev)) lines.push(...readFrom(prev, 0).lines);
    if (!ino) return { lines, state: null };
    const r = readFrom(cur, 0);
    lines.push(...r.lines);
    return { lines, state: { ino, offset: r.offset } };
  }
  if (!ino) return { lines, state };
  if (ino !== state.ino) {
    if (inoOf(prev) === state.ino) lines.push(...readFrom(prev, state.offset).lines);
    const r = readFrom(cur, 0);
    lines.push(...r.lines);
    return { lines, state: { ino, offset: r.offset } };
  }
  const size = statSync(cur).size;
  const r = readFrom(cur, size < state.offset ? 0 : state.offset);
  lines.push(...r.lines);
  return { lines, state: { ino, offset: r.offset } };
}

/** Last `max` lines of a text file, reading at most the final 1 MB. */
export function tailFile(path: string, max: number): string[] {
  if (!existsSync(path)) return [];
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, 1 << 20);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString("utf8").split("\n").filter(Boolean);
    if (size > len) lines.shift();
    return lines.slice(-max);
  } finally {
    closeSync(fd);
  }
}

