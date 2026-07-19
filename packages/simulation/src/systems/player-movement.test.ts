import { describe, it, expect } from "vitest";
import { fp, fpClamp } from "@pact/fixed-point";
import { Simulation } from "../loop";
import { registerPlayerMovement } from "./player-movement";
import { WORLD_MIN, WORLD_MAX } from "../movement";
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

  it("moveTo with out-of-bounds target clamps goal and deactivates on arrival", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    // place player near WORLD_MAX, issue target beyond WORLD_MAX
    const p = makePlayer(sim, WORLD_MAX - fp(2), 0, fp(10));
    sim.step([{ tick: 0, entity: p, type: "moveTo", data: { x: WORLD_MAX + fp(10), y: 0 } }]);
    // step several more ticks — player should reach WORLD_MAX and deactivate
    for (let i = 1; i <= 5; i++) sim.step();
    const pos = sim.world.get<Position>(p, "position")!;
    const mt = sim.world.get<MoveTarget>(p, "moveTarget")!;
    expect(pos.x).toBe(WORLD_MAX);
    expect(mt.active).toBe(0);
  });

  it("clamps position to arena bounds", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const p = makePlayer(sim, WORLD_MAX, 0, fp(10));
    // moveDir +x pushes past WORLD_MAX
    sim.step([{ tick: 0, entity: p, type: "moveDir", data: { dx: 1, dy: 0 } }]);
    const pos = sim.world.get<Position>(p, "position")!;
    expect(pos.x).toBe(WORLD_MAX);
  });
});
