import { existsSync, statSync } from "node:fs";
import type { AgeBucket, Batch, TelemetryEvent, View } from "@exiled/telemetry";
import { createApp, insertHits } from "./app";
import { tx } from "./db";
import { parseAccessLine, type Hit } from "./nginx";

/**
 * Fills an EMPTY database with ~14 days of fake telemetry for developing the console. It drives
 * the real ingest path (Store.ingest), so every derived column is what production would write.
 * Addresses are documentation ranges (RFC 5737 / 3849) and never leave the given path.
 */

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLACES: [string, string, string, number, number][] = [
  ["DE", "Berlin", "Land Berlin", 52.5, 13.4], ["DE", "Munich", "Bavaria", 48.1, 11.6], ["DE", "Hamburg", "Hamburg", 53.6, 10.0],
  ["US", "New York", "New York", 40.7, -74.0], ["US", "Seattle", "Washington", 47.6, -122.3], ["US", "Austin", "Texas", 30.3, -97.7],
  ["GB", "London", "England", 51.5, -0.1], ["FR", "Paris", "Ile-de-France", 48.9, 2.4], ["PL", "Warsaw", "Mazovia", 52.2, 21.0],
  ["BR", "Sao Paulo", "Sao Paulo", -23.6, -46.6], ["JP", "Tokyo", "Tokyo", 35.7, 139.7], ["AU", "Sydney", "New South Wales", -33.9, 151.2],
  ["CA", "Toronto", "Ontario", 43.7, -79.4], ["SE", "Stockholm", "Stockholm", 59.3, 18.1], ["NL", "Amsterdam", "North Holland", 52.4, 4.9],
  ["KR", "Seoul", "Seoul", 37.6, 127.0], ["AT", "Vienna", "Vienna", 48.2, 16.4], ["CZ", "Prague", "Prague", 50.1, 14.4],
];
const WEIGHTS = [8, 4, 2, 7, 3, 2, 5, 3, 3, 2, 2, 1, 2, 1, 2, 1, 2, 1];

const UAS: [string, string[]][] = [
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36", ["NVIDIA GeForce RTX 4070", "NVIDIA GeForce GTX 1060", "AMD Radeon RX 6700 XT", "Intel(R) UHD Graphics 620"]],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0", ["NVIDIA GeForce RTX 3060", "Intel(R) Iris(R) Xe Graphics"]],
  ["Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0", ["AMD Radeon RX 7800 XT", "NVIDIA GeForce RTX 2070"]],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0", ["NVIDIA GeForce RTX 4070", "AMD Radeon RX 580"]],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", ["Apple M2", "Apple M1"]],
  ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", ["Apple GPU"]],
  ["Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36", ["Adreno (TM) 740"]],
  ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36", ["Mali-G715"]],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/120.0.0.0", ["Apple M3"]],
  ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36", ["Intel(R) UHD Graphics 600"]],
];
const UA_WEIGHTS = [10, 3, 2, 2, 3, 2, 1, 1, 1, 1];

const REFS = ["", "", "", "www.reddit.com", "www.google.com", "discord.com", "news.ycombinator.com", "itch.io", "www.youtube.com"];
const CLASSES = ["ironsworn", "stalker", "ember"];
const MAPS: [string, string][] = [["the_wrackline", "strand"], ["vaal_stone", "vaal"], ["mire", "swamp"], ["dune_sea", "desert"], ["old_wood", "forest"]];
const KILLERS: [string, string | undefined][] = [["Thornhide Boar", "physical"], ["Cinder Imp", "fire"], ["Hoarfrost Spitter", "cold"], ["Rotting Behemoth", "chaos"], ["Cinder Warden", "fire"], ["Sirrath", "lightning"], ["Bramble Whelp", undefined]];
const ERRORS: { src: "window" | "promise" | "worker" | "webgl" | "asset" | "react"; msg: string; stack?: string; url?: string; p: number }[] = [
  { src: "window", msg: "TypeError: Cannot read properties of undefined (reading 'hp')", stack: "TypeError: Cannot read properties of undefined (reading 'hp')\n    at resolveHit (https://exiled.example/assets/game-Ab12Cd34.js:1:48211)\n    at r (https://exiled.example/assets/vendor-Zz11Yy22.js:2:1201)", p: 0.03 },
  { src: "webgl", msg: "WebGL context lost", p: 0.02 },
  { src: "asset", msg: "Failed to load https://exiled.example/assets/monsters-9f8e7d6c.glb (status 503)", url: "https://exiled.example/assets/monsters-9f8e7d6c.glb", p: 0.01 },
  { src: "worker", msg: "RangeError: Maximum call stack size exceeded", stack: "RangeError: Maximum call stack size exceeded\n    at chaseStep (https://exiled.example/assets/sim-Qq77Ww88.js:3:9921)", p: 0.008 },
  { src: "promise", msg: "AbortError: The play() request was interrupted by a call to pause().", p: 0.02 },
  { src: "react", msg: "Error: Rendered more hooks than during the previous render.", stack: "Error: Rendered more hooks than during the previous render.\n    at Hud (https://exiled.example/assets/index-Ee44Rr55.js:9:331)", p: 0.004 },
];

