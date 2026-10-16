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
});
