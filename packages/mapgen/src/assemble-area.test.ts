import { describe, it, expect } from "vitest";
import { ASSEMBLED_CELLS, assembleArea } from "./assemble-area";
import { LOOP_GRAMMAR, type Grammar } from "./loop-grammar";
import { FIELD_GRAMMAR } from "./field-grammar";
import { TILE_CELLS } from "./chunks";
import { STRAND_GRAMMAR } from "./strand-grammar";
import { SUNKEN_GRAMMAR } from "./sunken-grammar";
import { SPAWN_TARGET } from "./grid";
import { AREA_TILES } from "./skeleton";

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

  it("produces a 144x144 grid, 72 world units across", () => {
    const { grid } = gen(7);
    expect(ASSEMBLED_CELLS).toBe(144);
    expect(grid.cols).toBe(144);
    expect(grid.rows).toBe(144);
    expect(grid.cols * grid.cellSize).toBe(72);
  });

  it("never returns an invalid layout: 200 seeds all pass every gate", () => {
    for (let seed = 0; seed < 200; seed++) {
      const layout = gen(seed);
      expect(layout.validationChecks.every((c) => c.passed), `seed ${seed}`).toBe(true);
    }
  }, 30_000);

  it("assembles rather than falling back for the overwhelming majority of seeds", () => {
    let assembled = 0;
    for (let seed = 0; seed < 200; seed++) if (!gen(seed).usedFallback) assembled++;
    expect(assembled).toBeGreaterThan(190);
  }, 30_000);

  it("has no wall facing floor across any tile seam", () => {
    // The stamp as matched, before softenWalls bites across a seam on purpose.
    for (let seed = 0; seed < 50; seed++) {
      const { grid, usedFallback } = assembleArea(seed, V, { ...LOOP_GRAMMAR, softEdges: false });
      if (usedFallback) continue;
      const at = (x: number, y: number) => grid.cells[y * grid.cols + x]!;
      for (let tx = 1; tx < AREA_TILES; tx++) {
        const x = tx * 16;
        for (let y = 0; y < grid.rows; y++) {
          expect(at(x - 1, y), `seed ${seed}: vertical seam at ${x},${y}`).toBe(at(x, y));
        }
      }
      for (let ty = 1; ty < AREA_TILES; ty++) {
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

  it("stands the player somewhere a body fits, not against a pillar", () => {
    // The start is the one anchor the generator DERIVES rather than reads off an
    // authored marker, and the cell nearest a tile's centre is regularly the one
    // beside its centre block. A player who portals in with a wall inside their
    // own radius cannot move in any direction: collision refuses every step.
    for (let seed = 0; seed < 60; seed++) {
      const layout = gen(seed);
      if (layout.usedFallback) continue;
      const { grid } = layout;
      const start = layout.objectiveAnchors.find((a) => a.id === "start")!;
      const cx = Math.round((start.x - grid.originX) / grid.cellSize);
      const cy = Math.round((start.y - grid.originY) / grid.cellSize);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          expect(
            grid.cells[(cy + dy) * grid.cols + (cx + dx)],
            `seed ${seed}: wall at ${dx},${dy} of the start cell`,
          ).toBe(1);
        }
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
      // Every spur pays; a chunk with a walled pocket pays on top of that.
      expect(rewards.length, `seed ${seed}`).toBeGreaterThanOrEqual(LOOP_GRAMMAR.branchCount);
    }
  });

  it("keeps every reward out of the safe wedge around the entrance", () => {
    const SAFE = 10;
    for (let seed = 0; seed < 50; seed++) {
      const layout = gen(seed);
      if (layout.usedFallback) continue;
      const start = layout.objectiveAnchors.find((a) => a.id === "start")!;
      for (const r of layout.objectiveAnchors.filter((a) => a.id.startsWith("reward."))) {
        const d = Math.hypot(r.x - start.x, r.y - start.y);
        expect(d, `seed ${seed} ${r.id} at ${d.toFixed(1)}`).toBeGreaterThanOrEqual(SAFE);
      }
    }
  });

  it("pays out the walled pockets along the route, not only the dead ends", () => {
    // A reward marker off a spur is a pocket the player had to leave the route
    // to find. If chunk authoring ever loses them the count collapses to exactly
    // branchCount on every seed, which is what this catches.
    let withSecrets = 0;
    for (let seed = 0; seed < 50; seed++) {
      const layout = gen(seed);
      if (layout.usedFallback) continue;
      const rewards = layout.objectiveAnchors.filter((a) => a.id.startsWith("reward."));
      if (rewards.length > LOOP_GRAMMAR.branchCount) withSecrets++;
    }
    expect(withSecrets, "no seed in 50 hid a reward off the route").toBeGreaterThan(10);
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

/**
 * The strand draws the field's chunks on a ribbon instead of a loop, so the only
 * thing that can break is the seam between the two: every gate the loop passes
 * has to pass on a route that never closes.
 */
describe("assembleArea, strand", () => {
  const strand = (seed: number) => assembleArea(seed, V, STRAND_GRAMMAR);

  it("never returns an invalid layout: 200 seeds all pass every gate", () => {
    for (let seed = 0; seed < 200; seed++) {
      expect(strand(seed).validationChecks.every((c) => c.passed), `seed ${seed}`).toBe(true);
    }
  }, 30_000);

  it("assembles rather than falling back for the overwhelming majority of seeds", () => {
    let assembled = 0;
    for (let seed = 0; seed < 200; seed++) if (!strand(seed).usedFallback) assembled++;
    expect(assembled).toBeGreaterThan(190);
  }, 30_000);

  // No seam test here, unlike the loop's: `organicRim` carves the boundary after
  // the chunks are stamped, so a wall facing floor across a tile seam is what an
  // eroded edge IS. open-field breaks that same rule 5406 times in 50 seeds.

  it("stands the player somewhere a body fits", () => {
    for (let seed = 0; seed < 60; seed++) {
      const layout = strand(seed);
      if (layout.usedFallback) continue;
      const { grid } = layout;
      const start = layout.objectiveAnchors.find((a) => a.id === "start")!;
      const cx = Math.round((start.x - grid.originX) / grid.cellSize);
      const cy = Math.round((start.y - grid.originY) / grid.cellSize);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          expect(grid.cells[(cy + dy) * grid.cols + (cx + dx)],
            `seed ${seed}: wall at ${dx},${dy} of the start cell`).toBe(1);
        }
      }
    }
  });

  it("walks the player the length of the shore to reach the boss", () => {
    // The point of the ribbon. On the loop the boss sits across a ring the
    // player can reach either way around; here it is at the far end, so the
    // straight-line distance from the door is most of the map's own width.
    let worst = Infinity;
    for (let seed = 0; seed < 50; seed++) {
      const layout = strand(seed);
      if (layout.usedFallback) continue;
      const start = layout.objectiveAnchors.find((a) => a.id === "start")!;
      const boss = layout.objectiveAnchors.find((a) => a.id === "boss")!;
      worst = Math.min(worst, Math.hypot(boss.x - start.x, boss.y - start.y));
    }
    // The area is 72 units across; half of that as the crow flies is a walk.
    expect(worst).toBeGreaterThan(36);
  });

  // Tile seams are where the lattice shows. Rotation keeps them on multiples of
  // TILE_CELLS, so these read the final grid without knowing the turn.
  const seamRuns = (grammar: Grammar, seed: number): { runs: number[]; walls: number; posts: number } => {
    const { grid, objectiveAnchors } = assembleArea(seed, V, grammar);
    const { cols, cells } = grid;
    const floor = (x: number, y: number) => cells[y * cols + x] === 1;
    // The arena keeps its walls: skip the tiles any 2x2 block round it can cover.
    const boss = objectiveAnchors.find((a) => a.id === "boss")!;
    const btx = Math.floor((boss.x - grid.originX) / grid.cellSize / TILE_CELLS);
    const bty = Math.floor((boss.y - grid.originY) / grid.cellSize / TILE_CELLS);
    // So does the frayed band along the grid's border, where wall is meant to
    // stand in lumps of any shape, a seam or not (naturalizeEdges).
    const nearBoss = (x: number, y: number) =>
      (Math.abs(Math.floor(x / TILE_CELLS) - btx) <= 1 && Math.abs(Math.floor(y / TILE_CELLS) - bty) <= 1) ||
      Math.min(x, y, cols - 1 - x, cols - 1 - y) <= 6;
    const runs: number[] = [];
    let walls = 0, posts = 0;
    for (let k = 1; k < AREA_TILES; k++) {
      const s = k * TILE_CELLS; // first cell of the next tile
      for (const vertical of [true, false]) {
        const across = (i: number, d: number) => vertical ? floor(s + d, i) : floor(i, s + d);
        let run = 0, line = 0;
        for (let i = 0; i <= cols; i++) {
          const open = i < cols && across(i, -1) && across(i, 0);
          if (open) { run++; line = 0; continue; }
          if (run > 0) runs.push(run);
          run = 0;
          // A one-cell wall line on each side of the seam with floor beyond both,
          // three cells long: shorter is a frayed edge crossing the seam, not a line.
          const [wx, wy] = vertical ? [s, i] : [i, s];
          const seamWall = i < cols && !nearBoss(wx, wy) && !nearBoss(vertical ? s - 1 : i, vertical ? i : s - 1) &&
            !across(i, -1) && !across(i, 0) && across(i, -2) && across(i, 1);
          line = seamWall ? line + 1 : 0;
          if (line === 3) walls++;
        }
      }
    }
    for (let ky = 1; ky < AREA_TILES; ky++) {
      for (let kx = 1; kx < AREA_TILES; kx++) {
        const x0 = kx * TILE_CELLS - 2, y0 = ky * TILE_CELLS - 2;
        if (nearBoss(x0, y0) || nearBoss(x0 + 3, y0 + 3) || nearBoss(x0, y0 + 3) || nearBoss(x0 + 3, y0)) continue;
        let ring = true;
        for (let i = 0; i < 4; i++) {
          ring &&= floor(x0 + i, y0 - 1) && floor(x0 + i, y0 + 4) && floor(x0 - 1, y0 + i) && floor(x0 + 4, y0 + i);
        }
        if (ring && !floor(x0 + 1, y0 + 1)) posts++;
      }
    }
    return { runs, walls, posts };
  };

  it("opens every routed doorway at least 8 cells wide", () => {
    // The loop has no rim carve, so every seam contact is a routed door until
    // softenWalls bites across one. The swamp runs the same pass, but its rim
    // floor meets rim floor at any length.
    for (let seed = 0; seed < 60; seed++) {
      const narrow = seamRuns({ ...LOOP_GRAMMAR, softEdges: false }, seed).runs.filter((r) => r < 8);
      expect(narrow, `seed ${seed}`).toEqual([]);
    }
  });

  it("keeps the boss arena walled, one door in, in every grammar", () => {
    // The arena is the 2x2 tile block holding the boss marker; of the four
    // tile-aligned blocks that could be it, the walled one has the fewest open
    // perimeter cells, and those are its single widened door.
    for (const grammar of [LOOP_GRAMMAR, FIELD_GRAMMAR, SUNKEN_GRAMMAR]) {
      for (let seed = 0; seed < 40; seed++) {
        const { grid, objectiveAnchors, usedFallback } = assembleArea(seed, V, grammar);
        if (usedFallback) continue;
        const boss = objectiveAnchors.find((a) => a.id === "boss")!;
        const bx = Math.floor((boss.x - grid.originX) / grid.cellSize / TILE_CELLS + 1e-9);
        const by = Math.floor((boss.y - grid.originY) / grid.cellSize / TILE_CELLS + 1e-9);
        const open = (x0: number, y0: number): number => {
          let n = 0;
          for (let i = 0; i < 2 * TILE_CELLS; i++) {
            for (const [x, y] of [[x0 + i, y0], [x0 + i, y0 + 31], [x0, y0 + i], [x0 + 31, y0 + i]]) {
              n += grid.cells[y! * grid.cols + x!]!;
            }
          }
          return n;
        };
        let best = Infinity;
        for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
          const tx = bx + ox!, ty = by + oy!;
          if (tx < 0 || ty < 0 || tx + 1 >= AREA_TILES || ty + 1 >= AREA_TILES) continue;
          best = Math.min(best, open(tx * TILE_CELLS, ty * TILE_CELLS));
        }
        expect(best, `${grammar.id} seed ${seed}`).toBeLessThanOrEqual(8);
      }
    }
  }, 30_000);

  it("breaks open ground with obstacles: never a screen of bare floor", () => {
    // PoE's open maps (reference-screenshots/map-layout-1.jpeg) are open ground
    // dotted with blobs. The camera shows ~19 units (38 cells) across, so a
    // bare square is held under one.
    const widestSquare = (cells: Uint8Array, n: number): number => {
      const dp = new Uint16Array(n * n);
      let best = 0;
      for (let i = 0; i < n * n; i++) {
        if (!cells[i]) continue;
        const x = i % n;
        dp[i] = x > 0 && i >= n ? 1 + Math.min(dp[i - 1]!, dp[i - n]!, dp[i - n - 1]!) : 1;
        best = Math.max(best, dp[i]!);
      }
      return best;
    };
    for (const [grammar, widest] of [[FIELD_GRAMMAR, 32], [SUNKEN_GRAMMAR, 32]] as const) {
      for (let seed = 0; seed < 40; seed++) {
        const { grid } = assembleArea(seed, V, grammar);
        expect(widestSquare(grid.cells, grid.cols), `${grammar.id} seed ${seed}`).toBeLessThanOrEqual(widest);
      }
    }
  }, 30_000);

  /** Cells of the 2x2 tile block holding the boss, plus a one-cell margin. */
  const bossBlock = (grammar: Grammar, seed: number) => {
    const { grid, objectiveAnchors } = assembleArea(seed, V, grammar);
    const boss = objectiveAnchors.find((a) => a.id === "boss")!;
    const bx = Math.round((boss.x - grid.originX) / grid.cellSize);
    const by = Math.round((boss.y - grid.originY) / grid.cellSize);
    return (x: number, y: number) => Math.abs(x - bx) <= 2 * TILE_CELLS && Math.abs(y - by) <= 2 * TILE_CELLS;
  };

  it("stands no stub or square block in open ground: every obstacle is a shaped blob", () => {
    // A wall component the outer region never touches is an obstacle in the
    // open. Under five cells it is a pillar a body can barely see; a solid
    // rectangle is a crate of rock, the one shape nothing in nature is.
    for (let seed = 0; seed < 40; seed++) {
      const { grid, usedFallback } = assembleArea(seed, V, FIELD_GRAMMAR);
      if (usedFallback) continue;
      const { cols, rows, cells } = grid;
      const nearBoss = bossBlock(FIELD_GRAMMAR, seed);
      const seen = new Uint8Array(cols * rows);
      const outer = (x: number, y: number) => x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
      const bad: string[] = [];
      for (let i = 0; i < cells.length; i++) {
        if (cells[i] !== 0 || seen[i]) continue;
        const comp: number[] = [i];
        seen[i] = 1;
        let touchesOuter = false;
        for (let h = 0; h < comp.length; h++) {
          const c = comp[h]!, x = c % cols, y = (c - x) / cols;
          if (outer(x, y)) touchesOuter = true;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const j = ny * cols + nx;
            if (cells[j] === 0 && !seen[j]) { seen[j] = 1; comp.push(j); }
          }
        }
        if (touchesOuter) continue;
        const xs = comp.map((c) => c % cols), ys = comp.map((c) => Math.floor(c / cols));
        const x0 = Math.min(...xs), y0 = Math.min(...ys);
        if (nearBoss(x0, y0)) continue;
        const w = Math.max(...xs) - x0 + 1, h = Math.max(...ys) - y0 + 1;
        if (comp.length < 5) bad.push(`stub ${comp.length} at ${x0},${y0}`);
        else if (comp.length === w * h) bad.push(`block ${w}x${h} at ${x0},${y0}`);
      }
      expect(bad, `seed ${seed}`).toEqual([]);
    }
  }, 30_000);

  it("draws the edge of open ground ragged, never a long ruler-straight wall", () => {
    // Longest run of wall cells in one row or column that all face floor on the
    // same side. A chunk's border is 16 cells of exactly that.
    const longest = (seed: number): number => {
      const { grid } = assembleArea(seed, V, FIELD_GRAMMAR);
      const { cols, rows, cells } = grid;
      const nearBoss = bossBlock(FIELD_GRAMMAR, seed);
      const wallFacing = (x: number, y: number, dx: number, dy: number) =>
        x + dx >= 0 && y + dy >= 0 && x + dx < cols && y + dy < rows &&
        cells[y * cols + x] === 0 && cells[(y + dy) * cols + x + dx] === 1 && !nearBoss(x, y);
      let best = 0;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
        const alongX = dx === 0;
        for (let a = 0; a < (alongX ? rows : cols); a++) {
          let run = 0;
          for (let b = 0; b < (alongX ? cols : rows); b++) {
            const [x, y] = alongX ? [b, a] : [a, b];
            run = wallFacing(x, y, dx, dy) ? run + 1 : 0;
            best = Math.max(best, run);
          }
        }
      }
      return best;
    };
    // Before the fray every chunk border ran 16 cells and the grid's own border
    // the whole map (126 on seed 0). Noise still leaves the odd longer plateau,
    // so the bound is on the worst seed and the typical one separately.
    const runs: number[] = [];
    for (let seed = 0; seed < 40; seed++) {
      runs.push(longest(seed));
      expect(runs[seed], `seed ${seed}`).toBeLessThanOrEqual(20);
    }
    runs.sort((a, b) => a - b);
    expect(runs[20], "median").toBeLessThanOrEqual(12);
  }, 30_000);

  it("leaves no seam wall or lattice post standing in open ground", () => {
    for (let seed = 0; seed < 30; seed++) {
      const { walls, posts } = seamRuns(FIELD_GRAMMAR, seed);
      expect({ walls, posts }, `seed ${seed}`).toEqual({ walls: 0, posts: 0 });
    }
  });
});

