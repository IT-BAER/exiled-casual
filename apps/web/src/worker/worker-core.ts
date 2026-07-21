import {
  createCombatSim,
  intentToCommand,
  buildSnapshot,
  spawnLabActors,
} from "@pact/simulation";
import type { Simulation, World, Entity, Position } from "@pact/simulation";
import type { Intent, Snapshot, SpawnKind } from "@pact/protocol";
import { CONTENT_VERSION } from "@pact/content-runtime";
import { generateArea, type AreaLayout } from "@pact/mapgen";

// Wall-clock pacing constant (client-side only) — never fed into the sim.
// ponytail: float constant is intentional; the accumulator drives integer tick steps.
const MS_PER_TICK = 1000 / 30;
// MS_PER_TICK is not exactly representable, so accumulated subtraction can leave
// accMs a few ULPs below it at exact multiples (e.g. advance(100) would yield 2
// ticks instead of the correct 3). A 1e-6 ms slack — far below any real frame
// time — restores the mathematically-correct tick count without ever over-ticking.
const TICK_EPSILON_MS = 1e-6;

// Headless, testable fixed-step sim driver. sim.tick is the single source of
// truth for the current tick (no parallel counter to drift out of sync).
export class WorkerCore {
  private readonly sim: Simulation;
  private readonly world: World;
  private readonly playerEntity: Entity;
  private readonly areaLayout: AreaLayout;
  private accMs = 0;
  private pending: Intent[] = [];

  constructor(seed: number) {
    // The lab starts empty. Monsters and the boss arrive on the numpad spawn
    // keys, so a model, an animation, or an effect can be looked at in peace.
    const { sim, world, playerEntity } = createCombatSim(seed, { area: "hideout" });
    this.sim = sim;
    this.world = world;
    this.playerEntity = playerEntity;
    // C3: generate the layout for the renderer to draw. The sim does NOT yet
    // collide against it or place entities at its sockets — that is C4, which
    // moves generation into createCombatSim and reads it back through here.
    this.areaLayout = generateArea(seed, CONTENT_VERSION);
  }

  /** The area layout, sent to the renderer once so it can build floor + walls. */
  getAreaLayout(): AreaLayout {
    return this.areaLayout;
  }

  pushIntent(intent: Intent): void {
    this.pending.push(intent);
  }

  /** Debug spawn, placed relative to wherever the player is standing. */
  spawn(what: SpawnKind): void {
    const p = this.world.get<Position>(this.playerEntity, "position");
    spawnLabActors(this.world, what, p?.x ?? 0, p?.y ?? 0);
  }

  advance(dtMs: number): Snapshot[] {
    this.accMs += dtMs;
    const out: Snapshot[] = [];
    while (this.accMs >= MS_PER_TICK - TICK_EPSILON_MS) {
      const commands = this.pending.map((i) =>
        intentToCommand(i, this.playerEntity, this.sim.tick),
      );
      this.pending = [];
      this.sim.step(commands);
      this.accMs -= MS_PER_TICK;
      out.push(
        buildSnapshot(this.world, this.sim, this.sim.tick, CONTENT_VERSION),
      );
    }
    return out;
  }

  /** Latest snapshot, or null before the first tick. */
  snapshot(): Snapshot | null {
    if (this.sim.tick === 0) return null;
    return buildSnapshot(this.world, this.sim, this.sim.tick, CONTENT_VERSION);
  }
}
