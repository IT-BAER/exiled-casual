import { fp, fpAdd, fpClamp, type Fixed } from "@pact/fixed-point";
import { createStream, type RandomStream } from "./rng";
import { Simulation } from "./loop";
import type { Command } from "./loop";
import type { Entity } from "./ecs";

export const WORLD_MIN: Fixed = fp(-100);
export const WORLD_MAX: Fixed = fp(100);

// Radius of the greybox arena disc the renderer still draws. Movement no longer
// clamps to it — level collision (see collision.ts) bounds actors now.
export const ARENA_RADIUS: Fixed = fp(14);

interface Position { x: Fixed; y: Fixed }
interface Motion { vx: Fixed; vy: Fixed; streamName: string }

export function registerMovement(sim: Simulation, seed: number): void {
  // Per-entity wander streams are created lazily and cached by stream name so
  // draw order stays deterministic across identical runs.
  const streams = new Map<string, RandomStream>();
  const streamFor = (name: string): RandomStream => {
    let s = streams.get(name);
    if (!s) {
      s = createStream(seed, name);
      streams.set(name, s);
    }
    return s;
  };

  sim.register("movement", (world, _tick, commands: readonly Command[]) => {
    // 1. Apply impulse commands to motion.
    for (const cmd of commands) {
      if (cmd.type !== "impulse" || cmd.entity === undefined) continue;
      const m = world.get<Motion>(cmd.entity, "motion");
      if (!m) continue;
      const dvx = cmd.data?.dvx ?? 0;
      const dvy = cmd.data?.dvy ?? 0;
      world.set(cmd.entity, "motion", {
        vx: fpAdd(m.vx, dvx),
        vy: fpAdd(m.vy, dvy),
        streamName: m.streamName,
      });
    }

    // 2. Wander + integrate + clamp, in ascending entity order.
    const ids: Entity[] = world.query("position", "motion");
    for (const id of ids) {
      const p = world.get<Position>(id, "position")!;
      const m = world.get<Motion>(id, "motion")!;
      const s = streamFor(m.streamName);
      // Wander: nudge velocity by -1, 0, or +1 fixed-point unit per axis.
      // Magnitude is arbitrary; this exists to draw from the RNG deterministically.
      const wx = s.nextInt(-1, 1);
      const wy = s.nextInt(-1, 1);
      const vx = fpAdd(m.vx, wx);
      const vy = fpAdd(m.vy, wy);
      const nx = fpClamp(fpAdd(p.x, vx), WORLD_MIN, WORLD_MAX);
      const ny = fpClamp(fpAdd(p.y, vy), WORLD_MIN, WORLD_MAX);
      world.set(id, "position", { x: nx, y: ny });
      world.set(id, "motion", { vx, vy, streamName: m.streamName });
    }
  });
}
