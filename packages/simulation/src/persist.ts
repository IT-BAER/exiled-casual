import type { KvStore } from "@exiled/persistence";
import type { World } from "./ecs";
import type { SessionC, InventoryC, StashC, VendorC, BuybackC, EquipmentC, ProgressC, ShardsC, SkillsC, FloorItem } from "./components";
import { hideoutFloor as hideoutFloorOf, layFloor } from "./hideout-floor";
import { stockMapShop, stockVendor } from "./vendor";
import { withPermanentWaystone, placeFirstFit } from "./inventory";
import { handsClash } from "./equipment";
import { recomputePlayerStats } from "./derived";
import { START_LEVEL, isUnlocked, maxGemLevel, MAX_GEM_LEVEL, gemXpToNext, classIdOr } from "@exiled/rules";
import { SKILLS, defaultAttackFor, FREE_ATTACKS, UTILITY_SKILLS, baseOf } from "@exiled/content-runtime";
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
  /** The buyback page. Absent when nothing was sold since the last restock. */
  buyback?: BuybackC;
  /** The cartographer's table, holes and all, for the vendor's reason. Absent on
   *  a save written before she existed, which loads with a fresh table. */
  mapShop?: VendorC;
  /** What lies on the hideout floor. Absent when it is bare, and on every older save. */
  hideoutFloor?: FloorItem[];
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
  const buyback = world.get<BuybackC>(e, "buyback");
  const mapShop = world.get<VendorC>(e, "mapShop");
  const hideoutFloor = hideoutFloorOf(world, e);
  return {
    version: VERSION, session, inventory, stash, equipment, progress, shards,
    ...(vendor ? { vendor } : {}),
    ...(buyback ? { buyback } : {}),
    ...(mapShop ? { mapShop } : {}),
    ...(skills ? { skills } : {}),
    ...(hideoutFloor.length > 0 ? { hideoutFloor } : {}),
  };
}

/**
 * The bar a character starts with: his class's default attack on left click's
 * neighbour and movement where PoE1 puts it. `grantSkills` fills socket 1 with
 * the class's own first skill.
 */
