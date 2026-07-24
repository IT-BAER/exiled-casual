import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import type { WalkableGrid } from "@exiled/mapgen";
import { gridCollision, slide } from "./collision";

// Build a WalkableGrid from an ASCII map. '.' = walkable, '#' = wall.
// cellSize 1 and origin 0 make cell (cx,cy) sit at world (cx,cy) for readability.
function makeGrid(rows: string[]): WalkableGrid {
  const h = rows.length;
  const w = rows[0]!.length;
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) cells[y * w + x] = rows[y]![x] === "." ? 1 : 0;
  }
  return { cols: w, rows: h, cellSize: 1, originX: 0, originY: 0, cells };
}

describe("gridCollision.isWalkable", () => {
  const g = makeGrid([
    ".....",
    ".....",
    "..#..",
    ".....",
    ".....",
  ]);
  const c = gridCollision(g);

  it("floor cell is walkable", () => {
    expect(c.isWalkable(fp(1), fp(1), 0)).toBe(true);
    expect(c.isWalkable(fp(4), fp(4), 0)).toBe(true);
  });

  it("wall cell is not walkable", () => {
    expect(c.isWalkable(fp(2), fp(2), 0)).toBe(false);
  });

  it("outside the grid is not walkable", () => {
    expect(c.isWalkable(fp(-1), fp(0), 0)).toBe(false);
    expect(c.isWalkable(fp(0), fp(10), 0)).toBe(false);
  });

  it("a body whose rim overlaps the wall is not walkable", () => {
    // Centre on the floor cell just left of the wall, but a radius-1 body reaches
    // into the wall cell to its right.
    expect(c.isWalkable(fp(1), fp(2), 0)).toBe(true);
    expect(c.isWalkable(fp(1), fp(2), fp(1))).toBe(false);
  });
});

describe("slide", () => {
  const wall = gridCollision(
    makeGrid([
      "..#..",
      "..#..",
      "..#..",
      "..#..",
      "..#..",
    ]),
  );

  it("straight into a wall is fully blocked", () => {
    const r = slide(wall, fp(1), fp(2), fp(1), 0, 0);
    expect(r.x).toBe(fp(1));
    expect(r.y).toBe(fp(2));
  });

  it("slides along the wall: blocked axis cancels, free axis proceeds", () => {
    const r = slide(wall, fp(1), fp(2), fp(1), fp(1), 0);
    expect(r.x).toBe(fp(1)); // into the wall — cancelled
    expect(r.y).toBe(fp(3)); // parallel to it — allowed
  });

  it("moves freely when nothing blocks", () => {
    const r = slide(wall, fp(0), fp(0), fp(1), fp(1), 0);
    expect(r.x).toBe(fp(1));
    expect(r.y).toBe(fp(1));
  });

  it("a door (gap in the wall) is passable", () => {
    const door = gridCollision(
      makeGrid([
        "..#..",
        "..#..",
        ".....",
        "..#..",
        "..#..",
      ]),
    );
    const r = slide(door, fp(1), fp(2), fp(2), 0, 0);
    expect(r.x).toBe(fp(3)); // walked straight through the gap
  });
});
