/**
 * The admin console's wire contract: what `apps/server` answers under
 * `/api/*` and what `apps/admin` renders. Times are ms epoch, durations
 * are seconds unless a name says otherwise, and every list is newest first
 * unless it says otherwise.
 */
import type { AgeBucket, Area, ErrorSource, LoadPhase, Rarity, View } from "./events";

/** Live-ops state the game reads from `GET /api/config`. Absent fields mean "off". */
export interface LiveConfig {
  /** Banner in the main menu. `id` changes when the text does, so a dismissed one can come back. */
  motd?: { id: string; text: string; level: "info" | "warn" };
  /** PLAY is disabled and this text is shown. */
  maintenance?: { text: string };
  /** Clients built before this (`builtAt`, ms) are told to reload. */
  minBuiltAt?: number;
  /** Remote switches and tuning values, read once at startup. */
  flags: Record<string, boolean | number | string>;
  /** False stops every client from sending telemetry. */
  telemetry: boolean;
}

export const DEFAULT_LIVE_CONFIG: LiveConfig = { flags: {}, telemetry: true };

export interface Me { user: string; since: number }
export interface LoginRequest { user: string; password: string; totp: string }

/** A point on a time series; `t` is the bucket start. */
export interface Point { t: number; v: number }

export interface Milestone {
  id: string;
  title: string;
  /** What earns it, one line. */
  desc: string;
  /** Item rarity the plaque is drawn in: rarer goals, rarer colour. */
  rarity: Rarity;
  progress: number;
  target: number;
  /** When the target was first reached; null while locked. */
  unlockedAt: number | null;
}

export interface Overview {
  liveNow: number;
  /** Peak concurrent sessions today, and the all-time peak with its time. */
  peakToday: number;
  peakAllTime: { v: number; t: number };
  sessionsToday: number;
  visitorsToday: number;
  playSecondsToday: number;
  /** Mean session length over the last 7 days, sessions that reached the menu. */
  avgSessionSeconds7d: number;
  /** Share (0..1) of game entries in the last 7 days whose character was older than a day. */
  returningShare7d: number;
  errorsLastHour: number;
  /** Error groups first seen in the last 24 h. */
  newErrorGroups24h: number;
  /** Last 48 h, hourly. */
  sessionsSeries: Point[];
  liveSeries: Point[];
  topCountries: { country: string; sessions: number }[];
  health: HealthSummary;
  milestones: Milestone[];
}

export interface LiveSession {
  sid: string;
  startedAt: number;
  lastBeat: number;
  country: string | null;
  city: string | null;
  browser: string;
  os: string;
  mobile: boolean;
  build: string;
  view: View;
  area: Area | null;
  biome: string | null;
  tier: number | null;
  level: number | null;
  classId: string | null;
  fps: number | null;
  playSeconds: number;
}

export interface SessionRow {
  sid: string;
  /** Same-day visitor key (salted hash, rotates daily). Links sessions of one day only. */
  visitor: string;
  startedAt: number;
  lastSeen: number;
  playSeconds: number;
  country: string | null;
  city: string | null;
  browser: string;
  os: string;
  mobile: boolean;
  gpu: string;
  screen: string;
  build: string;
  referrer: string;
  /** Furthest view reached: boot < menu < ... < game. */
  furthest: View;
  classId: string | null;
  maxLevel: number | null;
  ageDays: AgeBucket | null;
  maps: number;
  deaths: number;
  errors: number;
}

export interface Page<T> { rows: T[]; total: number; page: number; pageSize: number }

export interface SessionEvent { t: number; k: string; data: Record<string, unknown> }

export interface SessionDetail {
  session: SessionRow;
  /** Truncated IP (/24 or /48); never the full address. */
  ipPrefix: string | null;
  lang: string;
  dpr: number;
  cores: number;
  memGb: number;
  touch: boolean;
  pwa: boolean;
  events: SessionEvent[];
  /** Other sessions with the same visitor key on the same day. */
  sameDay: string[];
}

export interface Retention {
  days: {
    date: string; // YYYY-MM-DD, UTC
    sessions: number;
    visitors: number;
    playSeconds: number;
    newCharacters: number;
    /** Game entries per character-age bucket that day. */
    byAge: Record<AgeBucket, number>;
  }[];
  /** Session length histogram (seconds bucket lower bounds -> count), whole range. */
  lengths: { from: number; to: number | null; count: number }[];
  /** All game entries in range by character age. */
  ageTotals: Record<AgeBucket, number>;
}

export interface GeoRow {
  country: string;
  city: string | null;
  /** Mean of the stored 1-decimal coordinates for this city; null when Cloudflare sent none. */
  lat: number | null;
  lon: number | null;
  sessions: number;
  visitors: number;
  playSeconds: number;
}

export interface Gameplay {
  classes: { classId: string; entries: number; playSeconds: number }[];
  levels: { level: number; characters: number }[];
  maps: { biome: string; tier: number; opened: number; completed: number; deaths: number }[];
  killers: { killer: string; element: string | null; rare: boolean; deaths: number }[];
  loot: Record<Rarity, number>;
  /** Sessions that reached each view (funnel order of VIEWS), plus the milestones below the game. */
  funnel: { step: string; sessions: number }[];
}

