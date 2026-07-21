import { describe, it, expect } from "vitest";
import { fp, fpClamp, fpDist2 } from "@pact/fixed-point";
import { Simulation } from "../loop";
import { registerPlayerMovement, CASTING_MOVE_PCT } from "./player-movement";
import { WORLD_MIN, WORLD_MAX, ARENA_RADIUS } from "../movement";
import { gridCollision } from "../collision";
import { makeGrid } from "../test-grid";
import type { Position, PlayerC, MoveTarget, MoveDir, Faction, CastingC } from "../components";

function makePlayer(sim: Simulation, x = 0, y = 0, moveSpeed = fp(3)) {
  const e = sim.world.create();
  sim.world.set<Position>(e, "position", { x, y });
  sim.world.set<PlayerC>(e, "player", { moveSpeed, bodyRadius: fp(0.5) });
  sim.world.set<Faction>(e, "faction", { team: 0 });
  return e;
}

describe("registerPlayerMovement", () => {
  it("moveTo command sets moveTarget and player moves toward it", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const p = makePlayer(sim, 0, 0, fp(3));
    sim.step([{ tick: 0, entity: p, type: "moveTo", data: { x: fp(10), y: 0 } }]);
    const pos = sim.world.get<Position>(p, "position")!;
    // player should have moved fp(3) in x direction
    expect(pos.x).toBe(fp(3));
    expect(pos.y).toBe(0);
    const mt = sim.world.get<MoveTarget>(p, "moveTarget")!;
    expect(mt.active).toBe(1);
  });

  it("snaps to target and deactivates moveTarget on arrival", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const speed = fp(3);
    const p = makePlayer(sim, 0, 0, speed);
    // set target to exactly fp(2) away — less than speed, should snap in one step
    sim.step([{ tick: 0, entity: p, type: "moveTo", data: { x: fp(2), y: 0 } }]);
    const pos = sim.world.get<Position>(p, "position")!;
    expect(pos.x).toBe(fp(2));
    expect(pos.y).toBe(0);
    const mt = sim.world.get<MoveTarget>(p, "moveTarget")!;
    expect(mt.active).toBe(0);
  });

  it("moveDir command moves one step per axis (cardinal)", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const speed = fp(3);
    const p = makePlayer(sim, 0, 0, speed);
    sim.step([{ tick: 0, entity: p, type: "moveDir", data: { dx: 1, dy: 0 } }]);
    const pos = sim.world.get<Position>(p, "position")!;
    expect(pos.x).toBe(speed); // 1 * speed
    expect(pos.y).toBe(0);
  });

  it("diagonal moveDir scales each axis by trunc(speed*707/1000)", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const speed = fp(3); // 3000
    const p = makePlayer(sim, 0, 0, speed);
    sim.step([{ tick: 0, entity: p, type: "moveDir", data: { dx: 1, dy: 1 } }]);
    const pos = sim.world.get<Position>(p, "position")!;
    const diagStep = Math.trunc(speed * 707 / 1000); // trunc(3000*707/1000) = trunc(2121) = 2121
    expect(pos.x).toBe(diagStep);
    expect(pos.y).toBe(diagStep);
  });

  it("stop command halts movement", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const p = makePlayer(sim, 0, 0, fp(3));
    // first give a moveTo, then stop
    sim.step([{ tick: 0, entity: p, type: "moveTo", data: { x: fp(50), y: 0 } }]);
    sim.step([{ tick: 1, entity: p, type: "stop" }]);
    const mt = sim.world.get<MoveTarget>(p, "moveTarget")!;
    const md = sim.world.get<MoveDir>(p, "moveDir")!;
    expect(mt.active).toBe(0);
    expect(md.dx).toBe(0);
    expect(md.dy).toBe(0);
    // position should not advance further after stop
    const posBefore = sim.world.get<Position>(p, "position")!.x;
    sim.step();
    const posAfter = sim.world.get<Position>(p, "position")!.x;
    expect(posAfter).toBe(posBefore);
  });

  it("moveTo with an out-of-bounds target clamps the goal to WORLD_MAX", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    // target beyond WORLD_MAX; moveTo command clamps it to WORLD_MAX
    const p = makePlayer(sim, 0, 0, fp(10));
    sim.step([{ tick: 0, entity: p, type: "moveTo", data: { x: WORLD_MAX + fp(10), y: 0 } }]);
    const mt0 = sim.world.get<MoveTarget>(p, "moveTarget")!;
    expect(mt0.x).toBe(WORLD_MAX); // goal clamped to world bounds
    // position never leaves the world extent either
    for (let i = 1; i <= 5; i++) sim.step();
    const pos = sim.world.get<Position>(p, "position")!;
    expect(pos.x).toBeLessThanOrEqual(WORLD_MAX);
  });

  it("deactivates the move target on arrival at an in-arena goal", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const p = makePlayer(sim, 0, 0, fp(10));
    sim.step([{ tick: 0, entity: p, type: "moveTo", data: { x: fp(5), y: 0 } }]);
    for (let i = 1; i <= 20; i++) sim.step();
    const pos = sim.world.get<Position>(p, "position")!;
    const mt = sim.world.get<MoveTarget>(p, "moveTarget")!;
    expect(pos.x).toBe(fp(5));
    expect(mt.active).toBe(0);
  });

  it("without collision, movement is bounded by the world extent — not the old arena", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const p = makePlayer(sim, 0, 0, fp(3));
    // target well beyond the retired arena radius
    sim.step([{ tick: 0, entity: p, type: "moveTo", data: { x: fp(200), y: fp(200) } }]);
    for (let i = 1; i <= 100; i++) sim.step();
    const pos = sim.world.get<Position>(p, "position")!;
    expect(pos.x).toBeLessThanOrEqual(WORLD_MAX);
    expect(pos.y).toBeLessThanOrEqual(WORLD_MAX);
    // clampToArena is gone: the player travels well past the old r=14 wall.
    expect(fpDist2(0, 0, pos.x, pos.y)).toBeGreaterThan(ARENA_RADIUS * ARENA_RADIUS);
  });

  it("moves at CASTING_MOVE_PCT of speed while casting (cardinal)", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const speed = fp(3);
    const p = makePlayer(sim, 0, 0, speed);
    // first sim.step runs at tick 0; casting is active while tick < untilTick
    sim.world.set<CastingC>(p, "casting", { untilTick: 10 });
    sim.step([{ tick: 0, entity: p, type: "moveDir", data: { dx: 1, dy: 0 } }]);
    const pos = sim.world.get<Position>(p, "position")!;
    expect(pos.x).toBe(Math.trunc(speed * CASTING_MOVE_PCT / 100));
  });

  it("moves at full speed once the casting recovery has elapsed", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const speed = fp(3);
    const p = makePlayer(sim, 0, 0, speed);
    // untilTick 0 means recovery already over at tick 0 (tick < untilTick is false)
    sim.world.set<CastingC>(p, "casting", { untilTick: 0 });
    sim.step([{ tick: 0, entity: p, type: "moveDir", data: { dx: 1, dy: 0 } }]);
    expect(sim.world.get<Position>(p, "position")!.x).toBe(speed);
  });

  it("respects collision: cannot cross a wall, slides along it", () => {
    // Wall column at cx=3 (world x=3); player just to its left.
    const collision = gridCollision(
      makeGrid([
        "...#...",
        "...#...",
        "...#...",
        "...#...",
        "...#...",
      ]),
    );
    const sim = new Simulation();
    registerPlayerMovement(sim, { active: collision });
    // Point body so the test reasons in whole cells.
    const p = sim.world.create();
    sim.world.set<Position>(p, "position", { x: fp(2), y: fp(2) });
    sim.world.set<PlayerC>(p, "player", { moveSpeed: fp(1), bodyRadius: 0 });
    sim.world.set<Faction>(p, "faction", { team: 0 });

    // Straight into the wall (+x): fully blocked.
    sim.step([{ tick: 0, entity: p, type: "moveDir", data: { dx: 1, dy: 0 } }]);
    expect(sim.world.get<Position>(p, "position")!.x).toBe(fp(2));

    // Diagonal into the wall (+x,+y): x cancels, slides along it in +y.
    sim.step([{ tick: 1, entity: p, type: "moveDir", data: { dx: 1, dy: 1 } }]);
    const pos = sim.world.get<Position>(p, "position")!;
    expect(pos.x).toBe(fp(2)); // still cannot cross
    expect(pos.y).toBeGreaterThan(fp(2)); // slid parallel to the wall
  });
});
