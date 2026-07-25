import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { makeRare } from "@exiled/rules";
import { MONSTERS, RARE_TEMPLATES } from "@exiled/content-runtime";
import { World } from "./ecs";
import { spawnMonster } from "./areas";
import type { MonsterC, DefensesC } from "./components";
import { DAMAGE_TYPES, damageCode, damageTypeOf } from "./damage-types";

describe("damage type codes", () => {
  it("keeps fire at 0 and physical at 1, so old serialized worlds still mean what they meant", () => {
    expect(damageCode("fire")).toBe(0);
    expect(damageCode("physical")).toBe(1);
  });

  it("round-trips every type", () => {
    for (const t of DAMAGE_TYPES) expect(damageTypeOf(damageCode(t))).toBe(t);
  });

  it("throws rather than guessing on an unknown code", () => {
    expect(() => damageTypeOf(DAMAGE_TYPES.length)).toThrow();
  });
});

describe("themed rares reach the world as elemental attackers", () => {
  const impDef = MONSTERS.get("monster.cinder_imp.v1")!;

  it("each template spawns a monster whose attack and resistance are its element", () => {
    for (const tpl of RARE_TEMPLATES) {
      const world = new World();
      const e = spawnMonster(world, makeRare(impDef, tpl), fp(0), fp(0), true);
      const mon = world.get<MonsterC>(e, "monster")!;
      const def = world.get<DefensesC>(e, "defenses")!;
      expect(damageTypeOf(mon.attackType), tpl.element).toBe(tpl.element);
      expect(def.res[tpl.element], tpl.element).toBe(30);
    }
  });
});
