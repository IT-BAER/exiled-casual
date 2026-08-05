import { describe, it, expect } from "vitest";
import { fp, fpClamp, fpDist2, type Fixed } from "@exiled/fixed-point";
import { Simulation } from "../loop";
import { registerPlayerMovement, CASTING_MOVE_PCT } from "./player-movement";
import { WORLD_MIN, WORLD_MAX, ARENA_RADIUS } from "../movement";
import { gridCollision } from "../collision";
import { makeGrid } from "../test-grid";
import type { Position, PlayerC, MoveTarget, MoveDir, Faction, CastingC, SkillHoldC } from "../components";

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

  // Movement steers; it does not switch. A key change that snapped the velocity
  // read as the character being teleported onto a new rail.
  it("turns through the corner instead of switching to the new direction", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const speed = fp(3);
    const p = makePlayer(sim, 0, 0, speed);

    sim.step([{ tick: 0, entity: p, type: "moveDir", data: { dx: 1, dy: 0 } }]);
    for (let t = 1; t < 4; t++) sim.step();
    const before = { ...sim.world.get<Position>(p, "position")! };

    // Hard 90 degrees: +x to +y.
    sim.step([{ tick: 4, entity: p, type: "moveDir", data: { dx: 0, dy: 1 } }]);
    const after = sim.world.get<Position>(p, "position")!;
    const stepX = after.x - before.x;
    const stepY = after.y - before.y;

    // Mid-turn: still carrying the old direction, already taking the new one.
    expect(stepX).toBeGreaterThan(0);
    expect(stepY).toBeGreaterThan(0);
    // ...and paying for it in speed, the way a runner cutting a corner does.
    // A lean, not a brake: the floor is 88% now, so a right angle costs a few
    // percent and a full reversal an eighth. It used to cost a third, and a
    // mouse reversing along one line looked like the game had stalled.
    const cutSpeed = Math.sqrt(stepX * stepX + stepY * stepY);
    expect(cutSpeed).toBeLessThan(speed * 0.99);
    expect(cutSpeed).toBeGreaterThan(speed * 0.85);
    // The turn is a corner, not a lap: a right angle inside a third of a second.
    for (let t = 5; t < 14; t++) sim.step();
    const settling = { ...sim.world.get<Position>(p, "position")! };
    sim.step();
    const settled = sim.world.get<Position>(p, "position")!;
    expect(settled.x - settling.x).toBe(0);
    expect(settled.y - settling.y).toBe(speed);
  });

  it("reverses out of a dead-on flip, which has no side to turn to", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const speed = fp(3);
    const p = makePlayer(sim, 0, 0, speed);
    sim.step([{ tick: 0, entity: p, type: "moveDir", data: { dx: 1, dy: 0 } }]);
    sim.step([{ tick: 1, entity: p, type: "moveDir", data: { dx: -1, dy: 0 } }]);
    for (let t = 2; t < 16; t++) sim.step();
    const before = { ...sim.world.get<Position>(p, "position")! };
    sim.step();
    const after = sim.world.get<Position>(p, "position")!;
    // Whichever way it went around, it must arrive: a heading that steps
    // straight at its own opposite shrinks to nothing and never turns.
    expect(after.x - before.x).toBe(-speed);
    expect(after.y - before.y).toBe(0);
  });

  it("starts on the pressed direction, so the first step is never a curve", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const speed = fp(3);
    const p = makePlayer(sim, 0, 0, speed);
    sim.step([{ tick: 0, entity: p, type: "moveDir", data: { dx: 0, dy: 1 } }]);
    const pos = sim.world.get<Position>(p, "position")!;
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(speed);
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

  it("keeps CASTING_MOVE_PCT while a skill button is held, across the cooldown gap", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const speed = fp(3);
    const p = makePlayer(sim, 0, 0, speed);
    // No active cast (recovery over), but the hold window is live: the client
    // is still re-issuing useSkill, so the walk must not burst back to a run.
    sim.world.set<CastingC>(p, "casting", { untilTick: 0 });
    sim.world.set<SkillHoldC>(p, "skillHold", { untilTick: 10 });
    sim.step([{ tick: 0, entity: p, type: "moveDir", data: { dx: 1, dy: 0 } }]);
    expect(sim.world.get<Position>(p, "position")!.x)
      .toBe(Math.trunc(speed * CASTING_MOVE_PCT / 100));
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

/**
 * The mouse and the keys used to disagree about whether changing direction costs
 * anything. WASD swings the heading a bounded amount per tick; click-to-move wrote
 * the heading straight off the step, so a click behind the character spun him on
 * the spot. The renderer takes the facing off how far the mesh actually MOVED, so
 * only steering the movement itself could fix it.
 */
describe("click-to-move turns like the keys do", () => {
  /** A player with the heading component the real sim always gives it. */
  function walker(sim: Simulation, moveSpeed = fp(3)) {
    const e = makePlayer(sim, 0, 0, moveSpeed);
    sim.world.set<MoveDir>(e, "moveDir", { dx: 0, dy: 0, hx: 0, hy: 0 });
    return e;
  }

  it("a straight walk from a standstill is untouched", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const p = walker(sim);
    sim.step([{ tick: 0, entity: p, type: "moveTo", data: { x: fp(10), y: 0 } }]);
    expect(sim.world.get<Position>(p, "position")).toEqual({ x: fp(3), y: 0 });
  });

  it("a click straight behind him comes about at the constant turn rate", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const p = walker(sim);
    // Running east.
    sim.step([{ tick: 0, entity: p, type: "moveTo", data: { x: fp(30), y: 0 } }]);
    sim.step([]);
    const headingBefore = sim.world.get<MoveDir>(p, "moveDir")!;
    expect(headingBefore.hx).toBeGreaterThan(0);

    // Now click well behind him: the rotation is 35 degrees a tick regardless
    // of the ask (the old chord-step stalled near 180 and read as a slow
    // U-turn), so six ticks later he is running dead west.
    const at = sim.world.get<Position>(p, "position")!;
    sim.step([{ tick: 2, entity: p, type: "moveTo", data: { x: at.x - fp(20), y: 0 } }]);
    for (let i = 0; i < 6; i++) sim.step([]);
    const after = sim.world.get<MoveDir>(p, "moveDir")!;
    expect(after.hx).toBeLessThan(-fp(0.8)); // came about, within one turn-step of west
    const xNow = sim.world.get<Position>(p, "position")!.x;
    sim.step([]);
    expect(sim.world.get<Position>(p, "position")!.x).toBeLessThan(xNow); // and is walking back
  });

  it("but he does come about, and gets there", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const p = walker(sim);
    sim.step([{ tick: 0, entity: p, type: "moveTo", data: { x: fp(30), y: 0 } }]);
    for (let i = 0; i < 5; i++) sim.step([]);
    const at = sim.world.get<Position>(p, "position")!;
    const goal = { x: at.x - fp(8), y: fp(0) };
    sim.step([{ tick: 6, entity: p, type: "moveTo", data: goal }]);
    for (let i = 0; i < 200; i++) sim.step([]);
    expect(sim.world.get<MoveTarget>(p, "moveTarget")!.active).toBe(0);
    const end = sim.world.get<Position>(p, "position")!;
    expect(fpDist2(end.x, end.y, goal.x, goal.y)).toBeLessThan(fp(0.2) * fp(0.2));
  });

  /**
   * Inside a unit there is nothing worth banking into, and the tightest circle the
   * turn can make is about 0.8 units across — a target inside that could be
   * orbited rather than reached.
   */
  it("a nudge of half a unit is walked straight at, not arced into", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const p = walker(sim, fp(3));
    sim.step([{ tick: 0, entity: p, type: "moveTo", data: { x: fp(10), y: 0 } }]);
    for (let i = 0; i < 3; i++) sim.step([]);
    const at = sim.world.get<Position>(p, "position")!;
    sim.step([{ tick: 4, entity: p, type: "moveTo", data: { x: at.x - fp(0.5), y: 0 } }]);
    // Snapped onto it in one step, exactly as it did before any of this.
    expect(sim.world.get<Position>(p, "position")).toEqual({ x: at.x - fp(0.5), y: 0 });
    expect(sim.world.get<MoveTarget>(p, "moveTarget")!.active).toBe(0);
  });

  /**
   * A held mouse re-issues the target every tick, and inside TURN_FOR_DISTANCE the
   * walk is aimed rather than steered, so the heading used to be written straight
   * off the step: the cursor could spin the body as fast as it could be circled.
   * The step still aims (a nudge inside the turning circle has to be reachable in
   * a line); the heading is what the renderer faces the player by.
   */
  it("a held mouse circling close to him does not spin him", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    // A real player's per-tick step: 3 units a second at 30 Hz.
    const p = walker(sim, Math.trunc(fp(3) / 30));
    let prev: { hx: number; hy: number } | null = null;
    let worstDeg = 0;
    for (let t = 0; t < 24; t++) {
      const at = sim.world.get<Position>(p, "position")!;
      const ang = (t * Math.PI) / 2; // the cursor jumps a quarter turn each tick
      sim.step([{
        tick: t, entity: p, type: "moveTo",
        data: { x: at.x + Math.trunc(fp(0.6) * Math.cos(ang)), y: at.y + Math.trunc(fp(0.6) * Math.sin(ang)) },
      }]);
      const h = sim.world.get<MoveDir>(p, "moveDir")!;
      if (h.hx === 0 && h.hy === 0) continue;
      if (prev) {
        const cross = prev.hx * h.hy - prev.hy * h.hx;
        const dot = prev.hx * h.hx + prev.hy * h.hy;
        worstDeg = Math.max(worstDeg, Math.abs((Math.atan2(cross, dot) * 180) / Math.PI));
      }
      prev = { hx: h.hx, hy: h.hy };
    }
    // TURN_CHORD is about 35 degrees a tick; the slack is fixed-point rounding.
    expect(worstDeg).toBeLessThan(44);
  });
});