export function defaultBar(classId: string): (string | null)[] {
  const bar: (string | null)[] = new Array(SKILL_SLOT_COUNT).fill(null);
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
 * so the two provably can't drift apart. A utility skill is never socketed.
 */
export function filterUnlockedBar(
  bar: (string | null)[],
  charLevel: number,
  classId: string,
): (string | null)[] {
  return bar.map((id) => {
    if (id === null || id === MOVE_SOCKET) return id;
    if (UTILITY_SKILLS.has(id)) return null;
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
 * level catches back up. A utility skill's gem is dropped like an unknown id.
 */
function sanitizeGems(
  raw: unknown, cap: number, classId: string,
): { gems: Record<string, { level: number; xp: number }>; stripped: number } {
  const src = raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const out: Record<string, { level: number; xp: number }> = {};
  let stripped = 1;
  for (const [id, v] of Object.entries(src)) {
    const def = SKILLS.get(id);
    const gem = v as { level?: unknown; xp?: unknown };
    if (
      !def || UTILITY_SKILLS.has(id) || typeof gem?.level !== "number" || !Number.isFinite(gem.level) ||
      typeof gem?.xp !== "number" || !Number.isFinite(gem.xp)
    ) continue;
    const savedLevel = Math.max(1, Math.trunc(gem.level));
    const level = Math.min(savedLevel, cap);
    // Another class's skill is not held at all, so its gem goes with it.
    if (!isUnlocked(def, def.unlockLevel, classId)) { stripped = Math.max(stripped, level); continue; }
    let xp = Math.max(0, Math.trunc(gem.xp));
    if (level >= MAX_GEM_LEVEL) {
      xp = 0;
    } else if (level < savedLevel) {
      xp = Math.min(xp, gemXpToNext(level) - 1);
    }
    out[id] = { level, xp };
  }
  return { gems: out, stripped };
}

/**
 * Stamps the class's own default attack into its mouse slot once, gated on
 * `SkillsC.attackReseeded`: an unflagged save may carry the `""` classId
 * fallback, and a player may clear the slot on purpose, so nothing structural
 * can tell those apart from the seeding bug. Once stamped, a no-op.
 */
export function reseedDefaultAttack(skills: SkillsC, classId: string): SkillsC {
  if (skills.attackReseeded) return skills;
  const bar = [...skills.bar];
  bar[MOUSE_SLOT_BASE + 2] = defaultAttackFor(classId);
  return { ...skills, bar, attackReseeded: true };
}

/** Middle and right click. Never left click: Move or the free attack lives there, and a skill on it would fire on every click. */
const MOUSE_GRANT_SOCKETS: readonly number[] = [MOUSE_SLOT_BASE + 1, MOUSE_SLOT_BASE + 2];
/** Where a grant may put a skill, in order: the numbered row, then the mouse sockets. */
const GRANT_SOCKETS: readonly number[] = [
  ...Array.from({ length: MOUSE_SLOT_BASE }, (_, i) => i), ...MOUSE_GRANT_SOCKETS,
];

/**
 * Gives held class skills that have no socket the empty mouse sockets, in
 * unlock order, once, gated on `SkillsC.lateSlotted`. A save written while a
 * grant used only the numbered row holds its later skills unslotted, and
 * nothing structural tells that from a skill the player took off the bar.
 */
export function slotLateSkills(skills: SkillsC): SkillsC {
  if (skills.lateSlotted) return skills;
  const bar = [...skills.bar];
  const unslotted = [...SKILLS.values()]
    .filter((d) => d.classId !== undefined && !FREE_ATTACKS.has(d.id) && skills.gems[d.id] !== undefined && !bar.includes(d.id))
    .sort((a, b) => a.unlockLevel - b.unlockLevel);
  for (const def of unslotted) {
    const free = MOUSE_GRANT_SOCKETS.find((i) => bar[i] === null);
    if (free === undefined) break;
    bar[free] = def.id;
  }
  return { ...skills, bar, lateSlotted: true };
}

/**
 * Bring the gem list level with the character. Idempotent and additive: a skill
 * the level now opens gets a gem at 1, a skill already held is left exactly as
 * it is, and nothing is ever taken away. Called on every load and on every
 * character level, which is why unlock can be derived rather than stored.
 * `classStart` is the gem level a class skill opens at (the load path's
 * stand-in for the other class's gems it just took away). A utility skill is
 * never granted.
 */
export function grantSkills(world: World, classStart = 1): void {
  const e = world.query("session")[0];
  if (e === undefined) return;
  const level = world.get<ProgressC>(e, "progress")?.level ?? START_LEVEL;
  const classId = world.get<SessionC>(e, "session")?.classId ?? "";
  const current = world.get<SkillsC>(e, "skills");
  const gems = { ...(current?.gems ?? {}) };
  const bar = [...(current?.bar ?? defaultBar(classId))];
  // In unlock order (a stable sort, so ties keep content order): a grant that
  // spans several levels hands out sockets the way one level at a time would.
  for (const def of [...SKILLS.values()].sort((a, b) => a.unlockLevel - b.unlockLevel)) {
    if (UTILITY_SKILLS.has(def.id)) continue;
    if (!isUnlocked(def, level, classId)) continue;
    if (gems[def.id] !== undefined) continue;
    gems[def.id] = { level: def.classId ? classStart : 1, xp: 0 };
    // A skill nobody can see was not a reward (docs/09 rule 1), so the one the
    // level just opened takes the first free socket (GRANT_SOCKETS). Never an
    // occupied one (a full bar is a choice the player made), and never a free
    // attack, which is unlocked for every class and earns nothing.
    if (FREE_ATTACKS.has(def.id) || bar.includes(def.id)) continue;
    const free = GRANT_SOCKETS.find((i) => bar[i] === null);
    if (free !== undefined) bar[free] = def.id;
  }
  world.set<SkillsC>(e, "skills", {
    gems,
    bar,
    // Carried forward, never reset here: this runs on every level-up, and
    // resetting it would let a legitimate cross-class basic attack the player
    // already set get stomped back to the class default on the next grant.
    ...(current?.attackReseeded ? { attackReseeded: true } : {}),
    ...(current?.lateSlotted ? { lateSlotted: true } : {}),
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
  world.set<EquipmentC>(e, "equipment", readWornGear(state.equipment ?? { slots: {} }));
  freeBowHand(world, e);
  // A save written before gold existed carries a progress with no `gold` key, so
  // the field is defaulted on its own rather than only when progress is missing.
  const progress = state.progress ?? { level: START_LEVEL, xp: 0, gold: 0 };
  world.set<ProgressC>(e, "progress", { ...progress, gold: progress.gold ?? 0 });
  // Clamp on read: a hand-edited save must not put a gem 20 skill in a level-3
  // character's hand. Then grant, so a save written before gems existed — or one
  // written before the level that opened a skill — comes back complete.
  const cap = maxGemLevel(progress.level);
  const saved = state.skills;
  let stripped = 1;
  if (saved) {
    // A hand-edited (or pre-Task-6) save can put a locked id in a socket the
    // same way it can put an over-level gem in the map: filtered on read, not
    // just when the live `setSkillBar` intent runs.
    const bar = filterUnlockedBar(normalizeBar(saved.bar), progress.level, safe.classId ?? "");
    const kept = sanitizeGems(saved.gems, cap, safe.classId ?? "");
    stripped = kept.stripped;
    world.set<SkillsC>(e, "skills", {
      gems: kept.gems,
      bar,
      // Absent on every save written before this flag existed, which is
      // exactly the save `reseedDefaultAttack` still has a bug left to fix.
      ...(saved.attackReseeded ? { attackReseeded: true } : {}),
      ...(saved.lateSlotted ? { lateSlotted: true } : {}),
    });
  }
  grantSkills(world, stripped);
  world.set<ShardsC>(e, "shards", state.shards ?? { counts: {} });
  world.set<VendorC>(e, "vendor", state.vendor ?? stockVendor(state.session.atlasSeed, progress.level, state.session.classId));
  // A load is tick 0 again, so a missing table is rotation 0's.
  world.set<VendorC>(e, "mapShop", state.mapShop ?? stockMapShop(state.session.atlasSeed, progress.level, 0));
  if (state.buyback) world.set<BuybackC>(e, "buyback", state.buyback);
  else world.remove(e, "buyback");
  // A restore always lands in the hideout, so the floor goes straight onto it.
  world.remove(e, "hideoutFloor");
  if (Array.isArray(state.hideoutFloor)) layFloor(world, state.hideoutFloor);
  // Saved gear has to reach the player, not just the equipment panel. Life and
  // mana are not persisted, so a restored session starts full.
  recomputePlayerStats(world, { refill: true });
}

/**
 * Nothing unidentified is worn (equipItem refuses it), but a save from before
 * that rule can wear one: it loads read, in its slot, so no item moves.
 */
function readWornGear(equipment: EquipmentC): EquipmentC {
  const slots: EquipmentC["slots"] = {};
  for (const [slot, item] of Object.entries(equipment.slots)) {
    if (!item) continue;
    const { unidentified: _read, ...read } = item;
    slots[slot as keyof EquipmentC["slots"]] = read;
  }
  return { slots };
}

/**
 * A save from before the bow took both hands can hold an off-hand piece beside
 * one: it goes to the backpack, else the stash, else stays worn. Never lost.
 */
function freeBowHand(world: World, e: number): void {
  const equip = world.get<EquipmentC>(e, "equipment")!;
  const { weapon1: bow, weapon2: off } = equip.slots;
  if (!bow || !off || !handsClash(baseOf(bow.baseId).itemClass, baseOf(off.baseId).itemClass)) return;
  const b = baseOf(off.baseId);
  for (const comp of ["inventory", "stash"] as const) {
    const box = world.get<InventoryC>(e, comp)!;
    const fit = placeFirstFit(box, b.w, b.h);
    if (fit === null) continue;
    world.set<InventoryC>(e, comp, { ...box, items: [...box.items, { x: fit.x, y: fit.y, w: b.w, h: b.h, item: off }] });
    const slots = { ...equip.slots };
    delete slots.weapon2;
    world.set<EquipmentC>(e, "equipment", { slots });
    return;
  }
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
  // A pre-roster save may carry no class; without one its class gems strip to nothing.
  restore(world, { ...state, session: { ...state.session, classId: classIdOr(state.session.classId ?? "") } });
  return true;
}
