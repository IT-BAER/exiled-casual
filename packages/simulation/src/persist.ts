import type { KvStore } from "@exiled/persistence";
import type { World } from "./ecs";
import type { SessionC, InventoryC, StashC, VendorC, EquipmentC, ProgressC, ShardsC, SkillsC } from "./components";
import { stockVendor } from "./vendor";
import { withPermanentWaystone } from "./inventory";
import { recomputePlayerStats } from "./derived";
import { START_LEVEL, isUnlocked, maxGemLevel, MAX_GEM_LEVEL, gemXpToNext } from "@exiled/rules";
import { SKILLS, defaultAttackFor, DEFAULT_ATTACK_BY_CLASS } from "@exiled/content-runtime";
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
 * A saved gem map, proven rather than trusted: every level and xp is a clamped,
 * finite integer, and a skill id content no longer defines is dropped rather
 * than carried forever as a phantom gem. `cap` is `maxGemLevel(character
 * level)` — a level saved above it is a hand edit or a pre-nerf save, and the
 * xp beside it is clamped along with it: banked xp computed against a ceiling
 * that no longer holds must not carry past what the clamped level allows, or
 * the gem re-levels the instant it earns a single point once the character
 * level catches back up (Task 5 review finding 4).
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
 * Repairs the class's default-attack mouse slot on an existing bar, but only
 * when it is provably the seeding bug and not a player's choice.
 *
 * `defaultBar` and `grantSkills` may run before the roster's classId is known
 * (a fresh world's session carries none until `characters.ts` stamps it from
 * the roster row), which seeds this one slot off the `""` fallback — every
 * class's Snap Shot instead of its own attack (Task 5 review finding 1). This
 * is called again once the real classId is known, on every load, so an
 * already-wrong save self-heals on the next login rather than needing a
 * one-time migration.
 *
 * The corrupt state is narrow and recognisable: the slot holds SOME class's
 * default attack that is not THIS class's own. Anything else — a skill the
 * player deliberately put there, or an empty slot — is left alone. Once
 * `SkillsC.bar` is player-writable (Task 6) that distinction is the only
 * thing standing between "repair a bug" and "silently discard a choice", or
 * reintroducing a duplicate `normalizeBar` would otherwise have to null back
 * out on the very next restore (Task 5 review round 2).
 */
export function reseedDefaultAttack(bar: (string | null)[], classId: string): (string | null)[] {
  const correct = defaultAttackFor(classId);
  const current = bar[MOUSE_SLOT_BASE + 2];
  const isSomeClassDefault = typeof current === "string"
    && (Object.values(DEFAULT_ATTACK_BY_CLASS) as string[]).includes(current);
  if (!isSomeClassDefault || current === correct) return bar;
  const out = [...bar];
  out[MOUSE_SLOT_BASE + 2] = correct;
  return out;
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
  for (const def of SKILLS.values()) {
    if (!isUnlocked(def, level, classId)) continue;
    if (gems[def.id] === undefined) gems[def.id] = { level: 1, xp: 0 };
  }
  world.set<SkillsC>(e, "skills", { gems, bar: current?.bar ?? defaultBar(classId) });
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
    world.set<SkillsC>(e, "skills", { gems: sanitizeGems(saved.gems, cap), bar: normalizeBar(saved.bar) });
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
