import { describe, it, expect } from "vitest";
import { fp, fpClamp, fpDist2 } from "@pact/fixed-point";
import { Simulation } from "../loop";
import { registerPlayerMovement } from "./player-movement";
import { WORLD_MIN, WORLD_MAX, ARENA_RADIUS } from "../movement";
import type { Position, PlayerC, MoveTarget, MoveDir, Faction } from "../components";

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

  it("moveTo with out-of-bounds target clamps goal to WORLD_MAX and player stays inside arena", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    // target beyond WORLD_MAX; moveTo command clamps it to WORLD_MAX
    const p = makePlayer(sim, 0, 0, fp(10));
    sim.step([{ tick: 0, entity: p, type: "moveTo", data: { x: WORLD_MAX + fp(10), y: 0 } }]);
    const mt0 = sim.world.get<MoveTarget>(p, "moveTarget")!;
    expect(mt0.x).toBe(WORLD_MAX); // goal clamped to world bounds
    // after several ticks player presses against arena wall — position stays within arena
    for (let i = 1; i <= 5; i++) sim.step();
    const pos = sim.world.get<Position>(p, "position")!;
    expect(pos.x).toBeLessThanOrEqual(ARENA_RADIUS);
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

  it("moveTo far outside arena: player stays within ARENA_RADIUS after many ticks", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const p = makePlayer(sim, 0, 0, fp(3));
    // target well beyond arena
    sim.step([{ tick: 0, entity: p, type: "moveTo", data: { x: fp(200), y: fp(200) } }]);
    for (let i = 1; i <= 60; i++) sim.step();
    const pos = sim.world.get<Position>(p, "position")!;
    const d2 = fpDist2(0, 0, pos.x, pos.y);
    expect(d2).toBeLessThanOrEqual(ARENA_RADIUS * ARENA_RADIUS);
  });

  it("clamps position to arena bounds", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    // player starts at arena edge; moveDir +x tries to push further out
    const p = makePlayer(sim, ARENA_RADIUS, 0, fp(10));
    sim.step([{ tick: 0, entity: p, type: "moveDir", data: { dx: 1, dy: 0 } }]);
    const pos = sim.world.get<Position>(p, "position")!;
    // the body stays fully inside the wall: limit is ARENA_RADIUS - bodyRadius
    expect(pos.x).toBeLessThanOrEqual(ARENA_RADIUS - fp(0.5));
  });
});
