import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { Simulation } from "../loop";
import { registerDeath } from "./death";
import { registerRevive } from "./revive";
import type { Command } from "../loop";
import type { SessionC, Position, Health, Mana } from "../components";

const DIED_AT = { x: fp(20), y: fp(14) };
const CHECKPOINT = { x: fp(3), y: fp(3) };

function fixture(area: "hideout" | "map", portalsLeft: number) {
  const sim = new Simulation();
  registerDeath(sim);
  registerRevive(sim);
  const { world } = sim;

  const p = world.create();
  world.set(p, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
  world.set<Health>(p, "health", { life: 0, maxLife: fp(100) });
  world.set<Mana>(p, "mana", { mana: 0, maxMana: fp(60), regen: 0 });
  world.set<Position>(p, "position", { ...DIED_AT });

  const sessionE = world.create();
  world.set<SessionC>(sessionE, "session", {
    area, atlasSeed: 0, areaTier: 0, activeNodeId: "", completedNodes: [],
    mapSeed: 0, waystoneSeed: 0, portalsLeft, mapOpen: 1, pendingArea: "",
    checkpointX: CHECKPOINT.x, checkpointY: CHECKPOINT.y,
  });

  const answer = (where: "checkpoint" | "hideout"): Command[] => [{
    tick: sim.tick, entity: p, type: "revive",
    data: { checkpoint: where === "checkpoint" ? 1 : 0 },
  }];

  return { sim, world, p, sessionE, answer };
}

const session = (f: ReturnType<typeof fixture>): SessionC =>
  f.world.get<SessionC>(f.sessionE, "session")!;

describe("registerRevive", () => {
  it("does nothing until he answers — the screen can stay up all night", () => {
    const f = fixture("map", 6);
    f.sim.step();                       // death raises the screen
    for (let i = 0; i < 300; i++) f.sim.step([]);
    expect(session(f).dead).toBe(1);
    expect(session(f).portalsLeft).toBe(6);
    expect(f.world.get<Health>(f.p, "health")!.life).toBe(0);
  });

  it("checkpoint: full vitals, back at the entrance, one portal poorer", () => {
    const f = fixture("map", 6);
    f.sim.step();
    f.sim.step(f.answer("checkpoint"));
    const s = session(f);
    expect(s.dead).toBe(0);
    expect(s.portalsLeft).toBe(5);
    expect(s.mapOpen).toBe(1);
    expect(s.pendingArea).toBe("");     // stays in the map
    expect(f.world.get<Position>(f.p, "position")).toEqual(CHECKPOINT);
    expect(f.world.get<Health>(f.p, "health")!.life).toBe(fp(100));
    expect(f.world.get<Mana>(f.p, "mana")!.mana).toBe(fp(60));
  });

  it("hideout: same portal, but the walk out and no teleport of its own", () => {
    const f = fixture("map", 6);
    f.sim.step();
    f.sim.step(f.answer("hideout"));
    const s = session(f);
    expect(s.dead).toBe(0);
    expect(s.portalsLeft).toBe(5);
    expect(s.pendingArea).toBe("hideout");
    // areaTransition places him; revive must not have moved the body itself.
    expect(f.world.get<Position>(f.p, "position")).toEqual(DIED_AT);
    expect(f.world.get<Health>(f.p, "health")!.life).toBe(fp(100));
  });

  /**
   * The one rule that is not a preference: spending the last portal closes the
   * map, and there is no coming back into a closed map to stand at its entrance.
   */
  it("the last portal cannot buy a checkpoint", () => {
    const f = fixture("map", 1);
    f.sim.step();
    f.sim.step(f.answer("checkpoint"));
    const s = session(f);
    expect(s.portalsLeft).toBe(0);
    expect(s.mapOpen).toBe(0);
    expect(s.pendingArea).toBe("hideout");
  });

  it("dying in the hideout costs no portal either way", () => {
    const f = fixture("hideout", 6);
    f.sim.step();
    f.sim.step(f.answer("checkpoint"));
    const s = session(f);
    expect(s.dead).toBe(0);
    expect(s.portalsLeft).toBe(6);
    // No map to hold a checkpoint, so the answer is the hideout regardless.
    expect(s.pendingArea).toBe("hideout");
  });

  it("a revive with nobody dead is ignored", () => {
    const f = fixture("map", 6);
    f.world.set<Health>(f.p, "health", { life: fp(100), maxLife: fp(100) });
    f.sim.step(f.answer("checkpoint"));
    const s = session(f);
    expect(s.portalsLeft).toBe(6);
    expect(f.world.get<Position>(f.p, "position")).toEqual(DIED_AT);
  });

  it("two answers in one tick spend one portal, not two", () => {
    const f = fixture("map", 6);
    f.sim.step();
    f.sim.step([...f.answer("checkpoint"), ...f.answer("checkpoint")]);
    expect(session(f).portalsLeft).toBe(5);
  });
});