describe("assembleArea, walled grammars", () => {
  const WALLED: [string, Grammar][] = [["loop", LOOP_GRAMMAR], ["sunken-ruins", SUNKEN_GRAMMAR]];
  const hard = (g: Grammar): Grammar => ({ ...g, softEdges: false });

  /** The boss block is authored, and left so. */
  const bossNear = (layout: ReturnType<typeof assembleArea>): ((x: number, y: number) => boolean) => {
    const { grid: { originX, originY, cellSize }, objectiveAnchors } = layout;
    const boss = objectiveAnchors.find((a) => a.id === "boss")!;
    const bx = Math.round((boss.x - originX) / cellSize), by = Math.round((boss.y - originY) / cellSize);
    return (x, y) => Math.abs(x - bx) <= 2 * TILE_CELLS && Math.abs(y - by) <= 2 * TILE_CELLS;
  };

  /** Runs of LONG or more wall cells in one row or column all facing floor on the
   *  same side, outside the boss block. */
  const LONG = 10;
  const longFaces = (layout: ReturnType<typeof assembleArea>): number => {
    const { cells } = layout.grid;
    const N = ASSEMBLED_CELLS;
    const nearBoss = bossNear(layout);
    let n = 0;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const alongX = dx === 0;
      for (let a = 0; a < N; a++) {
        let run = 0;
        for (let b = 0; b <= N; b++) {
          const [x, y] = alongX ? [b, a] : [a, b];
          const fx = x + dx, fy = y + dy;
          const facing = b < N && fx >= 0 && fy >= 0 && fx < N && fy < N && cells[y * N + x] === 0 &&
            cells[fy * N + fx] === 1 && !nearBoss(x, y);
          if (facing) { run++; continue; }
          if (run >= LONG) n++;
          run = 0;
        }
      }
    }
    return n;
  };

  /** Floor 4-components and wall 8-components: a breach or an opened pocket changes one. */
  const topology = (cells: Uint8Array, N: number): { floor: number; wall: number } => {
    const count = (value: number, nb: readonly (readonly [number, number])[]): number => {
      const seen = new Uint8Array(N * N);
      let n = 0;
      for (let s = 0; s < N * N; s++) {
        if (cells[s] !== value || seen[s]) continue;
        n++;
        seen[s] = 1;
        const stack = [s];
        while (stack.length) {
          const i = stack.pop()!, x = i % N, y = (i - x) / N;
          for (const [dx, dy] of nb) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
            const j = ny * N + nx;
            if (cells[j] === value && !seen[j]) { seen[j] = 1; stack.push(j); }
          }
        }
      }
      return n;
    };
    const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
    const N8 = [...N4, [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
    return { floor: count(1, N4), wall: count(0, N8) };
  };

  /** Cells a 3x3 body can stand on, flooded from the boss marker: the markers it can reach. */
  const reachableMarkers = (layout: ReturnType<typeof assembleArea>): number => {
    const { grid: { cells, originX, originY, cellSize }, objectiveAnchors } = layout;
    const N = ASSEMBLED_CELLS;
    const cell = (a: { x: number; y: number }) => ({
      x: Math.round((a.x - originX) / cellSize), y: Math.round((a.y - originY) / cellSize),
    });
    const fits = (x: number, y: number) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N || cells[ny * N + nx] !== 1) return false;
      }
      return true;
    };
    const seen = new Uint8Array(N * N);
    const near = (p: { x: number; y: number }) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (fits(p.x + dx, p.y + dy)) return (p.y + dy) * N + p.x + dx;
      return -1;
    };
    const s0 = near(cell(objectiveAnchors.find((a) => a.id === "boss")!));
    if (s0 < 0) return 0;
    const stack = [s0];
    seen[s0] = 1;
    while (stack.length) {
      const i = stack.pop()!, x = i % N, y = (i - x) / N;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy, j = ny * N + nx;
        if (nx >= 0 && ny >= 0 && nx < N && ny < N && !seen[j] && fits(nx, ny)) { seen[j] = 1; stack.push(j); }
      }
    }
    return objectiveAnchors.filter((a) => {
      const c = cell(a);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (seen[(c.y + dy) * N + c.x + dx]) return true;
      return false;
    }).length;
  };

  /** Floor cells in a sharp room corner, outside the boss block: wall along both
   *  edges for three cells, floor in the square. */
  const sharpCorners = (layout: ReturnType<typeof assembleArea>): number => {
    const { cells } = layout.grid;
    const N = ASSEMBLED_CELLS;
    const nearBoss = bossNear(layout);
    let n = 0;
    const floor = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && cells[y * N + x] === 1;
    for (let y = 1; y < N - 4; y++) for (let x = 1; x < N - 4; x++) {
      if (nearBoss(x, y)) continue;
      for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
        let ok = true;
        for (let k = 0; k < 3 && ok; k++) {
          ok = !floor(x - sx, y + sy * k) && !floor(x + sx * k, y - sy);
          for (let m = 0; m < 3 && ok; m++) ok = floor(x + sx * k, y + sy * m);
        }
        if (ok) n++;
      }
    }
    return n;
  };

  it("breaks the long straight walls the chunks stamp", () => {
    // Counted, not the longest: a face beside a pillar, a marker or a passage
    // three cells wide has no room for rock, so nearly every map keeps one.
    for (const [name, grammar] of WALLED) {
      let before = 0, after = 0;
      for (let seed = 0; seed < 30; seed++) {
        const a = assembleArea(seed, V, hard(grammar)), b = assembleArea(seed, V, grammar);
        if (a.usedFallback || b.usedFallback) continue;
        before += longFaces(a);
        after += longFaces(b);
      }
      expect(after, `${name}: ${before} before`).toBeLessThanOrEqual(before * 0.5);
    }
  }, 60_000);

  it("never seals off floor or opens a new way through a wall", () => {
    // Floor regions only: a closed corner may join a pillar to its wall. Loop
    // only, since the swamp's blobs land differently once its walls move.
    for (let seed = 0; seed < 30; seed++) {
      const a = assembleArea(seed, V, hard(LOOP_GRAMMAR)), b = assembleArea(seed, V, LOOP_GRAMMAR);
      if (a.usedFallback || b.usedFallback) continue;
      expect(topology(b.grid.cells, ASSEMBLED_CELLS).floor, `seed ${seed}`).toBe(topology(a.grid.cells, ASSEMBLED_CELLS).floor);
      expect(a.grid.cells.every((v, i) => v === 1 || b.grid.cells[i] === 0), `seed ${seed}: wall removed`).toBe(true);
    }
  }, 60_000);

  it("keeps every marker a body could reach within its reach", () => {
    for (const [name, grammar] of WALLED) {
      for (let seed = 0; seed < 30; seed++) {
        const a = assembleArea(seed, V, hard(grammar)), b = assembleArea(seed, V, grammar);
        if (a.usedFallback || b.usedFallback) continue;
        expect(reachableMarkers(b), `${name} seed ${seed}`).toBe(reachableMarkers(a));
      }
    }
  }, 60_000);

  it("rounds the rooms' corners", () => {
    let before = 0, after = 0;
    for (let seed = 0; seed < 20; seed++) {
      const a = assembleArea(seed, V, hard(LOOP_GRAMMAR)), b = assembleArea(seed, V, LOOP_GRAMMAR);
      if (a.usedFallback || b.usedFallback) continue;
      before += sharpCorners(a);
      after += sharpCorners(b);
    }
    // Corners left are the ones a body could not get round once rounded, or a
    // marker stands in.
    expect(after, `${before} before`).toBeLessThanOrEqual(before * 0.45);
  }, 60_000);
});

