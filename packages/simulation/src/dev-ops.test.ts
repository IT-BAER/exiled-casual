import { describe, it, expect } from "vitest";
import { createCombatSim } from "./combat-sim";
import { applyDevOp, devDump } from "./dev-ops";
import type { InventoryC, ProgressC, SessionC, Health } from "./components";

const fresh = () => createCombatSim(42, { area: "hideout", classId: "class.ironsworn" });
const sessionOf = (w: ReturnType<typeof fresh>["world"]) => w.query("session")[0]!;
const inv = (w: ReturnType<typeof fresh>["world"]) => w.get<InventoryC>(sessionOf(w), "inventory")!;

describe("DEV ops", () => {
  it("sets the level and lifts max life with it", () => {
    const { world, playerEntity } = fresh();
    const lifeBefore = world.get<Health>(playerEntity, "health")!.maxLife;
    applyDevOp(world, { op: "setLevel", level: 20 });
    expect(world.get<ProgressC>(sessionOf(world), "progress")!.level).toBe(20);
    expect(world.get<Health>(playerEntity, "health")!.maxLife).toBeGreaterThan(lifeBefore);
  });

  it("sets gold", () => {
    const { world } = fresh();
    applyDevOp(world, { op: "setGold", gold: 0 });
    expect(world.get<ProgressC>(sessionOf(world), "progress")!.gold).toBe(0);
  });

  it("grants an item of the asked base and rarity, with the asked affixes", () => {
    const { world } = fresh();
    const before = inv(world).items.length;
    applyDevOp(world, {
      op: "grantItem", baseId: "base.ironsworn_hammer", rarity: "rare",
      affixes: [{ affixId: "affix.added_phys", value: 12 }, { affixId: "affix.fire_res", value: 20 }],
    });
    const got = inv(world).items.at(-1)!.item;
    expect(inv(world).items.length).toBe(before + 1);
    expect(got).toMatchObject({ baseId: "base.ironsworn_hammer", rarity: "rare" });
    expect(got.affixes).toEqual([{ affixId: "affix.added_phys", value: 12 }, { affixId: "affix.fire_res", value: 20 }]);
    expect(got.unidentified).toBeUndefined();
  });

  it("grants a rolled item of a forced base when no affixes are named", () => {
    const { world } = fresh();
    applyDevOp(world, { op: "grantItem", baseId: "base.stalker_bow", rarity: "magic", seed: 7 });
    const got = inv(world).items.at(-1)!.item;
    expect(got.baseId).toBe("base.stalker_bow");
    expect(got.rarity).toBe("magic");
    expect(got.affixes.length).toBeGreaterThan(0);
  });

  it("grants a named unique", () => {
    const { world } = fresh();
    applyDevOp(world, { op: "grantItem", baseId: "", rarity: "unique", uniqueId: "unique.quietus" });
    const got = inv(world).items.at(-1)!.item;
    expect(got).toMatchObject({ rarity: "unique", name: "Quietus", baseId: "base.stalker_bow" });
  });

  it("stacks granted currency onto one cell", () => {
    const { world } = fresh();
    applyDevOp(world, { op: "grantCurrency", baseId: "currency.alchemy", count: 5 });
    applyDevOp(world, { op: "grantCurrency", baseId: "currency.alchemy", count: 3 });
    const piles = inv(world).items.filter((p) => p.item.baseId === "currency.alchemy");
    expect(piles).toHaveLength(1);
    expect(piles[0]!.count).toBe(8);
  });

  it("teleports from the hideout into any node at any tier", () => {
    const { world, sim } = fresh();
    applyDevOp(world, { op: "teleport", atlasNodeId: "node.gallowsmoor", tier: 9 });
    sim.step();
    const s = world.get<SessionC>(sessionOf(world), "session")!;
    expect(s).toMatchObject({ area: "map", activeNodeId: "node.gallowsmoor", areaTier: 9, mapOpen: 1 });
    applyDevOp(world, { op: "toHideout" });
    sim.step();
    expect(world.get<SessionC>(sessionOf(world), "session")!.area).toBe("hideout");
  });

  it("opens the whole Atlas", () => {
    const { world } = fresh();
    applyDevOp(world, { op: "openAtlas" });
    expect(world.get<SessionC>(sessionOf(world), "session")!.completedNodes.length).toBe(15);
  });

  it("dumps the player and session components as plain JSON", () => {
    const { world } = fresh();
    const dump = devDump(world, 123) as { tick: number; player: Record<string, unknown>; session: Record<string, unknown> };
    expect(dump.tick).toBe(123);
    expect(dump.player).toHaveProperty("health");
    expect(dump.player).toHaveProperty("mana");
    expect(dump.session).toHaveProperty("progress");
    expect(dump.session).toHaveProperty("equipment");
    expect(() => JSON.stringify(dump)).not.toThrow();
  });
});
