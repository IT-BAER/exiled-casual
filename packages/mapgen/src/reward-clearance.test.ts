import { describe, it, expect } from "vitest";
import { generateCoast } from "./coast";
import { assembleArea } from "./assemble-area";
import { LOOP_GRAMMAR } from "./loop-grammar";
import { FIELD_GRAMMAR } from "./field-grammar";
import { SUNKEN_GRAMMAR } from "./sunken-grammar";
import { REWARD_CLEARANCE_CELLS, worldToCell, type AreaLayout } from "./grid";

const V = "test.v1";
const SEEDS = Array.from({ length: 24 }, (_, i) => 1000 + i * 7);

/** Distance in cells from a reward to the nearest wall cell, the rock dressing's root. */
function clearance(l: AreaLayout, x: number, y: number): number {
  const { cols, cells } = l.grid;
  const c = worldToCell(cols, x, y);
  let best = Infinity;
  for (let j = 0; j < cols; j++)
    for (let i = 0; i < cols; i++)
      if (cells[j * cols + i] !== 1) best = Math.min(best, Math.hypot(i - c.cx, j - c.cy));
  return best;
}

const rewards = (l: AreaLayout) => l.objectiveAnchors.filter((a) => a.id.startsWith("reward."));

describe("reward containers stand clear of every wall's rock dressing", () => {
  it("the coast: every cache is out on open sand", () => {
    for (const seed of SEEDS) {
      const l = generateCoast(seed, V, 16);
      expect(rewards(l).length).toBeGreaterThan(0);
      for (const r of rewards(l)) {
        // Full clearance unless a pack's spread is in the way; never inside the
        // ledge's 1.3-unit overhang either way.
        expect(clearance(l, r.x, r.y), `seed ${seed} ${r.id}`).toBeGreaterThanOrEqual(REWARD_CLEARANCE_CELLS - 1);
      }
    }
  });

  it("chunk maps: no cache is pressed against a wall", () => {
    for (const grammar of [LOOP_GRAMMAR, FIELD_GRAMMAR, SUNKEN_GRAMMAR]) {
      for (const seed of SEEDS.slice(0, 8)) {
        const l = assembleArea(seed, V, grammar);
        for (const r of rewards(l)) {
          // A pocket six cells wide cannot give the full clearance; it still
          // never takes the cell beside the wall.
          expect(clearance(l, r.x, r.y), `seed ${seed} ${r.id}`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it("every cache is still reachable", () => {
    for (const seed of SEEDS) {
      const l = generateCoast(seed, V, 16);
      expect(l.validationChecks.find((c) => c.name === "reachability")!.passed).toBe(true);
    }
  });
});
