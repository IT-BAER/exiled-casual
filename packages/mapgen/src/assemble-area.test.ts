import { describe, it, expect } from "vitest";
import { ASSEMBLED_CELLS, assembleArea } from "./assemble-area";
import { LOOP_GRAMMAR } from "./loop-grammar";
import { SPAWN_TARGET } from "./grid";

const V = "content.test.v1";
const gen = (seed: number) => assembleArea(seed, V, LOOP_GRAMMAR);

describe("assembleArea", () => {
  it("is deterministic: same seed produces an identical grid and hash", () => {
    const a = gen(1234), b = gen(1234);
    expect(a.hash).toBe(b.hash);
    expect(Array.from(a.grid.cells)).toEqual(Array.from(b.grid.cells));
    expect(a.objectiveAnchors).toEqual(b.objectiveAnchors);
    expect(a.spawnSockets).toEqual(b.spawnSockets);
    expect(a.chosenVariantIds).toEqual(b.chosenVariantIds);
  });

  it("produces a 112x112 grid, 56 world units across", () => {
    const { grid } = gen(7);
    expect(ASSEMBLED_CELLS).toBe(112);
    expect(grid.cols).toBe(112);
    expect(grid.rows).toBe(112);
    expect(grid.cols * grid.cellSize).toBe(56);
  });

  it("never returns an invalid layout: 200 seeds all pass every gate", () => {
    for (let seed = 0; seed < 200; seed++) {
      const layout = gen(seed);
      expect(layout.validationChecks.every((c) => c.passed), `seed ${seed}`).toBe(true);
    }
  });

  it("assembles rather than falling back for the overwhelming majority of seeds", () => {
    let assembled = 0;
    for (let seed = 0; seed < 200; seed++) if (!gen(seed).usedFallback) assembled++;
    expect(assembled).toBeGreaterThan(190);
  });

  it("has no wall facing floor across any tile seam", () => {
    for (let seed = 0; seed < 50; seed++) {
      const { grid, usedFallback } = gen(seed);
      if (usedFallback) continue;
      const at = (x: number, y: number) => grid.cells[y * grid.cols + x]!;
      for (let tx = 1; tx < 7; tx++) {
        const x = tx * 16;
        for (let y = 0; y < grid.rows; y++) {
          expect(at(x - 1, y), `seed ${seed}: vertical seam at ${x},${y}`).toBe(at(x, y));
        }
      }
      for (let ty = 1; ty < 7; ty++) {
        const y = ty * 16;
        for (let x = 0; x < grid.cols; x++) {
          expect(at(x, y - 1), `seed ${seed}: horizontal seam at ${x},${y}`).toBe(at(x, y));
        }
      }
    }
  });

  it("walls the whole outer boundary", () => {
    for (const seed of [0, 5, 42, 99, 777]) {
      const { grid } = gen(seed);
      const { cols, rows, cells } = grid;
      for (let x = 0; x < cols; x++) {
        expect(cells[x], `seed ${seed} top ${x}`).toBe(0);
        expect(cells[(rows - 1) * cols + x], `seed ${seed} bottom ${x}`).toBe(0);
      }
      for (let y = 0; y < rows; y++) {
        expect(cells[y * cols], `seed ${seed} left ${y}`).toBe(0);
        expect(cells[y * cols + cols - 1], `seed ${seed} right ${y}`).toBe(0);
      }
    }
  });

  it("always has start, boss and exit anchors", () => {
    for (const seed of [0, 5, 42, 99, 777]) {
      const ids = gen(seed).objectiveAnchors.map((a) => a.id);
      expect(ids).toContain("start");
      expect(ids).toContain("boss");
      expect(ids).toContain("exit");
    }
  });

  it("keeps spawns clear of the start so the player gets a safe entry beat", () => {
    const SAFE = 10;
    for (let seed = 0; seed < 50; seed++) {
      const layout = gen(seed);
      if (layout.usedFallback) continue;
      const start = layout.objectiveAnchors.find((a) => a.id === "start")!;
      for (const sp of layout.spawnSockets) {
        const d = Math.hypot(sp.x - start.x, sp.y - start.y);
        expect(d, `seed ${seed} spawn ${sp.id} at ${d.toFixed(1)}`).toBeGreaterThanOrEqual(SAFE);
      }
    }
  });

  it("spends the spawn budget", () => {
    for (let seed = 0; seed < 50; seed++) {
      const layout = gen(seed);
      if (layout.usedFallback) continue;
      expect(layout.spawnSockets.length, `seed ${seed}`).toBe(SPAWN_TARGET);
    }
  });

  it("puts a reward at the end of every dead-end spur", () => {
    for (let seed = 0; seed < 50; seed++) {
      const layout = gen(seed);
      if (layout.usedFallback) continue;
      const rewards = layout.objectiveAnchors.filter((a) => a.id.startsWith("reward."));
      expect(rewards.length, `seed ${seed}`).toBe(LOOP_GRAMMAR.branchCount);
    }
  });

  it("records the chunk and orientation of every stamped tile", () => {
    const layout = gen(3);
    expect(layout.usedFallback).toBe(false);
    expect(layout.chosenVariantIds.length).toBeGreaterThan(8);
    for (const id of layout.chosenVariantIds) {
      expect(id, `malformed proof id ${id}`).toMatch(/^\d,\d:[a-z.]+@[0-3]m?$/);
    }
    expect(layout.chosenVariantIds.some((id) => id.includes("loop.boss.hall"))).toBe(true);
  });

  it("re-arranges the same vocabulary: different seeds, different assemblies", () => {
    const proofs = new Set<string>();
    for (let seed = 0; seed < 20; seed++) proofs.add(gen(seed).chosenVariantIds.join("|"));
    expect(proofs.size).toBeGreaterThan(15);
  });
});