describe("assembleArea, fen pools", () => {
  const SEEDS = Array.from({ length: 20 }, (_, i) => i);
  const dry: Grammar = { ...SUNKEN_GRAMMAR, fenPools: undefined };

  it("floods part of the swamp's open-ground blobs on most seeds", () => {
    let wet = 0;
    for (const seed of SEEDS) {
      const { grid, usedFallback } = assembleArea(seed, V, SUNKEN_GRAMMAR);
      if (usedFallback) continue;
      let n = 0;
      for (const w of grid.water ?? []) n += w;
      if (n > 0) wet++;
    }
    expect(wet).toBeGreaterThanOrEqual(SEEDS.length * 0.7);
  }, 60_000);

  it("floods only wall cells into walkable water, never the boss block, a marker or a lone cell", () => {
    for (const seed of SEEDS) {
      const wet = assembleArea(seed, V, SUNKEN_GRAMMAR), base = assembleArea(seed, V, dry);
      expect(wet.spawnSockets).toEqual(base.spawnSockets);
      expect(wet.objectiveAnchors).toEqual(base.objectiveAnchors);
      expect(base.grid.water).toBeUndefined();
      const { cells, water, cols } = wet.grid;
      if (!water) {
        expect(wet.hash).toBe(base.hash);
        continue;
      }
      expect(wet.hash, `seed ${seed}`).not.toBe(base.hash);
      const boss = wet.objectiveAnchors.find((a) => a.id === "boss")!;
      const near = (i: number, p: { x: number; y: number }): boolean => {
        const cx = Math.floor((p.x - wet.grid.originX) / wet.grid.cellSize);
        const cy = Math.floor((p.y - wet.grid.originY) / wet.grid.cellSize);
        return Math.abs((i % cols) - cx) <= 1 && Math.abs(Math.floor(i / cols) - cy) <= 1;
      };
      for (let i = 0; i < water.length; i++) {
        if (!water[i]) {
          expect(cells[i], `seed ${seed} cell ${i}`).toBe(base.grid.cells[i]);
          continue;
        }
        expect(base.grid.cells[i], `seed ${seed} cell ${i} was wall`).toBe(0);
        expect(cells[i], `seed ${seed} cell ${i} walkable`).toBe(1);
        for (const m of [...wet.spawnSockets, ...wet.objectiveAnchors]) {
          expect(near(i, m), `seed ${seed} ${m.id} on water`).toBe(false);
        }
        // A pool cell has a pool neighbour: no single-cell puddles.
        const x = i % cols;
        const nb = (x > 0 && water[i - 1]) || (x < cols - 1 && water[i + 1]) || water[i - cols] || water[i + cols];
        expect(nb, `seed ${seed} lone cell ${i}`).toBeTruthy();
        // The boss block is 2 tiles (16 units) square around its arena.
        const wx = (x + 0.5) * wet.grid.cellSize + wet.grid.originX - 0.25;
        const wz = (Math.floor(i / cols) + 0.5) * wet.grid.cellSize + wet.grid.originY - 0.25;
        expect(Math.hypot(wx - boss.x, wz - boss.y), `seed ${seed} pool by the boss`).toBeGreaterThan(4);
      }
      // Every pool is waded into from dry floor.
      const seen = new Uint8Array(water.length);
      for (let s = 0; s < water.length; s++) {
        if (!water[s] || seen[s]) continue;
        const comp = [s];
        seen[s] = 1;
        let shore = false;
        for (let h = 0; h < comp.length; h++) {
          const i = comp[h]!;
          for (const j of [i - 1, i + 1, i - cols, i + cols]) {
            if (cells[j] === 1 && !water[j]) shore = true;
            if (water[j] && !seen[j]) { seen[j] = 1; comp.push(j); }
          }
        }
        expect(shore, `seed ${seed} pool at ${s}`).toBe(true);
      }
    }
  }, 60_000);

  it("keeps every other grammar dry and byte-identical", () => {
    for (const g of [LOOP_GRAMMAR, FIELD_GRAMMAR, STRAND_GRAMMAR]) {
      for (const seed of [1, 5, 9]) {
        const a = assembleArea(seed, V, g);
        expect(a.grid.water, `${g.id} ${seed}`).toBeUndefined();
        expect(a.hash).toBe(assembleArea(seed, V, { ...g, fenPools: undefined }).hash);
      }
    }
  }, 60_000);
});