/**
 * Monsters route (chaseStep reads the nav field once the straight line is
 * blocked); the player only ever slid. A click on the far side of a wall left him
 * pressed against it, because a slide cancels the blocked axis and the other axis
 * was zero.
 */
describe("click-to-move routes around what it cannot walk through", () => {
  /** Wall across the middle with one gap, so arriving means going around. */
  const WALLED = [
    ".........",
    ".........",
    "####.####",
    ".........",
    ".........",
  ];

  function walledSim() {
    const sim = new Simulation();
    registerPlayerMovement(sim, { active: gridCollision(makeGrid(WALLED)) });
    const p = sim.world.create();
    sim.world.set<Position>(p, "position", { x: fp(1), y: fp(1) });
    sim.world.set<PlayerC>(p, "player", { moveSpeed: Math.trunc(fp(3) / 30), bodyRadius: fp(0.2) });
    sim.world.set<Faction>(p, "faction", { team: 0 });
    sim.world.set<MoveDir>(p, "moveDir", { dx: 0, dy: 0, hx: 0, hy: 0 });
    return { sim, p };
  }

  it("walks through the gap to reach a target behind the wall", () => {
    const { sim, p } = walledSim();
    const goal = { x: fp(1), y: fp(4) };
    sim.step([{ tick: 0, entity: p, type: "moveTo", data: goal }]);
    // Reversals as well as arrival: the monsters reached their target too, while
    // juddering the whole way, and the judder is the thing actually seen.
    let prev: { dx: number; dy: number } | null = null;
    let reversals = 0;
    for (let t = 1; t < 400; t++) {
      const was = sim.world.get<Position>(p, "position")!;
      sim.step([]);
      const now = sim.world.get<Position>(p, "position")!;
      const d = { dx: now.x - was.x, dy: now.y - was.y };
      if (d.dx === 0 && d.dy === 0) continue;
      if (prev && prev.dx * d.dx + prev.dy * d.dy < 0) reversals++;
      prev = d;
    }
    const end = sim.world.get<Position>(p, "position")!;
    expect(fpDist2(end.x, end.y, goal.x, goal.y)).toBeLessThan(fp(0.5) * fp(0.5));
    expect(reversals).toBe(0);
  });

  it("does not route around a wall when the target is more than five meters away", () => {
    const sim = new Simulation();
    const farWalled = [
      ".........",
      ".........",
      ".........",
      ".........",
      "####.####",
      ".........",
      ".........",
      ".........",
      ".........",
      ".........",
    ];
    registerPlayerMovement(sim, { active: gridCollision(makeGrid(farWalled)) });
    const p = sim.world.create();
    sim.world.set<Position>(p, "position", { x: fp(1), y: fp(1) });
    sim.world.set<PlayerC>(p, "player", { moveSpeed: Math.trunc(fp(3) / 30), bodyRadius: fp(0.2) });
    sim.world.set<Faction>(p, "faction", { team: 0 });
    sim.world.set<MoveDir>(p, "moveDir", { dx: 0, dy: 0, hx: 0, hy: 0 });
    const goal = { x: fp(1), y: fp(8) };

    sim.step([{ tick: 0, entity: p, type: "moveTo", data: goal }]);
    for (let t = 1; t < 400; t++) sim.step([]);

    const end = sim.world.get<Position>(p, "position")!;
    expect(end.y).toBeLessThan(fp(4));
    expect(fpDist2(end.x, end.y, goal.x, goal.y)).toBeGreaterThan(fp(2) * fp(2));
  });

  it("holds the straight line until the wall is in front of him, then goes around", () => {
    const sim = new Simulation();
    const rows = [".........", ".........", ".........", ".........",
      "####.####", ".........", ".........", "........."];
    registerPlayerMovement(sim, { active: gridCollision(makeGrid(rows)) });
    const p = sim.world.create();
    sim.world.set<Position>(p, "position", { x: fp(1), y: fp(1) });
    sim.world.set<PlayerC>(p, "player", { moveSpeed: Math.trunc(fp(3) / 30), bodyRadius: fp(0.2) });
    sim.world.set<Faction>(p, "faction", { team: 0 });
    sim.world.set<MoveDir>(p, "moveDir", { dx: 0, dy: 0, hx: 0, hy: 0 });
    // Inside MAX_AUTO_ROUTE_DISTANCE, so this is a trip the router will take; the
    // question here is only when it starts taking it.
    const goal = { x: fp(1), y: fp(5.5) };

    sim.step([{ tick: 0, entity: p, type: "moveTo", data: goal }]);
    let leftTheLineAt: Fixed | null = null;
    for (let t = 1; t < 400; t++) {
      sim.step([]);
      const now = sim.world.get<Position>(p, "position")!;
      if (leftTheLineAt === null && Math.abs(now.x - fp(1)) > fp(0.25)) leftTheLineAt = now.y;
    }

    // The wall's face is at y=4, three metres up the line. Routed from the first
    // tick he would peel off at y=1; he holds the line until it is a stride ahead.
    expect(leftTheLineAt).not.toBeNull();
    expect(leftTheLineAt!).toBeGreaterThan(fp(1.5));
    const end = sim.world.get<Position>(p, "position")!;
    expect(fpDist2(end.x, end.y, goal.x, goal.y)).toBeLessThan(fp(0.5) * fp(0.5));
  });

  it("still walks a clear line straight, with no detour", () => {
    const { sim, p } = walledSim();
    // Same side of the wall, nothing in between.
    sim.step([{ tick: 0, entity: p, type: "moveTo", data: { x: fp(6), y: fp(1) } }]);
    for (let t = 1; t < 60; t++) sim.step([]);
    const end = sim.world.get<Position>(p, "position")!;
    expect(end.y).toBe(fp(1)); // never left the line
    expect(end.x).toBeGreaterThan(fp(5));
  });
});
