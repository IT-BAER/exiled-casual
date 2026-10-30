import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { World } from "./ecs";
import { suspendArea, restoreArea } from "./suspend";

describe("suspendArea", () => {
  it("peels every ailment off a monster, and keeps the monster", () => {
    const world = new World();
    const m = world.create();
    world.set(m, "health", { life: fp(10), maxLife: fp(10) });
    world.set(m, "ailment", { kind: "burning", stacks: 2, dps: fp(8), expiryTick: 99 });
    world.set(m, "poison", { kind: "poison", stacks: 1, dps: fp(2), expiryTick: 99 });
    world.set(m, "bleeding", { kind: "bleeding", stacks: 1, dps: fp(2), expiryTick: 99 });
    const held = suspendArea(world, new Set(), { mapSeed: 1, activeNodeId: "n" }, 10);
    const back = new World();
    restoreArea(back, held, 10);
    const [e] = back.query("health");
    expect(e).toBeDefined();
    expect(back.has(e!, "ailment")).toBe(false);
    expect(back.has(e!, "poison")).toBe(false);
    expect(back.has(e!, "bleeding")).toBe(false);
  });

  it("rebases a boss's cast, volley and brood ticks, each ability's cooldown included", () => {
    const world = new World();
    const b = world.create();
    const boss = {
      phase: 3, nextAbilityTick: 110, spawnX: 0, spawnY: 0, rootedUntilTick: 0,
      abilityReadyTicks: [0, 150], volleyAbility: 0, volleyLeft: 2, volleyAtTick: 105, broodAtTick: 200,
    };
    world.set(b, "boss", boss);
    const held = suspendArea(world, new Set(), { mapSeed: 1, activeNodeId: "n" }, 100);
    const back = new World();
    restoreArea(back, held, 1100);
    expect(back.get(back.query("boss")[0]!, "boss")).toEqual({
      ...boss, nextAbilityTick: 1110, abilityReadyTicks: [1000, 1150], volleyAtTick: 1105, broodAtTick: 1200,
    });
  });
});
