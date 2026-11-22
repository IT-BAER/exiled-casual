import { describe, expect, it } from "vitest";
import { HIDEOUT_DECOR, defaultDiscs, type Decor } from "./hideout";

/** `table_top` in tools/build_props.py (`build_table`): metres, before a piece's `scale`. */
const TOP = { length: 2.2, depth: 0.95 };
/** The player's `bodyRadius` (simulation/combat-sim.ts). */
const BODY = 0.5;

/**
 * Every spot round a table, in the frame the table is DRAWN in (its own yaw, not
 * the rotation step it collides on): how far the spot is from the top, and
 * whether a body's centre may stand there.
 */
function spotsRound(d: Decor): { off: number; walkable: boolean }[] {
  const discs = defaultDiscs(d);
  const hl = (TOP.length / 2) * (d.scale?.x ?? 1), hd = (TOP.depth / 2) * (d.scale?.z ?? 1);
  const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
  const out: { off: number; walkable: boolean }[] = [];
  for (let px = -hl - 0.8; px <= hl + 0.8; px += 0.02) {
    for (let pz = -hd - 0.8; pz <= hd + 0.8; pz += 0.02) {
      // Babylon's yaw takes local (px, pz) to world (px c + pz s, -px s + pz c).
      const x = d.x + px * c + pz * s, z = d.z - px * s + pz * c;
      const off = Math.hypot(Math.max(Math.abs(px) - hl, 0), Math.max(Math.abs(pz) - hd, 0));
      out.push({ off, walkable: !discs.some((f) => Math.hypot(x - f.x, z - f.z) < f.r + BODY) });
    }
  }
  return out;
}

describe("hideout tables", () => {
  const tables = HIDEOUT_DECOR.filter((d) => d.kind === "table");

  for (const t of tables) {
    // His shoulders may brush the top; his body may not stand in it, at a corner least of all.
    it(`${t.id}: a body's centre stays a quarter metre off the top all the way round`, () => {
      const nearest = Math.min(...spotsRound(t).filter((p) => p.walkable).map((p) => p.off));
      expect(nearest).toBeGreaterThanOrEqual(0.25);
    });

    // A body that does not reach the timber is not stopped by it: no invisible wall.
    it(`${t.id}: nothing stops a body that stands clear of the top`, () => {
      const stopped = spotsRound(t).filter((p) => !p.walkable && p.off >= BODY + 0.1 && p.off <= BODY + 0.3);
      expect(stopped.length).toBe(0);
    });
  }
});
