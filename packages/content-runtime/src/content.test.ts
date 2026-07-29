import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import {
  validateSkillDef,
  validateMonsterDef,
  ID_PATTERN,
  BIOME_IDS,
  MONSTER_ARCHETYPES,
  ELEMENTS,
} from "@exiled/content-schema";
import {
  CONTENT_VERSION,
  SKILLS,
  MONSTERS,
  RARE_TEMPLATES,
  rareTemplate,
  MONSTER_POOLS,
  pickPack,
} from "./index.js";

describe("CONTENT_VERSION", () => {
  it('=== "slice1.v1"', () => {
    expect(CONTENT_VERSION).toBe("slice1.v1");
  });
});

describe("RARE_TEMPLATES", () => {
  it("carries one template per element, sharing the multipliers", () => {
    expect(RARE_TEMPLATES.map((t) => t.element)).toEqual(["fire", "cold", "lightning", "chaos"]);
    for (const t of RARE_TEMPLATES) {
      expect(t).toMatchObject({
        lifeMulPct: 900,
        moveSpeedMulPct: 120,
        damageMulPct: 300,
        addedResPct: 30,
      });
      expect(t.namePrefix.length).toBeGreaterThan(0);
    }
  });

  it("rareTemplate picks deterministically and totally, negatives included", () => {
    expect(rareTemplate(2)).toBe(RARE_TEMPLATES[2]);
    expect(rareTemplate(6)).toBe(RARE_TEMPLATES[2]);
    expect(rareTemplate(-6)).toBe(RARE_TEMPLATES[2]);
    expect(rareTemplate(0x7fffffff)).toBeDefined();
  });
});

describe("SKILLS", () => {
  it("every entry passes validateSkillDef", () => {
    for (const [id, def] of SKILLS) {
      const r = validateSkillDef(def);
      expect(r.ok, `${id}: ${r.errors.join(", ")}`).toBe(true);
    }
  });

  it("every id matches ID_PATTERN", () => {
    for (const id of SKILLS.keys()) {
      expect(ID_PATTERN.test(id), `"${id}" should match ID_PATTERN`).toBe(true);
    }
  });

  it("contains the 3 authored skills", () => {
    expect(SKILLS.has("skill.ember_bolt.v1")).toBe(true);
    expect(SKILLS.has("skill.cinder_ground.v1")).toBe(true);
    expect(SKILLS.has("skill.blink.v1")).toBe(true);
  });

  it("ember_bolt has a spawnProjectile effect with damage.amountFixed === fp(36)", () => {
    const def = SKILLS.get("skill.ember_bolt.v1")!;
    const effect = def.effects.find((e) => e.type === "spawnProjectile");
    expect(effect).toBeDefined();
    if (effect?.type === "spawnProjectile") {
      expect(effect.damage.amountFixed).toBe(fp(36));       // 36000
      expect(effect.maxRangeFixed).toBe(fp(20));             // 20000
    }
  });

  it("ember_bolt manaCostFixed === fp(12) and cooldownTicks === 12", () => {
    const def = SKILLS.get("skill.ember_bolt.v1")!;
    expect(def.manaCostFixed).toBe(fp(12));
    expect(def.cooldownTicks).toBe(12);
  });

  /**
   * The cast is the rate limiter and the cooldown sits under it, which is what
   * makes "% increased Cast Speed" the stat that speeds this skill up. Swap the
   * two and gear can never give the rate back — see the note on the def.
   */
  it("ember_bolt is limited by its cast, not its cooldown", () => {
    const def = SKILLS.get("skill.ember_bolt.v1")!;
    expect(def.castTicks).toBe(14);
    expect(def.cooldownTicks).toBeLessThan(def.castTicks!);
  });

  it("cinder_ground has a spawnGroundArea effect with burning ailment maxStacks=5 dpsFixed=fp(8)", () => {
    const def = SKILLS.get("skill.cinder_ground.v1")!;
    const effect = def.effects.find((e) => e.type === "spawnGroundArea");
    expect(effect).toBeDefined();
    if (effect?.type === "spawnGroundArea") {
      expect(effect.ailment.kind).toBe("burning");
      expect(effect.ailment.maxStacks).toBe(5);
      expect(effect.ailment.dpsFixed).toBe(fp(8));           // 8000
    }
  });

  it("blink has a teleport effect with distanceFixed === fp(5)", () => {
    const def = SKILLS.get("skill.blink.v1")!;
    const effect = def.effects.find((e) => e.type === "teleport");
    expect(effect).toBeDefined();
    if (effect?.type === "teleport") {
      expect(effect.distanceFixed).toBe(fp(5));              // 5000
    }
  });
});

