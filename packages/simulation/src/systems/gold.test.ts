import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { areaLevel, vendorBuyPrice } from "@exiled/rules";
import { Simulation } from "../loop";
import { registerGoldPickup } from "./gold";
import { registerDeath } from "./death";
import { createCombatSim } from "../combat-sim";
import { spillContainer } from "../areas";
import type { World } from "../ecs";
import type { GoldC, ProgressC, SessionC, Health } from "../components";

const SESSION: SessionC = {
  area: "map", atlasSeed: 1, mapSeed: 7, waystoneSeed: 0, areaTier: 1, activeNodeId: "",
  completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "",
};

function pickupWorld(moving: boolean, pileAt: number) {
  const sim = new Simulation();
  registerGoldPickup(sim);
  const w = sim.world;
  const p = w.create();
  w.set(p, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
  w.set(p, "position", { x: 0, y: 0 });
  w.set(p, "moveTarget", { x: fp(9), y: 0, active: moving ? 1 : 0 });
  w.set(p, "moveDir", { dx: 0, dy: 0, hx: 0, hy: 0 });
  const s = w.create();
  w.set<SessionC>(s, "session", SESSION);
  w.set<ProgressC>(s, "progress", { level: 1, xp: 0, gold: 100 });
  const g = w.create();
  w.set(g, "position", { x: pileAt, y: 0 });
  w.set<GoldC>(g, "gold", { amount: 37, jackpot: 0 });
  return { sim, w, p, s, g };
}

const gold = (w: World) => w.query("gold", "position").map((e) => w.get<GoldC>(e, "gold")!);

describe("gold pickup", () => {
  it("collects a pile in range while the player is moving", () => {
    const { sim, w, s, g } = pickupWorld(true, fp(2));
    sim.step();
    expect(w.alive.has(g)).toBe(false);
    expect(w.get<ProgressC>(s, "progress")!.gold).toBe(137);
  });

  it("leaves the pile on the floor while the player stands still", () => {
    const { sim, w, s, g } = pickupWorld(false, fp(2));
    sim.step();
    expect(w.alive.has(g)).toBe(true);
    expect(w.get<ProgressC>(s, "progress")!.gold).toBe(100);
  });

  it("counts a held movement key as moving", () => {
    const { sim, w, p, g } = pickupWorld(false, fp(2));
    w.set(p, "moveDir", { dx: 1, dy: 0, hx: 0, hy: 0 });
    sim.step();
    expect(w.alive.has(g)).toBe(false);
  });

  it("ignores a pile out of range", () => {
    const { sim, w, g } = pickupWorld(true, fp(6));
    sim.step();
    expect(w.alive.has(g)).toBe(true);
  });
});

describe("gold drops", () => {
  function killRare(area: "map" | "hideout") {
    const sim = new Simulation();
    registerDeath(sim);
    const w = sim.world;
    const s = w.create();
    w.set<SessionC>(s, "session", { ...SESSION, area });
    const m = w.create();
    w.set(m, "monster", { defId: "test", state: "idle", moveSpeed: 0, bodyRadius: 0,
      attackRange: 0, attackCooldownTicks: 0, attackDamage: 0, attackType: 1, attackReadyTick: 0, rare: 1, summoned: 0 });
    w.set(m, "health", { life: 0, maxLife: fp(40) });
    w.set(m, "position", { x: fp(10), y: fp(10) });
    sim.step();
    return w;
  }

  it("a rare kill in a map always leaves a pile beside the corpse", () => {
    const piles = gold(killRare("map"));
    expect(piles.length).toBe(1);
    expect(piles[0]!.amount).toBeGreaterThan(0);
  });

  it("a kill in the hideout pays no gold", () => {
    expect(gold(killRare("hideout")).length).toBe(0);
  });

  it("a cache pays a pile alongside its items", () => {
    const sim = new Simulation();
    spillContainer(sim.world, SESSION, "cache:7:3", fp(4), fp(4));
    expect(gold(sim.world).length).toBe(1);
  });

  it("is deterministic: the same kill pays the same pile", () => {
    expect(gold(killRare("map"))).toEqual(gold(killRare("map")));
  });

  // The knob's pin: a cleared map pays about one magic item off the shelf at its
  // own level. Below half, gold is noise; above double, the shop replaces the map.
  it("a cleared tier-1 map pays about one magic item's shelf price", () => {
    const price = vendorBuyPrice({ baseId: "x", rarity: "magic", itemLevel: areaLevel(1), affixes: [] });
    let total = 0;
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    for (const seed of seeds) {
      const { sim, world } = createCombatSim(seed, { area: "map", tier: 1 });
      for (const e of world.query("monster", "health")) {
        world.set<Health>(e, "health", { ...world.get<Health>(e, "health")!, life: 0 });
      }
      sim.step();
      total += gold(world).reduce((sum, g) => sum + g.amount, 0);
    }
    const perMap = total / seeds.length;
    expect(perMap).toBeGreaterThan(price / 2);
    expect(perMap).toBeLessThan(price * 2);
  });
});
