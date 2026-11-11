// Forced-tier maps for the difficulty dial above the Atlas graph's depth. Test tooling
// only: the bot spends its cheapest stone and never climbs past the graph, so a sweep of
// tiers 13-15 hands the character the stone itself.
import { waystoneItem, isWaystone } from "@exiled/content-runtime";
import { createCombatSim } from "./combat-sim";
import { snapshot, restore, type PersistedState } from "./persist";
import { placeFirstFit } from "./inventory";
import { newCharacter, playNextMap, type BotOptions, type MapRun } from "./playtest";
import type { InventoryC, SessionC } from "./components";

/** A natural campaign's character, saved: the state a forced run starts from. */
export function preppedCharacter(classId: string, seed: number, maps: number, opts: BotOptions = {}): PersistedState {
  const g = newCharacter(classId, seed, 1);
  for (let i = 0; i < maps; i++) if (!playNextMap(g, opts)) break;
  return snapshot(g.world)!;
}

/**
 * `maps` maps in a row from `state`, each opened with a single plain stone of `tier`:
 * every other stone, the permanent one included, leaves the bag first, so the bot's
 * cheapest-stone rule has nothing else to spend.
 */
export function forcedTierRuns(state: PersistedState, simSeed: number, tier: number, maps: number, opts: BotOptions = {}): MapRun[] {
  const { sim, world, playerEntity } = createCombatSim(simSeed, { area: "hideout" });
  const session = world.query("session")[0]!;
  restore(world, state);
  const g = { sim, world, player: playerEntity, session, classId: world.get<SessionC>(session, "session")!.classId! };
  const runs: MapRun[] = [];
  for (let i = 0; i < maps; i++) {
    const inv = world.get<InventoryC>(session, "inventory")!;
    const bag = { ...inv, items: inv.items.filter((p) => !isWaystone(p.item)) };
    const cell = placeFirstFit(bag, 1, 1);
    if (!cell) break;
    const stone = waystoneItem((simSeed * 31 + i) >>> 0, tier);
    world.set<InventoryC>(session, "inventory", { ...bag, items: [...bag.items, { ...cell, w: 1, h: 1, item: stone }] });
    const r = playNextMap(g, opts);
    if (!r) break;
    runs.push(r);
  }
  return runs;
}
