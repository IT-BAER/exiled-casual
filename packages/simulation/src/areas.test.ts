import { describe, it, expect } from "vitest";
import { generateArea } from "@pact/mapgen";
import { CONTENT_VERSION, MONSTERS } from "@pact/content-runtime";
import { monsterTierScale } from "@pact/rules";
import { World } from "./ecs.js";
import { buildArea } from "./areas.js";
import type { SessionC, Health, MonsterC } from "./components.js";

function mapSessionAtTier(tier: number): SessionC {
  return {
    area: "map", atlasSeed: 0, mapSeed: 7, areaTier: tier, activeNodeId: "node.ashen_glade",
    completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "",
  };
}

describe("tier scaling on map spawn", () => {
  it("scales imp life and attack damage by the tier per-mille", () => {
    const tier = 10;
    const world = new World();
    const session = mapSessionAtTier(tier);
    const layout = generateArea(session.mapSeed, CONTENT_VERSION);
    buildArea(world, "map", session, layout);

    const impDef = MONSTERS.get("monster.cinder_imp.v1")!;
    const { lifeMilli, dmgMilli } = monsterTierScale(tier);
    const expectedLife = Math.trunc(impDef.maxLifeFixed * lifeMilli / 1000);
    const expectedDmg = Math.trunc(impDef.attackDamage.amountFixed * dmgMilli / 1000);

    // Find a non-rare imp (rare life is templated separately).
    const imps = world.query("monster", "health").filter((e) => {
      const m = world.get<MonsterC>(e, "monster")!;
      return m.defId === impDef.id && m.rare === 0;
    });
    expect(imps.length).toBeGreaterThan(0);
    const h = world.get<Health>(imps[0]!, "health")!;
    const m = world.get<MonsterC>(imps[0]!, "monster")!;
    expect(h.maxLife).toBe(expectedLife);
    expect(m.attackDamage).toBe(expectedDmg);
  });

  it("tier 0 leaves stats unchanged", () => {
    const world = new World();
    const session = mapSessionAtTier(0);
    const layout = generateArea(session.mapSeed, CONTENT_VERSION);
    buildArea(world, "map", session, layout);
    const impDef = MONSTERS.get("monster.cinder_imp.v1")!;
    const imp = world.query("monster", "health").find((e) => {
      const m = world.get<MonsterC>(e, "monster")!;
      return m.defId === impDef.id && m.rare === 0;
    })!;
    expect(world.get<Health>(imp, "health")!.maxLife).toBe(impDef.maxLifeFixed);
  });
});
