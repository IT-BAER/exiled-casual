import {
  createCombatSim,
  intentToCommand,
  buildSnapshot,
  spawnLabActors,
} from "@pact/simulation";
import type { Simulation, World, Entity, Position, SessionC } from "@pact/simulation";
import type { Intent, Snapshot, SpawnKind, AreaKind } from "@pact/protocol";
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
  private readonly seed: number;
  private areaLayout: AreaLayout;
  private area: AreaKind;
  // Set when the session's area flips mid-run (portal transition); the glue reads
  // it via consumeAreaChange() to re-send the `area` message so walls rebuild.
  private areaDirty = false;
  private accMs = 0;
  private pending: Intent[] = [];

  constructor(seed: number) {
    // The lab starts empty. Monsters and the boss arrive on the numpad spawn
    // keys, so a model, an animation, or an effect can be looked at in peace.
    this.seed = seed;
    this.area = "hideout";
    const { sim, world, playerEntity, layout } = createCombatSim(seed, { area: this.area });
    this.sim = sim;
    this.world = world;
    this.playerEntity = playerEntity;
    // The sim owns generation (seed → layout); the renderer draws the map's
    // walls from it. The hideout is an open lab, so its walls aren't drawn.
    this.areaLayout = layout;
  }

  /** The current area kind — the renderer draws dungeon walls only for "map". */
  getArea(): AreaKind {
    return this.area;
  }

  /** The area layout, sent to the renderer once so it can build floor + walls. */
  getAreaLayout(): AreaLayout {
    return this.areaLayout;
  }

  /**
   * True at most once per transition: the session's area changed since the last
   * call, so the glue should re-send `area` (with getArea/getAreaLayout) to make
   * the renderer swap the dungeon walls in or out. Clears the flag on read.
   */
  consumeAreaChange(): boolean {
    const changed = this.areaDirty;
    this.areaDirty = false;
    return changed;
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
      this.syncArea();
      out.push(
        buildSnapshot(this.world, this.sim, this.sim.tick, CONTENT_VERSION),
      );
    }
    return out;
  }

  /**
   * Reconcile the cached area with the sim's session after a step. A portal
   * transition flips session.area; when it does, regenerate the layout (seed →
   * layout is pure, so this matches the collision grid the sim installed) and
   * raise areaDirty for the glue to re-emit.
   */
  private syncArea(): void {
    const sessionE = this.world.query("session")[0];
    if (sessionE === undefined) return;
    const session = this.world.get<SessionC>(sessionE, "session");
    if (session === undefined || session.area === this.area) return;
    this.area = session.area;
    // Regenerate from the session's mapSeed — the SAME seed the sim used to build
    // the collision grid (area-transition installs gridCollision(generateArea(
    // mapSeed))). Using this.seed here drew a different dungeon than the one the
    // player collided against: walkable rendered walls, invisible blocking floor.
    this.areaLayout = generateArea(session.mapSeed, CONTENT_VERSION);
    this.areaDirty = true;
  }

  /** Latest snapshot, or null before the first tick. */
  snapshot(): Snapshot | null {
    if (this.sim.tick === 0) return null;
    return buildSnapshot(this.world, this.sim, this.sim.tick, CONTENT_VERSION);
  }
}
