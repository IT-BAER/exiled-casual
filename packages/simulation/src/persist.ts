import type { KvStore } from "@exiled/persistence";
import type { World } from "./ecs";
import type { SessionC, InventoryC, StashC, VendorC, EquipmentC, ProgressC, ShardsC, SkillsC } from "./components";
import { stockVendor } from "./vendor";
import { withPermanentWaystone } from "./inventory";
import { recomputePlayerStats } from "./derived";
import { START_LEVEL, isUnlocked, maxGemLevel, MAX_GEM_LEVEL, gemXpToNext } from "@exiled/rules";
import { SKILLS, defaultAttackFor, FREE_ATTACKS } from "@exiled/content-runtime";
import { SKILL_SLOT_COUNT, MOUSE_SLOT_BASE, MOVE_SOCKET } from "@exiled/protocol";

/**
 * Run-transaction persistence. The whole durable state (session + inventory) is
 * snapshotted as one blob and written atomically (see `@exiled/persistence`), so a
 * forced worker restart at any boundary cannot duplicate or lose progression or
 * loot — spec §8. Restore ABANDONS any in-flight map run back to the hideout
 * (like a disconnect mid-map in PoE): completed nodes and inventory survive, a
 * half-run map rolls back. That roll-back IS the anti-duplication guarantee.
 */
// 2: waystones left SessionC and became 1x1 grid items. A v1 blob restores with
// no stones at all, which is a session that can never open a map.
export const VERSION = 2;

/** Shape a stash-less save restores to; also the shape a fresh world is built with. */
export const EMPTY_STASH: StashC = { cols: 12, rows: 12, items: [] };

export interface PersistedState {
  version: number;
  session: SessionC;
  inventory: InventoryC;
  /** Optional so a save written before the stash existed still loads, with an empty stash. */
  stash?: StashC;
  equipment?: EquipmentC;
  /** Optional so a save written before levels existed still loads, as a fresh START_LEVEL character. */
  progress?: ProgressC;
  /** Optional so a save written before the disenchanter existed still loads, with no shards. */
  shards?: ShardsC;
  /** Optional so a save written before gems existed still loads: `restore` grants
   *  and seeds it fresh, the same as a brand-new character. */
  skills?: SkillsC;
  /**
   * The shelf, holes and all. Persisted rather than re-rolled on load: the roll is
   * deterministic, so a fresh roll would silently restock whatever was just bought.
   */
  vendor?: VendorC;
}

/** Read the durable state off the session singleton, or null if there is none. */
export function snapshot(world: World): PersistedState | null {
  const e = world.query("session")[0];
  if (e === undefined) return null;
  const session = world.get<SessionC>(e, "session");
  const inventory = world.get<InventoryC>(e, "inventory");
  if (!session || !inventory) return null;
  const equipment = world.get<EquipmentC>(e, "equipment") ?? { slots: {} };
  const progress = world.get<ProgressC>(e, "progress") ?? { level: START_LEVEL, xp: 0, gold: 0 };
  const stash = world.get<StashC>(e, "stash") ?? EMPTY_STASH;
  const shards = world.get<ShardsC>(e, "shards") ?? { counts: {} };
  const vendor = world.get<VendorC>(e, "vendor");
  const skills = world.get<SkillsC>(e, "skills");
  return {
    version: VERSION, session, inventory, stash, equipment, progress, shards,
    ...(vendor ? { vendor } : {}),
    ...(skills ? { skills } : {}),
  };
}

/**
 * The bar a character starts with: his class's default attack on left click's
 * neighbour, Ember Bolt on 1, and movement where PoE1 puts it.
 */
export function defaultBar(classId: string): (string | null)[] {
  const bar: (string | null)[] = new Array(SKILL_SLOT_COUNT).fill(null);
  bar[0] = "skill.ember_bolt.v1";
  bar[MOUSE_SLOT_BASE] = MOVE_SOCKET;
  bar[MOUSE_SLOT_BASE + 2] = defaultAttackFor(classId);
  return bar;
}

/** A saved bar, proven rather than trusted: exactly SKILL_SLOT_COUNT entries,
 *  each a string or null, and no id in two sockets at once. */