const BUILDS = [
  { build: "0.3.0+1a2b3c4", ageDays: 14 },
  { build: "0.3.1+5d6e7f8", ageDays: 8 },
  { build: "0.3.2+9a0b1c2", ageDays: 2.5 },
];

const DAY = 86_400_000;
const MIN = 60_000;

export interface SeedResult { sessions: number; hits: number; errors: number }

export function seed(path: string, realNow = Date.now()): SeedResult {
  if (existsSync(path) && statSync(path).size > 0) throw new Error(`refusing to seed ${path}: it exists and is not empty`);
  let clock = realNow - 14 * DAY;
  const app = createApp({ db: path, now: () => clock, stdoutLog: false });
  const r = rng(0xec);
  const pick = <T>(xs: readonly T[], w?: number[]): T => {
    if (!w) return xs[Math.floor(r() * xs.length)]!;
    let x = r() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < xs.length; i++) if ((x -= w[i]!) < 0) return xs[i]!;
    return xs[xs.length - 1]!;
  };
  const uuid = () => {
    const h = () => Math.floor(r() * 16).toString(16);
    const s = (n: number) => Array.from({ length: n }, h).join("");
    return `${s(8)}-${s(4)}-4${s(3)}-${"89ab"[Math.floor(r() * 4)]}${s(3)}-${s(12)}`;
  };
  const buildAt = (t: number) => {
    const live = BUILDS.filter((b) => realNow - b.ageDays * DAY <= t);
    const b = live[live.length - 1] ?? BUILDS[0]!;
    return { build: b.build, builtAt: realNow - b.ageDays * DAY - 3_600_000 };
  };

  interface Visitor { ip: string; ua: string; gpu: string; place: (typeof PLACES)[number]; ref: string; chars: { classId: string; level: number; created: number }[] }
  const visitors: Visitor[] = [];
  for (let i = 0; i < 260; i++) {
    const [ua, gpus] = pick(UAS, UA_WEIGHTS);
    const ip = i % 7 === 0 ? `2001:db8:${(i % 50).toString(16)}::${i.toString(16)}` : `${pick(["203.0.113", "198.51.100", "192.0.2"])}.${1 + (i % 250)}`;
    visitors.push({ ip, ua, gpu: pick(gpus), place: pick(PLACES, WEIGHTS), ref: pick(REFS), chars: [] });
  }

  const hits: Hit[] = [];
  const hitLine = (t: number, ip: string, path: string, status: number, ua: string, ref = "-") => {
    const d = new Date(t);
    const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
    const p2 = (n: number) => String(n).padStart(2, "0");
    const ts = `${p2(d.getUTCDate())}/${mon}/${d.getUTCFullYear()}:${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} +0000`;
    const h = parseAccessLine(`${ip} - - [${ts}] "GET ${path} HTTP/2.0" ${status} ${Math.floor(r() * 90000)} "${ref}" "${ua}"`);
    if (h) hits.push(h);
  };

  let sessions = 0, errors = 0;
  const liveTargets = 7;

  const playSession = (v: Visitor, start: number, live: boolean) => {
    const sid = uuid();
    const events: TelemetryEvent[] = [];
    const flushes: { at: number; events: TelemetryEvent[] }[] = [];
    let t = 0;
    const push = (e: TelemetryEvent) => events.push(e);
    const flush = () => { if (events.length) flushes.push({ at: t, events: events.splice(0) }); };
    const mobile = /Mobile|iPhone/.test(v.ua);
    push({ k: "start", t: 0, screen: mobile ? "390x844" : pick(["1920x1080", "2560x1440", "1366x768", "3440x1440"]), dpr: mobile ? 3 : pick([1, 1, 1.25, 2]), gpu: v.gpu, lang: v.place[0] === "DE" ? "de-DE" : "en-US", ref: v.ref, pwa: r() < 0.05, cores: pick([4, 8, 12, 16]), memGb: pick([4, 8, 8]), touch: mobile });
    hitLine(realNowClamp(start), v.ip, "/", 200, v.ua, v.ref ? `https://${v.ref}/` : "-");
    hitLine(realNowClamp(start + 300), v.ip, "/assets/index-Ee44Rr55.js", 200, v.ua, "https://exiled.example/");
    const reached: View[] = ["boot"];
    t = 1500 + Math.floor(r() * 4000);
    push({ k: "load", t, menuMs: t, gameMs: undefined } as TelemetryEvent);
    const gameMs = 4000 + Math.floor(r() * 9000);
    if (r() < 0.9) reached.push("menu");
    if (reached.length > 1 && r() < 0.8) reached.push(r() < 0.4 ? "create" : "select");
    if (reached.length > 2 && r() < 0.85) reached.push("game");
    for (const view of reached.slice(1)) {
      t += 3000 + Math.floor(r() * 20000);
      push({ k: "view", t, view });
    }
    const inGame = reached.includes("game");
    const minutes = live ? 3 + Math.floor(r() * 20) : inGame ? 2 + Math.floor(r() * (r() < 0.2 ? 90 : 30)) : Math.floor(r() * 3);
    let char = v.chars.length && r() < 0.8 ? pick(v.chars) : undefined;
    if (inGame) {
      if (!char) {
        char = { classId: pick(CLASSES), level: 1, created: start };
        v.chars.push(char);
      }
      const ageDays = Math.floor((start - char.created) / DAY);
      const bucket: AgeBucket = ageDays < 1 ? "0" : ageDays < 2 ? "1" : ageDays < 7 ? "2-6" : ageDays < 30 ? "7-29" : "30+";
      push({ k: "load", t: t + 10, gameMs });
      push({ k: "charAge", t: t + 20, classId: char.classId, level: char.level, ageDays: bucket });
    }
    const fpsBase = /RTX 40|M3|M2|7800/.test(v.gpu) ? 120 : /GTX 1060|UHD|Mali|Adreno|580/.test(v.gpu) ? 38 : 70;
    let [mapNode, biome] = pick(MAPS);
    let tier = 1 + Math.floor(r() * 5);
    let area: "hideout" | "map" = "hideout";
    for (let m = 0; m < minutes * 2; m++) {
      t += 30_000;
      if (inGame && char && r() < 0.15) {
        area = area === "hideout" ? "map" : "hideout";
        if (area === "map") {
          [mapNode, biome] = pick(MAPS);
          tier = Math.max(1, Math.min(10, Math.floor(char.level / 3) + Math.floor(r() * 3)));
          push({ k: "area", t: t - 20_000, area, biome, tier, node: mapNode });
        } else {
          if (r() < 0.6) push({ k: "mapDone", t: t - 25_000, node: mapNode, biome, tier });
          push({ k: "area", t: t - 20_000, area: "hideout" });
        }
      }
      if (inGame && char && area === "map") {
        if (r() < 0.35) push({ k: "loot", t: t - 5_000, normal: 1 + Math.floor(r() * 6), magic: Math.floor(r() * 3), rare: r() < 0.2 ? 1 : 0, unique: r() < 0.012 ? 1 : 0 });
        if (r() < 0.04) {
          const [killer, element] = pick(KILLERS);
          push({ k: "death", t: t - 8_000, level: char.level, tier, biome, killer, element, rare: r() < 0.25 });
        }
        if (r() < 0.08 && char.level < 30) {
          char.level++;
          push({ k: "level", t: t - 3_000, level: char.level });
        }
      }
      for (const e of ERRORS) if (r() < e.p / 4) { push({ k: "error", t: t - 1_000, src: e.src, msg: e.msg, stack: e.stack, url: e.url } as TelemetryEvent); errors++; }
      const fps = Math.max(8, Math.round(fpsBase * (0.7 + r() * 0.4)));
      push({
        k: "beat", t, view: inGame ? "game" : reached[reached.length - 1]!, active: 30, fps: inGame ? fps : undefined,
        fpsLow: inGame ? Math.round(fps * 0.6) : undefined, area: inGame ? area : undefined, biome: inGame && area === "map" ? biome : undefined,
        tier: inGame && area === "map" ? tier : undefined, level: char?.level, classId: inGame ? char?.classId : undefined,
      } as TelemetryEvent);
      if (m % 4 === 3) flush();
    }
    if (!live && r() < 0.65) push({ k: "end", t: t + 2000 });
    t += 2000;
    flush();
    // Drop the keys a real client would not send (undefined optionals).
    const clean = (e: TelemetryEvent) => JSON.parse(JSON.stringify(e)) as TelemetryEvent;
    const totalT = flushes[flushes.length - 1]?.at ?? 0;
    const origin = live ? realNow - totalT - Math.floor(r() * 20_000) : start;
    flushes.forEach((f, seq) => {
      clock = origin + f.at;
      const b = buildAt(origin);
      const batch: Batch = { v: 1, sid, build: b.build, builtAt: b.builtAt, seq, events: f.events.map(clean) };
      const [country, city, region, lat, lon] = v.place;
      app.store.ingest(batch, {
        ip: v.ip, ua: v.ua,
        headers: { "cf-ipcountry": country, "cf-ipcity": city, "cf-region": region, "cf-iplatitude": String(lat + (r() - 0.5) * 0.08), "cf-iplongitude": String(lon + (r() - 0.5) * 0.08) },
      });
    });
    sessions++;
  };

  function realNowClamp(t: number) {
    return Math.min(t, realNow);
  }

  // 14 days, growing traffic, evening-heavy.
  for (let day = 14; day >= 0; day--) {
    const dayStart = Math.floor((realNow - day * DAY) / DAY) * DAY;
    const n = 25 + Math.floor((14 - day) * 5 + r() * 20);
    for (let i = 0; i < n; i++) {
      const hour = pick([...Array(24).keys()], [1, 1, 1, 1, 1, 1, 2, 2, 3, 3, 3, 4, 4, 4, 5, 6, 7, 8, 9, 10, 9, 7, 4, 2]);
      const start = dayStart + hour * 3_600_000 + Math.floor(r() * 3_600_000);
      if (start > realNow - 30 * MIN) continue;
      const v = pick(visitors.slice(0, 40 + (14 - day) * 15));
      playSession(v, start, false);
      if (r() < 0.35) hitLine(start - 60_000, v.ip, "/", 200, v.ua);
    }
    // Bots and probes.
    for (let i = 0; i < 40 + Math.floor(r() * 40); i++) {
      const t = realNowClamp(dayStart + Math.floor(r() * DAY));
      const [ua, path, status] = pick<[string, string, number]>([
        ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "/", 200],
        ["Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)", "/", 200],
        ["curl/8.4.0", "/", 200],
        ["python-requests/2.31.0", "/.env", 404],
        ["Mozilla/5.0 zgrab/0.x", "/", 200],
        ["Go-http-client/1.1", "/wp-login.php", 404],
        ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36", "/cgi-bin/luci", 404],
        ["Mozilla/5.0 (compatible; CensysInspect/1.1; +https://about.censys.io/)", "/", 200],
      ]);
      hitLine(t, `198.51.100.${200 + (i % 50)}`, path, status, ua);
    }
    for (let i = 0; i < 3 + Math.floor(r() * 5); i++) hitLine(realNowClamp(dayStart + Math.floor(r() * DAY)), "203.0.113.50", "/missing-page", 404, UAS[0]![0]);
    if (r() < 0.5) hitLine(realNowClamp(dayStart + Math.floor(r() * DAY)), "203.0.113.51", "/", 502, UAS[0]![0]);
  }
  for (let i = 0; i < liveTargets; i++) playSession(pick(visitors), realNow, true);

  clock = realNow;
  const db = app.db;
  tx(db, () => {
    insertHits(db, hits.filter((h) => h.t <= realNow));
    // Live count every 5 minutes over the whole range, then the peak.
    const live = db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE started_at <= ? AND last_seen >= ?");
    const ins = db.prepare("INSERT OR REPLACE INTO metrics (kind, t, v) VALUES ('live', ?, ?)");
    let peak = { v: 0, t: 0 };
    for (let t = Math.floor((realNow - 14 * DAY) / (5 * MIN)) * 5 * MIN; t <= realNow; t += 5 * MIN) {
      const n = (live.get(t, t - 75_000) as { n: number }).n;
      ins.run(t, n);
      if (n > peak.v) peak = { v: n, t };
    }
    db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES ('peak', ?)").run(JSON.stringify(peak));
    const host = db.prepare("INSERT OR REPLACE INTO metrics (kind, t, v) VALUES (?, ?, ?)");
    for (let t = Math.floor((realNow - DAY) / (5 * MIN)) * 5 * MIN; t <= realNow; t += 5 * MIN) {
      host.run("cpu", t, Math.round((8 + r() * 25) * 10) / 10);
      host.run("mem", t, Math.round(1200 + r() * 600));
      host.run("reqs", t, Math.round(r() * 300) / 100);
    }
    const groups = db.prepare("SELECT fingerprint FROM error_groups ORDER BY count DESC").all() as { fingerprint: string }[];
    if (groups[1]) db.prepare("UPDATE error_groups SET status = 'resolved', resolved_built_at = (SELECT MAX(built_at) FROM builds) WHERE fingerprint = ?").run(groups[1].fingerprint);
    if (groups[2]) db.prepare("UPDATE error_groups SET status = 'ignored' WHERE fingerprint = ?").run(groups[2].fingerprint);
    db.prepare("INSERT INTO audit (t, user, action, detail) VALUES (?, 'seed', 'seed', 'fake data for development')").run(realNow);
  });
  app.jobs.minute();
  app.jobs.hourly();
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  app.close();
  return { sessions, hits: hits.length, errors };
}
