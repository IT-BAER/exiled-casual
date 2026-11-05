import { describe, expect, it } from "vitest";
import { atlasGraph, atlasNodeTier } from "@exiled/rules";
import { waystoneItem, SKILLS } from "@exiled/content-runtime";
import type { Item } from "@exiled/content-schema";
import { newCharacter, playNextMap, gearScore, refit, campaign } from "./playtest";
import { KITS } from "./bot";
import type { EquipmentC, InventoryC, SessionC } from "./components";

const item = (baseId: string, affixes: Item["affixes"] = []): Item =>
  ({ baseId, rarity: affixes.length ? "magic" : "normal", itemLevel: 40, affixes });

describe("the harness's gear score, per class", () => {
  it("the Ironsworn wants a heavier hammer and never a wand", () => {
    const iron = (it: Item) => gearScore("class.ironsworn", it);
    expect(iron(item("base.ironsworn_hammer", [{ affixId: "affix.phys_dmg_pct", value: 30 }])))
      .toBeGreaterThan(iron(item("base.ironsworn_hammer")));
    expect(iron(item("base.ember_kindling_wand", [{ affixId: "affix.fire_dmg", value: 15 }]))).toBe(-Infinity);
  });

  it("the Emberbound counts a wand's flat fire", () => {
    const ember = (it: Item) => gearScore("class.emberbound", it);
    expect(ember(item("base.ember_kindling_wand", [{ affixId: "affix.fire_dmg", value: 15 }])))
      .toBeGreaterThan(ember(item("base.ember_kindling_wand")));
  });

  it("the Stalker counts a bow's own damage", () => {
    const stalker = (it: Item) => gearScore("class.stalker", it);
    expect(stalker(item("base.stalker_bow", [{ affixId: "affix.phys_dmg_pct", value: 30 }])))
      .toBeGreaterThan(stalker(item("base.stalker_bow")));
  });

  it("never trades the bow for a buckler, which would leave his hands empty", () => {
    for (const mode of ["caster", "class"] as const) {
      const g = newCharacter("class.stalker", 5, 10);
      const inv = g.world.get<InventoryC>(g.session, "inventory")!;
      const buckler = item("base.stalker_buckler", [{ affixId: "affix.life", value: 40 }]);
      g.world.set<InventoryC>(g.session, "inventory", { ...inv, items: [...inv.items, { x: 10, y: 0, w: 2, h: 2, item: buckler }] });
      refit(g, mode);
      expect(g.world.get<EquipmentC>(g.session, "equipment")!.slots.weapon1?.baseId).toBe("base.stalker_bow");
    }
  });
});

describe("the class-kit pilot", () => {
  // Level 24 opens every class's last skill. An escape skill fires only below 60% life,
  // which this level never reaches (balance report section 5): pressure runs measure it.
  it.each(["class.ironsworn", "class.stalker", "class.emberbound"])("%s casts every skill the kit slots", (classId) => {
    const runs = campaign(classId, 21, 2, { kit: true }, 24);
    const escape = KITS[classId]!.escape;
    const slotted = KITS[classId]!.bar.filter((id) => SKILLS.get(id)!.unlockLevel <= 24).slice(0, 6);
    const cast = new Set(runs.flatMap((r) => Object.keys(r.casts)));
    for (const id of slotted) if (id !== escape) expect(cast, id).toContain(id);
  }, 300_000);
});

describe("the harness's damage meter", () => {
  it("credits Cinder Ground's burning to Cinder Ground, not to an anonymous burning bucket", () => {
    const [run] = campaign("class.emberbound", 4, 1, {}, 10);
    expect(run!.dealt["skill.cinder_ground.v1"]).toBeGreaterThan(0);
    expect(run!.dealt["skill.ember_bolt.v1"]).toBeGreaterThan(0);
    expect(run!.dealt["dot.burning"]).toBeUndefined();
  }, 120_000);
});

describe("the harness's atlas walk", () => {
  it("with nothing new in reach, replays the highest tier the best stone opens, not tier 1", () => {
    const g = newCharacter("class.emberbound", 3, 30);
    const s = g.world.get<SessionC>(g.session, "session")!;
    const graph = atlasGraph(s.atlasSeed);
    const done = graph.filter((n) => atlasNodeTier(graph, n.id) <= 3).map((n) => n.id);
    g.world.set<SessionC>(g.session, "session", { ...s, completedNodes: done });
    const inv = g.world.get<InventoryC>(g.session, "inventory")!;
    g.world.set<InventoryC>(g.session, "inventory", {
      ...inv,
      items: [
        { x: 0, y: 0, w: 1, h: 1, item: waystoneItem(11, 3) },
        { x: 1, y: 0, w: 1, h: 1, item: waystoneItem(12, 1) },
      ],
    });

    expect(playNextMap(g)?.tier).toBe(3);
  }, 120_000);
});