describe("MONSTERS", () => {
  it("every entry passes validateMonsterDef", () => {
    for (const [id, def] of MONSTERS) {
      const r = validateMonsterDef(def);
      expect(r.ok, `${id}: ${r.errors.join(", ")}`).toBe(true);
    }
  });

  it("every id matches ID_PATTERN", () => {
    for (const id of MONSTERS.keys()) {
      expect(ID_PATTERN.test(id), `"${id}" should match ID_PATTERN`).toBe(true);
    }
  });

  it("contains the authored monster", () => {
    expect(MONSTERS.has("monster.cinder_imp.v1")).toBe(true);
  });

  it("cinder_imp maxLifeFixed === fp(40)", () => {
    const def = MONSTERS.get("monster.cinder_imp.v1")!;
    expect(def.maxLifeFixed).toBe(fp(40));                   // 40000
  });

  // Swarm speed, under the player's 4.2 but close enough to punish walking away.
  it("cinder_imp moveSpeedFixed === fp(3.5)", () => {
    const def = MONSTERS.get("monster.cinder_imp.v1")!;
    expect(def.moveSpeedFixed).toBe(fp(3.5));                // 3500
  });

  it("cinder_imp attackDamage is physical fp(6)", () => {
    const def = MONSTERS.get("monster.cinder_imp.v1")!;
    expect(def.attackDamage.type).toBe("physical");
    expect(def.attackDamage.amountFixed).toBe(fp(6));        // 6000
  });

  it("cinder_imp has no resistances and armourFixed === fp(0.5)", () => {
    const def = MONSTERS.get("monster.cinder_imp.v1")!;
    expect(def.defenses.resPct).toEqual({ fire: 0, cold: 0, lightning: 0, chaos: 0 });
    expect(def.defenses.armourFixed).toBe(fp(0.5));          // 500
  });

  it("cinder_warden is defined and has boss", () => {
    const def = MONSTERS.get("monster.cinder_warden.v1");
    expect(def).toBeDefined();
    expect(def?.boss).toBeDefined();
  });

  it("cinder_warden boss.phase2.addDefId resolves in MONSTERS (referential integrity)", () => {
    const def = MONSTERS.get("monster.cinder_warden.v1")!;
    const addId = def.boss?.phase2.addDefId ?? "";
    expect(MONSTERS.has(addId)).toBe(true);
  });
});

describe("monster pools", () => {
  it("every biome has exactly three species", () => {
    for (const id of BIOME_IDS) {
      expect(MONSTER_POOLS[id].length, id).toBe(3);
    }
  });

  it("every pool entry resolves in MONSTERS", () => {
    for (const id of BIOME_IDS) {
      for (const entry of MONSTER_POOLS[id]) {
        expect(MONSTERS.has(entry.defId), `${id}: ${entry.defId}`).toBe(true);
      }
    }
  });

  it("no biome repeats an archetype", () => {
    for (const id of BIOME_IDS) {
      const kinds = MONSTER_POOLS[id].map((e) => MONSTERS.get(e.defId)!.archetype);
      expect(new Set(kinds).size, id).toBe(3);
    }
  });

  it("no two biomes field the same three archetypes", () => {
    const sigs = BIOME_IDS.map((id) =>
      MONSTER_POOLS[id].map((e) => MONSTERS.get(e.defId)!.archetype).sort().join(","),
    );
    expect(new Set(sigs).size).toBe(BIOME_IDS.length);
  });

  it("every archetype appears in some biome", () => {
    const seen = new Set(
      BIOME_IDS.flatMap((id) => MONSTER_POOLS[id].map((e) => MONSTERS.get(e.defId)!.archetype)),
    );
    expect(seen.size).toBe(MONSTER_ARCHETYPES.length);
  });

  it("every element is answered by an ordinary monster somewhere", () => {
    const types = new Set(
      BIOME_IDS.flatMap((id) =>
        MONSTER_POOLS[id].map((e) => MONSTERS.get(e.defId)!.attackDamage.type),
      ),
    );
    for (const el of ELEMENTS) expect(types.has(el), el).toBe(true);
  });

  it("pickPack is total and deterministic across the whole 0..1 range", () => {
    for (const id of BIOME_IDS) {
      for (let i = 0; i <= 100; i++) {
        const roll = i / 100;
        const a = pickPack(id, roll);
        const b = pickPack(id, roll);
        expect(a.id).toBe(b.id);
        expect(MONSTER_POOLS[id].some((e) => e.defId === a.id)).toBe(true);
      }
    }
  });

  it("pickPack reaches every species in its pool", () => {
    for (const id of BIOME_IDS) {
      const hit = new Set<string>();
      for (let i = 0; i < 1000; i++) hit.add(pickPack(id, i / 1000).id);
      expect(hit.size, id).toBe(3);
    }
  });

  it("a shooter's range is inside AGGRO_RADIUS so a woken shooter can reach the player", () => {
    for (const def of MONSTERS.values()) {
      if (def.archetype !== "shooter") continue;
      expect(def.attackRangeFixed, def.id).toBeLessThan(fp(9));
    }
  });

  it("a heavy's wind-up is long enough to be a decision, not a reflex test", () => {
    for (const def of MONSTERS.values()) {
      if (def.archetype !== "heavy") continue;
      expect(def.heavy!.windupTicks / 30, def.id).toBeGreaterThanOrEqual(0.75);
    }
  });
});