export function normalizeBar(raw: unknown): (string | null)[] {
  const src = Array.isArray(raw) ? raw : [];
  const out: (string | null)[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < SKILL_SLOT_COUNT; i++) {
    const v = src[i];
    const id = typeof v === "string" && v.length > 0 && !seen.has(v) ? v : null;
    if (id !== null) seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * A bar's ids trimmed to what `charLevel`/`classId` actually has unlocked, so
 * neither a hand-edited save nor a client's `setSkillBar` message can leave a
 * locked skill sitting in a socket with no gem behind it. `null` and
 * `MOVE_SOCKET` pass through untouched since neither is a skill. Shared by
 * the load path (`restore`, below) and the live intent (`systems/skills.ts`)
 * so the two provably can't drift apart.
 */
export function filterUnlockedBar(
  bar: (string | null)[],
  charLevel: number,
  classId: string,
): (string | null)[] {
  return bar.map((id) => {
    if (id === null || id === MOVE_SOCKET) return id;
    const def = SKILLS.get(id);
    return def && isUnlocked(def, charLevel, classId) ? id : null;
  });
}

/**
 * A saved gem map, proven rather than trusted: every level and xp is a clamped,
 * finite integer, and a skill id content no longer defines is dropped rather
 * than carried forever as a phantom gem. `cap` is `maxGemLevel(character
 * level)` — a level saved above it is a hand edit or a pre-nerf save, and the
 * xp beside it is clamped along with it: banked xp computed against a ceiling
 * that no longer holds must not carry past what the clamped level allows, or
 * the gem re-levels the instant it earns a single point once the character
 * level catches back up.
 */
function sanitizeGems(raw: unknown, cap: number): Record<string, { level: number; xp: number }> {
  const src = raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const out: Record<string, { level: number; xp: number }> = {};
  for (const [id, v] of Object.entries(src)) {
    if (!SKILLS.has(id)) continue;
    const gem = v as { level?: unknown; xp?: unknown };
    if (
      typeof gem?.level !== "number" || !Number.isFinite(gem.level) ||
      typeof gem?.xp !== "number" || !Number.isFinite(gem.xp)
    ) continue;
    const savedLevel = Math.max(1, Math.trunc(gem.level));
    const level = Math.min(savedLevel, cap);
    let xp = Math.max(0, Math.trunc(gem.xp));
    if (level >= MAX_GEM_LEVEL) {
      xp = 0;
    } else if (level < savedLevel) {
      xp = Math.min(xp, gemXpToNext(level) - 1);
    }
    out[id] = { level, xp };
  }
  return out;
}

/**
 * Stamps the class's own default attack into its mouse slot once, gated on
 * `SkillsC.attackReseeded`: an unflagged save may carry the `""` classId
 * fallback, and a player may legally slot another class's basic attack, so
 * nothing structural can tell those two apart. Once stamped, a no-op.
 */
export function reseedDefaultAttack(skills: SkillsC, classId: string): SkillsC {
  if (skills.attackReseeded) return skills;
  const bar = [...skills.bar];
  bar[MOUSE_SLOT_BASE + 2] = defaultAttackFor(classId);
  return { ...skills, bar, attackReseeded: true };
}

/**
 * Bring the gem list level with the character. Idempotent and additive: a skill
 * the level now opens gets a gem at 1, a skill already held is left exactly as
 * it is, and nothing is ever taken away. Called on every load and on every
 * character level, which is why unlock can be derived rather than stored.
 */
export function grantSkills(world: World): void {
  const e = world.query("session")[0];
  if (e === undefined) return;
  const level = world.get<ProgressC>(e, "progress")?.level ?? START_LEVEL;
  const classId = world.get<SessionC>(e, "session")?.classId ?? "";
  const current = world.get<SkillsC>(e, "skills");
  const gems = { ...(current?.gems ?? {}) };
  const bar = [...(current?.bar ?? defaultBar(classId))];
  for (const def of SKILLS.values()) {
    if (!isUnlocked(def, level, classId)) continue;
    if (gems[def.id] !== undefined) continue;
    gems[def.id] = { level: 1, xp: 0 };
    // A skill nobody can see was not a reward (docs/09 rule 1), so the one the
    // level just opened takes the first free numbered socket. Never the mouse
    // row, never an occupied one (a full bar is a choice the player made), and
    // never a free attack, which is unlocked for every class and earns nothing.
    if (FREE_ATTACKS.has(def.id) || bar.includes(def.id)) continue;
    const free = bar.findIndex((id, i) => id === null && i < MOUSE_SLOT_BASE);
    if (free !== -1) bar[free] = def.id;
  }
  world.set<SkillsC>(e, "skills", {
    gems,
    bar,
    // Carried forward, never reset here: this runs on every level-up, and
    // resetting it would let a legitimate cross-class basic attack the player
    // already set get stomped back to the class default on the next grant.
    ...(current?.attackReseeded ? { attackReseeded: true } : {}),
  });
}

/**
 * Apply a snapshot to a freshly built world's session singleton, coercing to a
 * safe hideout state (in-flight run abandoned). Durable fields — atlasSeed and
 * completedNodes — flow through unchanged.
 */
export function restore(world: World, state: PersistedState): void {
  const e = world.query("session")[0];
  if (e === undefined) return;
  const safe: SessionC = {
    ...state.session,
    area: "hideout",
    pendingArea: "",
    mapOpen: 0,
    activeNodeId: "",
    portalsLeft: 0,
    areaTier: 0,
    // A run abandoned mid-death must not come back with the death screen up.
    dead: 0,
  };
  world.set<SessionC>(e, "session", safe);
  // Every load, not only new characters: a save written before the permanent
  // stone existed is exactly the save most likely to be out of stones.
  world.set<InventoryC>(e, "inventory", withPermanentWaystone(state.inventory));
  world.set<StashC>(e, "stash", state.stash ?? EMPTY_STASH);
  world.set<EquipmentC>(e, "equipment", state.equipment ?? { slots: {} });
  // A save written before gold existed carries a progress with no `gold` key, so
  // the field is defaulted on its own rather than only when progress is missing.
  const progress = state.progress ?? { level: START_LEVEL, xp: 0, gold: 0 };
  world.set<ProgressC>(e, "progress", { ...progress, gold: progress.gold ?? 0 });
  // Clamp on read: a hand-edited save must not put a gem 20 skill in a level-3
  // character's hand. Then grant, so a save written before gems existed — or one
  // written before the level that opened a skill — comes back complete.
  const cap = maxGemLevel(progress.level);
  const saved = state.skills;
  if (saved) {
    // A hand-edited (or pre-Task-6) save can put a locked id in a socket the
    // same way it can put an over-level gem in the map: filtered on read, not
    // just when the live `setSkillBar` intent runs.
    const bar = filterUnlockedBar(normalizeBar(saved.bar), progress.level, safe.classId ?? "");
    world.set<SkillsC>(e, "skills", {
      gems: sanitizeGems(saved.gems, cap),
      bar,
      // Absent on every save written before this flag existed, which is
      // exactly the save `reseedDefaultAttack` still has a bug left to fix.
      ...(saved.attackReseeded ? { attackReseeded: true } : {}),
    });
  }
  grantSkills(world);
  world.set<ShardsC>(e, "shards", state.shards ?? { counts: {} });
  world.set<VendorC>(e, "vendor", state.vendor ?? stockVendor(state.session.atlasSeed, progress.level));
  // Saved gear has to reach the player, not just the equipment panel. Life and
  // mana are not persisted, so a restored session starts full.
  recomputePlayerStats(world, { refill: true });
}

/** Serialize `world`'s durable state to `kv`. No-op if there is no session. */
export async function saveTo(kv: KvStore, world: World): Promise<void> {
  const snap = snapshot(world);
  if (snap) await kv.save(JSON.stringify(snap));
}

/**
 * Restore `world` from `kv`. Returns true if a compatible save was applied.
 * A version mismatch is ignored (nothing is live yet — no migration path).
 */
export async function loadInto(kv: KvStore, world: World): Promise<boolean> {
  const raw = await kv.load();
  if (raw === null) return false;
  const state = JSON.parse(raw) as PersistedState;
  if (state.version !== VERSION) return false;
  restore(world, state);
  return true;
}
