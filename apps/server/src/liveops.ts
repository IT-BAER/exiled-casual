import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_LIVE_CONFIG, type LiveConfig } from "@exiled/telemetry";
import { HttpError } from "./http";

const MAX_TEXT = 500;
const MAX_FLAGS = 100;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const bad = (m: string): never => { throw new HttpError(400, m); };

/** The PUT body is the whole config; anything outside the contract is refused, not dropped. */
export function validateLiveConfig(body: unknown): LiveConfig {
  if (!isObj(body)) bad("config must be an object");
  const b = body as Obj;
  for (const k of Object.keys(b)) if (!["motd", "maintenance", "minBuiltAt", "flags", "telemetry"].includes(k)) bad(`unknown field ${k}`);
  if (typeof b.telemetry !== "boolean") bad("telemetry must be a boolean");
  const out: LiveConfig = { flags: {}, telemetry: b.telemetry as boolean };
  if (b.motd !== undefined && b.motd !== null) {
    const m = b.motd;
    if (!isObj(m) || typeof m.text !== "string" || !m.text.trim() || m.text.length > MAX_TEXT) bad("motd.text must be 1-500 chars");
    const mo = m as Obj;
    if (mo.level !== "info" && mo.level !== "warn") bad("motd.level must be info or warn");
    if (mo.id !== undefined && (typeof mo.id !== "string" || !/^[A-Za-z0-9_.-]{1,60}$/.test(mo.id))) bad("motd.id must be 1-60 of [A-Za-z0-9_.-]");
    const text = (mo.text as string).trim();
    const id = (mo.id as string | undefined) ?? createHash("sha1").update(text).digest("hex").slice(0, 12);
    out.motd = { id, text, level: mo.level as "info" | "warn" };
  }
  if (b.maintenance !== undefined && b.maintenance !== null) {
    const m = b.maintenance;
    if (!isObj(m) || typeof m.text !== "string" || !m.text.trim() || m.text.length > MAX_TEXT) bad("maintenance.text must be 1-500 chars");
    out.maintenance = { text: ((m as Obj).text as string).trim() };
  }
  if (b.minBuiltAt !== undefined && b.minBuiltAt !== null) {
    if (typeof b.minBuiltAt !== "number" || !Number.isInteger(b.minBuiltAt) || b.minBuiltAt < 0) bad("minBuiltAt must be a non-negative integer");
    out.minBuiltAt = b.minBuiltAt as number;
  }
  if (b.flags !== undefined) {
    if (!isObj(b.flags)) bad("flags must be an object");
    const entries = Object.entries(b.flags as Obj);
    if (entries.length > MAX_FLAGS) bad(`at most ${MAX_FLAGS} flags`);
    for (const [k, v] of entries) {
      if (!/^[A-Za-z0-9_.-]{1,60}$/.test(k)) bad(`bad flag name ${k}`);
      const ok = typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= MAX_TEXT);
      if (!ok) bad(`flag ${k} must be a boolean, finite number or short string`);
      out.flags[k] = v as boolean | number | string;
    }
  }
  return out;
}

export class LiveOps {
  private cache: LiveConfig | null = null;
  constructor(private readonly db: DatabaseSync, private readonly now: () => number) {}

  get(): LiveConfig {
    if (this.cache) return this.cache;
    const row = this.db.prepare("SELECT json FROM liveops WHERE id = 1").get() as { json: string } | undefined;
    this.cache = row ? (JSON.parse(row.json) as LiveConfig) : { ...DEFAULT_LIVE_CONFIG, flags: {} };
    return this.cache;
  }

  set(cfg: LiveConfig): void {
    this.db.prepare("INSERT INTO liveops (id, json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at")
      .run(JSON.stringify(cfg), this.now());
    this.cache = cfg;
  }
}
