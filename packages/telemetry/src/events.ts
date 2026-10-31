/**
 * What the game client reports about itself, and the one parser the server
 * trusts it through.
 *
 * Cookieless by design: nothing here identifies a person across days. `sid` is
 * a random id held in memory for one page load and never written to storage;
 * the server derives a same-day visitor key from IP and user agent with a salt
 * it discards every 24 h. "Coming back" is read from `charAge`, the age of the
 * character the save already holds, never from an id.
 *
 * Pure leaf: no DOM, no Node, no other @exiled package, so the client, the
 * server and the admin UI all compile against the same shape.
 */

export const TELEMETRY_VERSION = 1;
/** The server refuses a body above this before it parses a byte of it. */
export const MAX_BATCH_BYTES = 64 * 1024;
export const MAX_EVENTS = 200;
const MAX_STR = 200;
const MAX_MSG = 500;
const MAX_STACK = 4000;

export const VIEWS = ["boot", "menu", "mode", "select", "create", "info", "game"] as const;
export type View = (typeof VIEWS)[number];

export const AREAS = ["hideout", "map"] as const;
export type Area = (typeof AREAS)[number];

/** Character age in whole days since `createdAt`, bucketed so it is a cohort, not a fingerprint. */
export const AGE_BUCKETS = ["0", "1", "2-6", "7-29", "30+"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

export const ERROR_SOURCES = ["window", "promise", "worker", "webgl", "asset", "react"] as const;
export type ErrorSource = (typeof ERROR_SOURCES)[number];

export const RARITIES = ["normal", "magic", "rare", "unique"] as const;
export type Rarity = (typeof RARITIES)[number];

/** What the player did at the map device: walked up, picked a node, seated a stone, opened the map, walked off. */
export const DEVICE_ACTIONS = ["open", "select", "socket", "activate", "close"] as const;
export type DeviceAction = (typeof DEVICE_ACTIONS)[number];

export const RESPAWNS = ["checkpoint", "hideout"] as const;

/** Why a create screen was left with a name the rule refused. The name itself never leaves the device. */
export const CREATE_FAILS = ["short", "long", "charset", "taken"] as const;

/** Why the page reloaded itself: a stale deploy's missing chunk, or a lost WebGL context. */
export const RELOADS = ["chunk", "webgl"] as const;

/** One game entry's load, by phase (`apps/web/src/load-phases.ts` says what each one spans). */
export const LOAD_PHASES = ["chunk", "models", "worker", "shaders", "frame"] as const;
export type LoadPhase = (typeof LOAD_PHASES)[number];

export function ageBucket(days: number): AgeBucket {
  if (days < 1) return "0";
  if (days < 2) return "1";
  if (days < 7) return "2-6";
  if (days < 30) return "7-29";
  return "30+";
}

/** Every event carries `t`: milliseconds since the session started. */
export type TelemetryEvent =
  | { k: "start"; t: number; screen: string; dpr: number; gpu: string; lang: string; ref: string; pwa: boolean; cores: number; memGb: number; touch: boolean }
  /**
   * Every 30 s while the tab is visible. `active` is the visible seconds since the last beat: play time is their sum.
   * `caches` is how many containers were opened since the last beat.
   */
  | { k: "beat"; t: number; view: View; active: number; fps?: number; fpsLow?: number; area?: Area; biome?: string; tier?: number; level?: number; classId?: string; caches?: number }
  | { k: "view"; t: number; view: View }
  /** Time from navigation to the menu's first paint, and to the first game frame. */
  | { k: "load"; t: number; menuMs?: number; gameMs?: number }
  /** Once per game entry: which character, how old. */
  | { k: "charAge"; t: number; classId: string; level: number; ageDays: AgeBucket }
  | { k: "area"; t: number; area: Area; biome?: string; tier?: number; node?: string }
  | { k: "mapDone"; t: number; node: string; biome?: string; tier: number }
  | { k: "death"; t: number; level: number; tier: number; biome?: string; killer?: string; element?: string; rare?: boolean }
  | { k: "level"; t: number; level: number }
  /** Ground drops that appeared since the last loot event, by rarity. */
  | { k: "loot"; t: number; normal: number; magic: number; rare: number; unique: number }
  | { k: "error"; t: number; src: ErrorSource; msg: string; stack?: string; url?: string }
  /** The page went away: where it was, and whether a loading plate was up. Older clients send it bare. */
  | { k: "end"; t: number; view?: View; area?: Area; loading?: boolean }
  | { k: "device"; t: number; action: DeviceAction }
  /** A map opened from the Atlas: which node, its tier, and the tier of the stone spent on it. */
  | { k: "atlas"; t: number; node: string; tier: number; stone: number }
  /** Walked through a portal into an area. */
  | { k: "portal"; t: number; to: Area }
  /** Once per monster: a rare came within about a screen of the player, or died. Once per area: the boss woke, or took a hit. */
  | { k: "rareSeen" | "rareKill" | "bossSeen" | "bossFight"; t: number; tier: number; biome?: string }
  | { k: "respawn"; t: number; where: (typeof RESPAWNS)[number] }
  | { k: "createFail"; t: number; reason: (typeof CREATE_FAILS)[number] }
  /** Sent by beacon right before the page reloads itself. */
  | { k: "reload"; t: number; reason: (typeof RELOADS)[number] }
  | { k: "loadPhase"; t: number; phase: LoadPhase; ms: number }
  /**
   * Once at boot, from the local save: how many characters, the oldest one's age as a cohort bucket, the highest
   * level. A return visit shows here even when the visitor never enters the game; no id links the two days.
   */
  | { k: "roster"; t: number; characters: number; oldestAge?: AgeBucket; maxLevel?: number };

export type EventKind = TelemetryEvent["k"];

export interface Batch {
  v: 1;
  sid: string;
  /** Human release plus commit, e.g. "0.3.1+abc1234". */
  build: string;
  /** Build timestamp (ms); the minimum-build gate compares this. */
  builtAt: number;
  /** Batch counter within the session, so the server can ignore a replayed beacon. */
  seq: number;
  events: TelemetryEvent[];
  /** Set by the parser: events refused or past the cap. */
  dropped?: number;
}

export type ParseResult = { ok: true; batch: Batch } | { ok: false; error: string };

const SID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
const int = (v: unknown, min: number, max: number): number | undefined => {
  const n = num(v, min, max);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
};
const str = (v: unknown, max = MAX_STR): string | undefined => (typeof v === "string" ? v.slice(0, max) : undefined);
const oneOf = <T extends string>(v: unknown, set: readonly T[]): T | undefined =>
  typeof v === "string" && (set as readonly string[]).includes(v) ? (v as T) : undefined;
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

/** Copies only the optional fields that parse; a bad optional is dropped, not fatal. */
function opt(out: Obj, key: string, v: unknown): void {
  if (v !== undefined) out[key] = v;
}

const DAY = 86_400_000;

function parseEvent(e: unknown): TelemetryEvent | null {
  if (!isObj(e)) return null;
  const t = int(e.t, 0, 7 * DAY);
  if (t === undefined) return null;
  switch (e.k) {
    case "start": {
      const screen = str(e.screen, 20), gpu = str(e.gpu), lang = str(e.lang, 20), ref = str(e.ref, 100);
      const dpr = num(e.dpr, 0, 10), cores = int(e.cores, 0, 1024), memGb = num(e.memGb, 0, 4096);
      const pwa = bool(e.pwa), touch = bool(e.touch);
      if ([screen, gpu, lang, ref, dpr, cores, memGb, pwa, touch].some((x) => x === undefined)) return null;
      return { k: "start", t, screen: screen!, dpr: dpr!, gpu: gpu!, lang: lang!, ref: ref!, pwa: pwa!, cores: cores!, memGb: memGb!, touch: touch! };
    }
    case "beat": {
      const view = oneOf(e.view, VIEWS), active = int(e.active, 0, 3600);
      if (!view || active === undefined) return null;
      const out: Obj = { k: "beat", t, view, active };
      opt(out, "fps", num(e.fps, 0, 1000));
      opt(out, "fpsLow", num(e.fpsLow, 0, 1000));
      opt(out, "area", oneOf(e.area, AREAS));
      opt(out, "biome", str(e.biome, 40));
      opt(out, "tier", int(e.tier, 0, 100));
      opt(out, "level", int(e.level, 0, 1000));
      opt(out, "classId", str(e.classId, 40));
      opt(out, "caches", int(e.caches, 0, 1000));
      return out as TelemetryEvent;
    }
    case "view": {
      const view = oneOf(e.view, VIEWS);
      return view ? { k: "view", t, view } : null;
    }
    case "load": {
      const out: Obj = { k: "load", t };
      opt(out, "menuMs", int(e.menuMs, 0, 600_000));
      opt(out, "gameMs", int(e.gameMs, 0, 600_000));
      return out as TelemetryEvent;
    }
    case "charAge": {
      const classId = str(e.classId, 40), level = int(e.level, 0, 1000), ageDays = oneOf(e.ageDays, AGE_BUCKETS);
      return classId && level !== undefined && ageDays ? { k: "charAge", t, classId, level, ageDays } : null;
    }
    case "area": {
      const area = oneOf(e.area, AREAS);
      if (!area) return null;
      const out: Obj = { k: "area", t, area };
      opt(out, "biome", str(e.biome, 40));
      opt(out, "tier", int(e.tier, 0, 100));
      opt(out, "node", str(e.node, 60));
      return out as TelemetryEvent;
    }
    case "mapDone": {
      const node = str(e.node, 60), tier = int(e.tier, 0, 100);
      if (!node || tier === undefined) return null;
      const out: Obj = { k: "mapDone", t, node, tier };
      opt(out, "biome", str(e.biome, 40));
      return out as TelemetryEvent;
    }
    case "death": {
      const level = int(e.level, 0, 1000), tier = int(e.tier, 0, 100);
      if (level === undefined || tier === undefined) return null;
      const out: Obj = { k: "death", t, level, tier };
      opt(out, "biome", str(e.biome, 40));
      opt(out, "killer", str(e.killer, 60));
      opt(out, "element", str(e.element, 20));
      opt(out, "rare", bool(e.rare));
      return out as TelemetryEvent;
    }
    case "level": {
      const level = int(e.level, 0, 1000);
      return level !== undefined ? { k: "level", t, level } : null;
    }
    case "loot": {
      const c = RARITIES.map((r) => int(e[r], 0, 10_000));
      if (c.some((x) => x === undefined)) return null;
      return { k: "loot", t, normal: c[0]!, magic: c[1]!, rare: c[2]!, unique: c[3]! };
    }
    case "error": {
      const src = oneOf(e.src, ERROR_SOURCES), msg = str(e.msg, MAX_MSG);
      if (!src || msg === undefined) return null;
      const out: Obj = { k: "error", t, src, msg };
      opt(out, "stack", str(e.stack, MAX_STACK));
      opt(out, "url", str(e.url, MAX_STR));
      return out as TelemetryEvent;
    }
    case "end": {
      const out: Obj = { k: "end", t };
      opt(out, "view", oneOf(e.view, VIEWS));
      opt(out, "area", oneOf(e.area, AREAS));
      opt(out, "loading", bool(e.loading));
      return out as TelemetryEvent;
    }
    case "device": {
      const action = oneOf(e.action, DEVICE_ACTIONS);
      return action ? { k: "device", t, action } : null;
    }
    case "atlas": {
      const node = str(e.node, 60), tier = int(e.tier, 0, 100), stone = int(e.stone, 0, 100);
      return node && tier !== undefined && stone !== undefined ? { k: "atlas", t, node, tier, stone } : null;
    }
    case "portal": {
      const to = oneOf(e.to, AREAS);
      return to ? { k: "portal", t, to } : null;
    }
    case "rareSeen":
    case "rareKill":
    case "bossSeen":
    case "bossFight": {
      const tier = int(e.tier, 0, 100);
      if (tier === undefined) return null;
      const out: Obj = { k: e.k, t, tier };
      opt(out, "biome", str(e.biome, 40));
      return out as TelemetryEvent;
    }
    case "respawn": {
      const where = oneOf(e.where, RESPAWNS);
      return where ? { k: "respawn", t, where } : null;
    }
    case "createFail": {
      const reason = oneOf(e.reason, CREATE_FAILS);
      return reason ? { k: "createFail", t, reason } : null;
    }
    case "reload": {
      const reason = oneOf(e.reason, RELOADS);
      return reason ? { k: "reload", t, reason } : null;
    }
    case "loadPhase": {
      const phase = oneOf(e.phase, LOAD_PHASES), ms = int(e.ms, 0, 600_000);
      return phase && ms !== undefined ? { k: "loadPhase", t, phase, ms } : null;
    }
    case "roster": {
      const characters = int(e.characters, 0, 1000);
      if (characters === undefined) return null;
      const out: Obj = { k: "roster", t, characters };
      opt(out, "oldestAge", oneOf(e.oldestAge, AGE_BUCKETS));
      opt(out, "maxLevel", int(e.maxLevel, 0, 1000));
      return out as TelemetryEvent;
    }
    default:
      return null;
  }
}

/** The trust boundary: anything a browser sent becomes a `Batch` here or is refused. */
export function parseBatch(body: unknown): ParseResult {
  if (!isObj(body)) return { ok: false, error: "body is not an object" };
  if (body.v !== TELEMETRY_VERSION) return { ok: false, error: "unsupported version" };
  if (typeof body.sid !== "string" || !SID.test(body.sid)) return { ok: false, error: "bad sid" };
  const build = str(body.build, 60);
  const builtAt = int(body.builtAt, 0, 8_640_000_000_000_000);
  const seq = int(body.seq, 0, 1_000_000);
  if (!build || builtAt === undefined || seq === undefined) return { ok: false, error: "bad header" };
  if (!Array.isArray(body.events)) return { ok: false, error: "events is not an array" };
  const events: TelemetryEvent[] = [];
  let dropped = 0;
  for (const raw of body.events) {
    if (events.length >= MAX_EVENTS) { dropped++; continue; }
    const e = parseEvent(raw);
    if (e) events.push(e);
    else dropped++;
  }
  return { ok: true, batch: { v: 1, sid: body.sid, build, builtAt, seq, events, dropped } };
}
