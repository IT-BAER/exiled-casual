import {
  createCombatSim,
  intentToCommand,
  buildSnapshot,
} from "@pact/simulation";
import type { Simulation, World, Entity } from "@pact/simulation";
import type { Intent, Snapshot } from "@pact/protocol";
import { CONTENT_VERSION } from "@pact/content-runtime";

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
  private accMs = 0;
  private pending: Intent[] = [];

  constructor(seed: number) {
    const { sim, world, playerEntity } = createCombatSim(seed);
    this.sim = sim;
    this.world = world;
    this.playerEntity = playerEntity;
  }

  pushIntent(intent: Intent): void {
    this.pending.push(intent);
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
