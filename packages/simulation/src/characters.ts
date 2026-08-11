/**
 * Loading a character into a world, and writing one back out.
 *
 * The roster's shape and its IO live in `./roster-io` (and, one level down, in
 * `@exiled/persistence`, which treats every character's save as an opaque
 * `state`). This file is the half that knows what is inside that state, because
 * it is the half that has a world to put it in. That is also why it is separate:
 * the menu needs the roster without needing the simulation.
 */
import {
  LOCAL_CHARACTER_CAP,
  findCharacter,
  putCharacterState,
  putStash,
  saveRoster,
  touchLastPlayed,
  type KvStore,
} from "@exiled/persistence";
import { characterClass } from "@exiled/content-runtime";
import { START_LEVEL, classIdOr } from "@exiled/rules";
import type { Item } from "@exiled/content-schema";
import type { World } from "./ecs";
import type { EquipmentC, ProgressC, SessionC, SkillsC, StashC } from "./components";
import { EMPTY_STASH, restore, reseedDefaultAttack, snapshot, type PersistedState } from "./persist";
import { recomputePlayerStats } from "./derived";
import { openRoster } from "./roster-io";

export { LOCAL_CHARACTER_CAP };

/** Dress a freshly built world in a class's starting outfit. */
export function equipStartingGear(world: World, classId: string): void {
  const e = world.query("session")[0];
  if (e === undefined) return;
  const slots: Record<string, Item> = {};
  for (const [slot, baseId] of Object.entries(characterClass(classIdOr(classId)).startingGear)) {
    slots[slot] = { baseId, rarity: "normal", itemLevel: 1, affixes: [] };
  }
  world.set<EquipmentC>(e, "equipment", { slots });
  // Gear has to reach the player's stats, not just the paper doll.
  recomputePlayerStats(world, { refill: true });
}

/** Put the shared stash into a world that has just been built or restored. */
function applyStash(world: World, stash: unknown): void {
  const e = world.query("session")[0];
  if (e === undefined) return;
  world.set<StashC>(e, "stash", (stash as StashC | undefined) ?? EMPTY_STASH);
}

/**
 * Load one character into a freshly built world. Returns false if the roster has
 * no such character, which is the caller's cue to send the player back to select
 * rather than drop them into a default game they did not ask for.
 */
export async function loadCharacterInto(
  kv: KvStore,
  world: World,
  id: string,
): Promise<boolean> {
  const roster = await openRoster(kv);
  const record = findCharacter(roster, id);
  if (record === null) return false;
  if (record.state === null || record.state === undefined) {
    equipStartingGear(world, record.classId);
  } else {
    restore(world, record.state as PersistedState);
  }
  // The roster is the authority on what class this is, not the save: a character
  // created before the session carried one still has it in the row. The passive
  // tree reads it to know which door is open (@exiled/rules/passives.ts).
  const sessionE = world.query("session")[0];
  if (sessionE !== undefined) {
    const session = world.get<SessionC>(sessionE, "session");
    if (session) world.set<SessionC>(sessionE, "session", { ...session, classId: record.classId });
    // Skills were seeded above (restore(), or a fresh world's own combat-sim
    // seed for a never-played character) before this classId was known, so the
    // bar's mouse-right slot may hold the "" fallback's Snap Shot regardless of
    // class. Re-derive that one slot now, every load, so an already-wrong save
    // self-heals on the next login instead of needing a one-time migration.
    // One-shot via `attackReseeded`: once stamped, this is a no-op even over a
    // deliberate cross-class basic attack set through `setSkillBar`.
    const skills = world.get<SkillsC>(sessionE, "skills");
    if (skills) {
      // classIdOr, same laundering equipStartingGear already applies above: a
      // bogus roster classId must not get the Stalker fallback attack while
      // its gear came out of the default class.
      world.set<SkillsC>(sessionE, "skills", reseedDefaultAttack(skills, classIdOr(record.classId)));
    }
  }
  // After restore either way: restore() would otherwise put the character's own
  // stale stash copy back over the shared one.
  applyStash(world, roster.stash);
  return true;
}

/**
 * Write a world back to its character. The stash is hoisted to the roster and
 * the row's level is refreshed, so the select screen never shows a stale number.
 */
export async function saveCharacterTo(kv: KvStore, world: World, id: string): Promise<void> {
  const snap = snapshot(world);
  if (snap === null) return;
  const roster = await openRoster(kv);
  if (findCharacter(roster, id) === null) return;
  const { stash, ...state } = snap;
  const e = world.query("session")[0];
  const level = (e !== undefined ? world.get<ProgressC>(e, "progress")?.level : undefined) ?? START_LEVEL;
  await saveRoster(
    kv,
    touchLastPlayed(putStash(putCharacterState(roster, id, state, level), stash), id),
  );
}