export interface PerfRow {
  key: string; // gpu or browser
  sessions: number;
  fpsP50: number | null;
  fpsP5: number | null;
}
export interface Perf {
  byGpu: PerfRow[];
  byBrowser: PerfRow[];
  menuLoadMs: { p50: number | null; p90: number | null };
  gameLoadMs: { p50: number | null; p90: number | null };
  /** Each game entry's load by phase (`loadPhase` events), so the slow part is named. */
  loadPhases: { phase: LoadPhase; n: number; p50: number | null; p90: number | null }[];
  fpsSeries: Point[];
}

/**
 * What players did that the funnel cannot show: the gaps the retention report of 30 October
 * 2026 named. Counts and enums only, like everything else here.
 */
export interface Behaviour {
  /**
   * Per event kind and its key: the device action, the Atlas node's tier, the portal's destination,
   * the respawn place, the create-failure or reload reason; "" for the rare and boss events.
   * `sessions` sent it at least once; `count` is how often it was sent.
   */
  actions: { kind: string; key: string; sessions: number; count: number }[];
  /** Containers opened, summed over beats, and the sessions that opened any. */
  caches: { opened: number; sessions: number };
  /** How sessions ended: the view and area on `end`, and whether a loading plate was up. */
  exits: { view: View; area: Area | null; loading: boolean; sessions: number }[];
  /** Boots by the oldest character the browser already held; "none" is an empty roster. A return shows here. */
  rosters: Record<AgeBucket | "none", number>;
}

export type ErrorStatus = "open" | "resolved" | "ignored";
export interface ErrorGroup {
  fingerprint: string;
  src: ErrorSource;
  message: string;
  /** First stack frame that is not a vendor chunk, if any. */
  topFrame: string | null;
  count: number;
  sessions: number;
  firstSeen: number;
  lastSeen: number;
  builds: string[];
  status: ErrorStatus;
  /** Hourly hits, last 48 h. */
  series: Point[];
}
export interface ErrorDetail {
  group: ErrorGroup;
  stack: string | null;
  hits: { t: number; sid: string; build: string; browser: string; os: string; url: string | null }[];
}

export interface HealthSummary {
  /** Overall state: fail when a check fails, warn when one is near its limit. */
  state: "ok" | "warn" | "fail";
  checks: { id: string; label: string; state: "ok" | "warn" | "fail"; detail: string }[];
}

export interface Health {
  summary: HealthSummary;
  host: {
    cpuPct: number;
    load: [number, number, number];
    cores: number;
    memUsedMb: number;
    memTotalMb: number;
    diskUsedGb: number;
    diskTotalGb: number;
    uptimeSeconds: number;
  };
  nginx: { up: boolean; active: number | null; reqPerSec: number | null; status5xxLastHour: number; status4xxLastHour: number };
  server: { uptimeSeconds: number; rssMb: number; dbMb: number; ingestPerMin: number; rejectedLastHour: number; node: string };
  /** Last 24 h, one point per 5 min. */
  series: { cpu: Point[]; mem: Point[]; reqs: Point[]; live: Point[] };
}

export type LogSource = "access" | "error" | "server";
export interface LogLine {
  t: number;
  source: LogSource;
  /** access: parsed fields; error/server: level and text. */
  ip?: string;
  method?: string;
  path?: string;
  status?: number;
  bytes?: number;
  referrer?: string;
  ua?: string;
  bot?: boolean;
  level?: string;
  text: string;
}

export interface Traffic {
  /**
   * `boots` are human fetches of /api/config: clients that ran the game's code, which a crawler reading the page
   * does not. Null for a day rolled up before boots were counted, or cut into by the hits prune.
   */
  days: { date: string; pageLoads: number; humans: number; bots: number; boots: number | null; sessions: number }[];
  referrers: { referrer: string; visits: number }[];
  paths: { path: string; hits: number }[];
  statuses: { status: number; hits: number }[];
  bots: { agent: string; hits: number }[];
  /** Human page loads of "/" in range that never booted the client (page loads minus boots, per day whose boots are known). */
  bouncedBeforeBoot: number;
}

export interface BuildRow { build: string; builtAt: number; firstSeen: number; lastSeen: number; sessions: number; errors: number }

export interface AuditRow { t: number; user: string; action: string; detail: string }

/** Every route the console calls, with what it returns. */
export interface AdminRoutes {
  "GET /api/me": Me;
  "POST /api/login": Me;
  "POST /api/logout": { ok: true };
  "GET /api/overview": Overview;
  "GET /api/live": LiveSession[];
  "GET /api/sessions": Page<SessionRow>;
  "GET /api/sessions/:sid": SessionDetail;
  "GET /api/retention": Retention;
  "GET /api/geo": GeoRow[];
  "GET /api/gameplay": Gameplay;
  "GET /api/perf": Perf;
  "GET /api/behaviour": Behaviour;
  "GET /api/errors": ErrorGroup[];
  "GET /api/errors/:fp": ErrorDetail;
  "POST /api/errors/:fp": ErrorGroup;
  "GET /api/health": Health;
  "GET /api/logs": LogLine[];
  "GET /api/traffic": Traffic;
  "GET /api/liveops": LiveConfig;
  "PUT /api/liveops": LiveConfig;
  "GET /api/builds": BuildRow[];
  "GET /api/audit": AuditRow[];
}
