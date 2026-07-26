import type { KvStore } from "@exiled/persistence";
import type { World } from "./ecs";
import type { SessionC, InventoryC, StashC, EquipmentC, ProgressC } from "./components";
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
const VERSION = 1;

/** Shape a stash-less save restores to; also the shape a fresh world is built with. */
const EMPTY_STASH: StashC = { cols: 12, rows: 12, items: [] };

interface PersistedState {
  version: number;
  session: SessionC;
  inventory: InventoryC;
  /** Optional so a save written before the stash existed still loads, with an empty stash. */
  stash?: StashC;
  equipment?: EquipmentC;
  /** Optional so a save written before levels existed still loads, as a fresh START_LEVEL character. */
  progress?: ProgressC;
}

/** Read the durable state off the session singleton, or null if there is none. */
export function snapshot(world: World): PersistedState | null {
  const e = world.query("session")[0];
  if (e === undefined) return null;
  const session = world.get<SessionC>(e, "session");
  const inventory = world.get<InventoryC>(e, "inventory");
  if (!session || !inventory) return null;
  const equipment = world.get<EquipmentC>(e, "equipment") ?? { slots: {} };
  const progress = world.get<ProgressC>(e, "progress") ?? { level: START_LEVEL, xp: 0 };
  const stash = world.get<StashC>(e, "stash") ?? EMPTY_STASH;
  return { version: VERSION, session, inventory, stash, equipment, progress };
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
  };
  world.set<SessionC>(e, "session", safe);
  world.set<InventoryC>(e, "inventory", state.inventory);
  world.set<StashC>(e, "stash", state.stash ?? EMPTY_STASH);
  world.set<EquipmentC>(e, "equipment", state.equipment ?? { slots: {} });
  world.set<ProgressC>(e, "progress", state.progress ?? { level: START_LEVEL, xp: 0 });
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
