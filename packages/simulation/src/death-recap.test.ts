import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { CONTENT_VERSION, MONSTERS } from "@exiled/content-runtime";
import { createCombatSim } from "./combat-sim";
import { buildSnapshot } from "./protocol-bridge";
import { spawnMonster } from "./areas";
import { registerRevive } from "./systems/revive";
import { summarizeHits, RECAP_WINDOW_TICKS, BURNING_SOURCE, type RecapHit } from "./death-recap";
import type { Health, SessionC } from "./components";

const WARDEN = "monster.cinder_warden.v1";
const IMP = "monster.cinder_imp.v1";

/** A map session, so a death stays down (the legacy path heals on the spot). */
function fight() {
  const { sim, world, playerEntity } = createCombatSim(7, { monsters: false });
  const sessionE = world.create();
  world.set<SessionC>(sessionE, "session", {
    area: "map", atlasSeed: 0, mapSeed: 0, waystoneSeed: 0, areaTier: 0,
    activeNodeId: "", completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "",
    checkpointX: 0, checkpointY: 0,
  });
  spawnMonster(world, MONSTERS.get(WARDEN)!, fp(0), fp(1), false);
  spawnMonster(world, MONSTERS.get(IMP)!, fp(4), fp(0), false);
  const alive = () => world.get<Health>(playerEntity, "health")!.life > 0;
  for (let i = 0; i < 3000 && alive(); i++) sim.step();
  return { sim, world, playerEntity, alive };
}

const hit = (tick: number, species: string, amount: number, type = 1, rare = false): RecapHit =>
  ({ tick, species, rare, type, amount });

describe("death recap", () => {
  it("the death screen's snapshot names what killed him", () => {
    const { sim, world, alive } = fight();
    expect(alive()).toBe(false);
    const recap = buildSnapshot(world, sim, sim.tick, CONTENT_VERSION).deathRecap!;
    expect(recap).toBeDefined();
    expect([WARDEN, IMP]).toContain(recap.killingBlow.species);
    expect(recap.killingBlow.damage).toBeGreaterThan(0);
    const species = recap.sources.map((s) => s.species);
    expect(species.length).toBeGreaterThan(0);
    for (const s of species) expect([WARDEN, IMP]).toContain(s);
    const dmg = recap.sources.map((s) => s.damage);
    expect([...dmg].sort((a, b) => b - a)).toEqual(dmg);
  });

  it("the corpse takes no more hits into the recap while the screen is up", () => {
    const { sim, world } = fight();
    const before = buildSnapshot(world, sim, sim.tick, CONTENT_VERSION).deathRecap;
    for (let i = 0; i < 120; i++) sim.step();
    expect(buildSnapshot(world, sim, sim.tick, CONTENT_VERSION).deathRecap).toEqual(before);
  });

  it("a living player carries no recap, and a revive forgets the last death", () => {
    const { sim, world, playerEntity } = fight();
    registerRevive(sim); // the legacy combat sim registers none
    sim.step([{ tick: sim.tick, entity: playerEntity, type: "revive", data: { checkpoint: 1 } }]);
    expect(world.get<Health>(playerEntity, "health")!.life).toBeGreaterThan(0);
    expect(buildSnapshot(world, sim, sim.tick, CONTENT_VERSION).deathRecap).toBeUndefined();
    expect(sim.recentHits).toEqual([]);
  });
});

describe("summarizeHits", () => {
  it("groups by species, ranks by damage, keeps three", () => {
    const r = summarizeHits([
      hit(1, "a", 10), hit(2, "b", 30), hit(3, "a", 25), hit(4, "c", 5), hit(5, "d", 1),
    ], 100);
    expect(r.sources.map((s) => [s.species, s.damage, s.hits])).toEqual([
      ["a", 35, 2], ["b", 30, 1], ["c", 5, 1],
    ]);
    expect(r.total).toBe(71);
  });

  it("a rare and a normal of one species are two sources", () => {
    const r = summarizeHits([hit(1, "a", 10), hit(2, "a", 20, 1, true)], 100);
    expect(r.sources.map((s) => [s.species, s.rare])).toEqual([["a", true], ["a", false]]);
  });

  it("the killing blow is the last hit, as a share of max life", () => {
    const r = summarizeHits([hit(1, "a", 10), hit(9, "b", 40, 0)], 80);
    expect(r.killingBlow).toEqual({ species: "b", rare: false, damage: 40, element: "fire", pctOfLife: 50 });
  });

  it("only the window before the killing blow counts", () => {
    const last = 1000;
    const r = summarizeHits([hit(last - RECAP_WINDOW_TICKS - 1, "old", 99), hit(last, "a", 5)], 100);
    expect(r.sources.map((s) => s.species)).toEqual(["a"]);
  });

  it("a source's element is the one it dealt most, and totals are kept per element", () => {
    const r = summarizeHits([hit(1, "a", 10, 0), hit(2, "a", 30, 2), hit(3, BURNING_SOURCE, 4, 0)], 100);
    expect(r.sources[0]).toMatchObject({ species: "a", element: "cold" });
    expect(r.byElement).toEqual({ fire: 14, cold: 30 });
  });
});
