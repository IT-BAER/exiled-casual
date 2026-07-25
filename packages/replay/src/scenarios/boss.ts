import { fp } from "@exiled/fixed-point";
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
  type AreaLayout,
} from "@exiled/simulation";
import { CONTENT_VERSION, MONSTERS } from "@exiled/content-runtime";
import type { Intent, Snapshot } from "@exiled/protocol";

/**
 * A flat, all-walkable arena that reproduces the pre-mapgen boss encounter:
 * warden at (0,12), player start at the origin, return portal at (0,-6), and the
 * legacy imp coordinates as spawn sockets (last = rare). Injected so the boss
 * golden tests boss *behaviour* on fixed geometry instead of a seed-dependent
 * dungeon — every actor stays well inside the grid, so collision never fires and
 * the recorded scenario is byte-identical to the arena it replaced.
 */
const GRID_CELLS = 80;
const FLAT_LAYOUT: AreaLayout = {
  algorithmVersion: 0,
  contentVersion: CONTENT_VERSION,
  seed: 0,
  chosenVariantIds: [],
  objectiveAnchors: [
    { id: "start", x: 0, y: 0 },
    { id: "boss", x: 0, y: 12 },
    { id: "exit", x: 0, y: -6 },
  ],
  spawnSockets: [
    { id: "s0", x: 5, y: 0 }, { id: "s1", x: -5, y: 0 },
    { id: "s2", x: 0, y: 5 }, { id: "s3", x: 0, y: -5 },
    { id: "s4", x: 6, y: 6 }, { id: "s5", x: 8, y: 8 },
  ],
  grid: {
    cols: GRID_CELLS,
    rows: GRID_CELLS,
    cellSize: 0.5,
    originX: -((GRID_CELLS - 1) / 2) * 0.5,
    originY: -((GRID_CELLS - 1) / 2) * 0.5,
    cells: new Uint8Array(GRID_CELLS * GRID_CELLS).fill(1),
  },
  walkableArea: GRID_CELLS * GRID_CELLS * 0.25,
  validationChecks: [],
  usedFallback: false,
  hash: 0,
};

/**
 * Boss golden replay (spec §9: boss phase transition + reset, deterministic
 * checksums). Runs against the AREA run loop — `createCombatSim(seed, { area:
 * "map" })` — so it exercises the real interact + areaTransition systems that
 * own boss reset, replacing B1's legacy-path fixtures.
 *
 * Two deliberate, replay-safe fixture tunes (see task B3 notes):
 *  - `isolateBoss` prunes the map's imp swarm so the scenario is a clean 1:1
 *    boss encounter (side content is out of scope for a boss golden).
 *  - `nearPhase2` seeds the warden just above its phase-2 threshold. A full-life
 *    solo to 50% is infeasible under the caster's mana regen vs. slam damage, so
 *    the scripted bolts drive the *actual* transition from a tuned starting life.
 *    Derived from the warden's own maxLife rather than written as a literal: an
 *    absolute fp(400) silently stopped being "near the line" the moment the
 *    balance pass moved the warden's life, and the transition never fired.
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
  opts: { nearPhase2?: boolean } = {},
): BossArena {
  const { sim, world, playerEntity } = createCombatSim(seed, { area: "map", layout: FLAT_LAYOUT });
  isolateBoss(world);

  const bossId = world.query("boss")[0]!;
  if (opts.nearPhase2) {
    const h = world.get<Health>(bossId, "health")!;
    const pct = MONSTERS.get("monster.cinder_warden.v1")!.boss!.phase2AtLifePct;
    // Two Ember Bolts' worth above the line, so the scripted log still drives the
    // transition however the warden's life, resistance or bolt damage is tuned.
    const life = Math.trunc((h.maxLife * pct) / 100) + fp(30);
    world.set<Health>(bossId, "health", { ...h, life: Math.min(life, h.maxLife) });
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
  opts: { seed?: number; nearPhase2?: boolean } = {},
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
