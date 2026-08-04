import { describe, it, expect } from "vitest";
import { fp, fpStepToward, type Fixed } from "@exiled/fixed-point";
import { gridCollision, slide, chaseStep, type Collision } from "./collision";
import { makeGrid } from "./test-grid";

/** Walk a body toward a fixed target, returning where it ended up. */
function walk(
  collision: Collision,
  step: (c: Collision, x: Fixed, y: Fixed) => { x: Fixed; y: Fixed },
  from: { x: Fixed; y: Fixed },
  ticks: number,
): { x: Fixed; y: Fixed; trail: string[] } {
  let { x, y } = from;
  const trail: string[] = [];
  for (let t = 0; t < ticks; t++) {
    const next = step(collision, x, y);
    x = next.x;
    y = next.y;
    trail.push(`${x},${y}`);
  }
  return { x, y, trail };
}

const SPEED = fp(0.13); // 3.9 units/s at 30 Hz — a retuned swarm monster

describe("chaseStep routes around a wall", () => {
  // A wall column at x=4 spanning y=1..4, open along the bottom row.
  const collision = gridCollision(
    makeGrid([
      ".........",
      "....#....",
      "....#....",
      "....#....",
      "....#....",
      ".........",
    ]),
  );
  const target = { x: fp(7), y: fp(3) };
  const start = { x: fp(1), y: fp(3) };

  it("the greedy slide it replaces gets stuck against the wall", () => {
    const r = walk(
      collision,
      (c, x, y) => {
        const s = fpStepToward(x, y, target.x, target.y, SPEED);
        return slide(c, x, y, s.dx, s.dy, 0);
      },
      start,
      400,
    );
    // Never crosses the wall column: greedy motion has no way past x=4.
    expect(r.x).toBeLessThan(fp(4));
  });

  it("chaseStep reaches the target", () => {
    const r = walk(
      collision,
      (c, x, y) => chaseStep(c, x, y, target.x, target.y, SPEED, 0),
      start,
      400,
    );
    const dx = r.x - target.x;
    const dy = r.y - target.y;
    expect(Math.sqrt(dx * dx + dy * dy)).toBeLessThan(fp(1));
  });
});

describe("chaseStep centres a wide body in a doorway", () => {
  // A three-cell door (y = 2..4) through a wall at x=4. A radius-1 body only
  // fits at y=3 exactly: its rim reaches ±1, so approaching at y=2 grinds.
  const collision = gridCollision(
    makeGrid([
      ".........",
      "....#....",
      ".........",
      ".........",
      ".........",
      "....#....",
      ".........",
    ]),
  );
  const target = { x: fp(7), y: fp(2) };

  it("a radius-1 body offset from the door centre still gets through", () => {
    const r = walk(
      collision,
      (c, x, y) => chaseStep(c, x, y, target.x, target.y, SPEED, fp(1)),
      { x: fp(1), y: fp(2) },
      400,
    );
    expect(r.x).toBeGreaterThan(fp(4));
  });

  it("a body too wide for any gap does not move through the wall", () => {
    // Wall the full height instead: the top and bottom rows are open, but a
    // radius-2 body standing in either has its rim off the grid, so no route
    // exists at all and the field must not invent one.
    const sealed = gridCollision(
      makeGrid([
        ".........",
        "....#....",
        "....#....",
        "....#....",
        "....#....",
        "....#....",
        ".........",
      ]),
    );
    const r = walk(
      sealed,
      (c, x, y) => chaseStep(c, x, y, fp(7), fp(3), SPEED, fp(2)),
      { x: fp(2), y: fp(3) },
      200,
    );
    expect(r.x).toBeLessThan(fp(4));
  });
});

describe("chaseStep leaves open ground alone", () => {
  const collision = gridCollision(
    makeGrid([
      ".....",
      ".....",
      ".....",
      ".....",
      ".....",
    ]),
  );

  it("is byte-identical to the slide it replaces when nothing blocks", () => {
    const from = { x: fp(1), y: fp(1) };
    const to = { x: fp(3.5), y: fp(2.25) };
    const s = fpStepToward(from.x, from.y, to.x, to.y, SPEED);
    expect(chaseStep(collision, from.x, from.y, to.x, to.y, SPEED, 0)).toEqual(
      slide(collision, from.x, from.y, s.dx, s.dy, 0),
    );
  });

  it("falls back to a plain step with no collision at all", () => {
    const r = chaseStep(undefined, fp(0), fp(0), fp(10), fp(0), SPEED, 0);
    expect(r.x).toBe(SPEED);
    expect(r.y).toBe(0);
  });
});

describe("nav field is a pure function of target cell and body radius", () => {
  const collision = gridCollision(
    makeGrid([
      ".........",
      "....#....",
      "....#....",
      "....#....",
      "....#....",
      ".........",
    ]),
  );

  it("two identical chases produce identical position sequences", () => {
    const target = { x: fp(7), y: fp(3) };
    const run = () =>
      walk(
        collision,
        (c, x, y) => chaseStep(c, x, y, target.x, target.y, SPEED, 0),
        { x: fp(1), y: fp(3) },
        200,
      ).trail;
    expect(run()).toEqual(run());
  });

  it("a fresh collision object reproduces the first one's chase exactly", () => {
    const rows = [".........", "....#....", "....#....", "....#....", "....#....", "........."];
    const target = { x: fp(7), y: fp(3) };
    const run = (c: Collision) =>
      walk(c, (cc, x, y) => chaseStep(cc, x, y, target.x, target.y, SPEED, 0), { x: fp(1), y: fp(3) }, 200)
        .trail;
    expect(run(gridCollision(makeGrid(rows)))).toEqual(run(gridCollision(makeGrid(rows))));
  });

  it("moving the target to a new cell re-routes", () => {
    // Pressed against the wall, so the two ways around it diverge: a target past
    // the top of the wall must send the body north, one past the bottom south.
    // The waypoint is the far end of the straight leg, not the next cell: the
    // field's own chain is a four-connected staircase, and a body aimed one cell
    // ahead walks it as one. So this asks which WAY it sends the body.
    const north = collision.nav!.waypoint(fp(3), fp(3), fp(7), fp(0), 0);
    const south = collision.nav!.waypoint(fp(3), fp(3), fp(7), fp(5), 0);
    expect(north!.y).toBeLessThan(fp(3));
    expect(south!.y).toBeGreaterThan(fp(3));
  });

  it("no waypoint when the body already stands on the target cell", () => {
    expect(collision.nav!.waypoint(fp(7), fp(3), fp(7), fp(3), 0)).toBeNull();
  });
});
