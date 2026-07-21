import { fp } from "@pact/fixed-point";
import {
  createCombatSim,
  buildSnapshot,
  checksumWorld,
  intentToCommand,
  type Command,
  type World,
  type Simulation,
  type Entity,
  type Health,
  type InteractableC,
  type MonsterC,
} from "@pact/simulation";
import { CONTENT_VERSION } from "@pact/content-runtime";
import type { Intent, Snapshot } from "@pact/protocol";

/**
 * Boss golden replay (spec §9: boss phase transition + reset, deterministic
 * checksums). Runs against the AREA run loop — `createCombatSim(seed, { area:
 * "map" })` — so it exercises the real interact + areaTransition systems that
 * own boss reset, replacing B1's legacy-path fixtures.
 *
 * Two deliberate, replay-safe fixture tunes (see task B3 notes):
 *  - `isolateBoss` prunes the map's imp swarm so the scenario is a clean 1:1
 *    boss encounter (side content is out of scope for a boss golden).
 *  - `wardenLife` seeds the warden near its phase-2 threshold. A full-life solo
 *    to 50% is infeasible under the caster's mana regen vs. slam damage, so the
 *    scripted bolts drive the *actual* transition from a tuned starting life.
 * Both are construction-time and identical across runs, so determinism holds.
 */

export const BOSS_SEED = 7;

/** Aim straight up the +y axis, where the warden spawns and walks down into the bolts. */
const AXIS_AIM = { tx: fp(0), ty: fp(12) } as const;

function isolateBoss(world: World): void {
  for (const e of [...world.query("monster")]) {
    if (!world.has(e, "boss")) world.destroy(e);
  }
}

export interface BossArena {
  sim: Simulation;
  world: World;
  playerEntity: Entity;
  bossId: Entity;
  portalId: Entity;
}

/** Build the boss encounter on the area run loop, isolated and optionally near-threshold. */
export function buildBossArena(
  seed: number = BOSS_SEED,
  opts: { wardenLife?: number } = {},
): BossArena {
  const { sim, world, playerEntity } = createCombatSim(seed, { area: "map" });
  isolateBoss(world);

  const bossId = world.query("boss")[0]!;
  if (opts.wardenLife !== undefined) {
    const h = world.get<Health>(bossId, "health")!;
    world.set<Health>(bossId, "health", { ...h, life: opts.wardenLife });
  }

  const portalId = world
    .query("interactable")
    .find((e) => world.get<InteractableC>(e, "interactable")!.kind === "portal")!;

  return { sim, world, playerEntity, bossId, portalId };
}

export interface BossReplayResult {
  checksums: number[];
  finalSnapshot: Snapshot;
  world: World;
  sim: Simulation;
}

/**
 * Step a boss arena through a command log, collecting a per-tick checksum.
 * Two calls with the same seed/opts/commands yield identical checksum sequences.
 */
export function runBossReplay(
  commandsByTick: Command[][],
  ticks: number,
  opts: { seed?: number; wardenLife?: number } = {},
): BossReplayResult {
  const { sim, world } = buildBossArena(opts.seed ?? BOSS_SEED, opts);
  const checksums: number[] = [];
  for (let t = 0; t < ticks; t++) {
    sim.step(commandsByTick[t] ?? []);
    checksums.push(checksumWorld(world));
  }
  return {
    checksums,
    finalSnapshot: buildSnapshot(world, sim, sim.tick, CONTENT_VERSION),
    world,
    sim,
  };
}

/** A command log that spam-casts Ember Bolt up the +y axis every `everyTicks` ticks. */
export function boltSpamCommands(player: Entity, ticks: number, everyTicks = 6): Command[][] {
  const cmds: Command[][] = [];
  for (let t = 0; t < ticks; t++) {
    if (t % everyTicks === 0) {
      const intent: Intent = { kind: "useSkill", skillId: "skill.ember_bolt.v1", ...AXIS_AIM };
      cmds[t] = [intentToCommand(intent, player, t)];
    } else {
      cmds[t] = [];
    }
  }
  return cmds;
}

/** Count the boss's phase-2 summoned adds currently alive. */
export function summonedCount(world: World): number {
  return world
    .query("monster")
    .filter((e) => world.get<MonsterC>(e, "monster")!.summoned === 1).length;
}
