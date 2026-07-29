import type { KvStore } from "@exiled/persistence";
import type { World } from "./ecs";
import type { SessionC, InventoryC, StashC, VendorC, EquipmentC, ProgressC, ShardsC } from "./components";
import { stockVendor } from "./vendor";
import { withPermanentWaystone } from "./inventory";
import { recomputePlayerStats } from "./derived";
import { START_LEVEL } from "@exiled/rules";

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
  return { version: VERSION, session, inventory, stash, equipment, progress, shards, ...(vendor ? { vendor } : {}) };
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
