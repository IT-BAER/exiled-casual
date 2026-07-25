import { describe, it, expect } from "vitest";
import { generateArea } from "@exiled/mapgen";
import { CONTENT_VERSION } from "@exiled/content-runtime";
import { waystoneMods, monsterTierScale, waystoneScaleFor } from "@exiled/rules";
import { World } from "./ecs";
import { createCombatSim } from "./combat-sim";
import { buildArea, mapDangerScale } from "./areas";
import type { SessionC, DefensesC, Health, MonsterC } from "./components";

/** The first seed whose stone rolls `id`, so a test can name a modifier it wants. */
function seedRolling(id: string): number {
  for (let s = 1; s < 200_000; s++) if (waystoneMods(s).some((m) => m.id === id)) return s;
  throw new Error(`no seed rolls ${id}`);
}

function mapSession(waystoneSeed: number, areaTier = 1): SessionC {
  return {
    area: "map", atlasSeed: 1, mapSeed: 99, waystoneSeed, areaTier,
    activeNodeId: "node.ashen_glade", completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "",
  };
}

function buildMap(session: SessionC): World {
  const world = new World();
  buildArea(world, "map", session, generateArea(session.mapSeed, CONTENT_VERSION));
  return world;
}

describe("mapDangerScale", () => {
  it("is the tier alone when the stone is plain", () => {
    expect(mapDangerScale(mapSession(0, 7))).toEqual(monsterTierScale(7));
  });

  it("multiplies the stone onto the tier rather than adding to it", () => {
    const seed = seedRolling("monsterLife");
    const s = mapSession(seed, 7);
    const tier = monsterTierScale(7);
    const ws = waystoneScaleFor(seed);
    expect(mapDangerScale(s).lifeMilli).toBe(Math.trunc((tier.lifeMilli * ws.lifeMilli) / 1000));
    // And it is genuinely harder than the plain stone at the same tier.
    expect(mapDangerScale(s).lifeMilli).toBeGreaterThan(tier.lifeMilli);
  });
});

describe("map modifiers reach the monsters", () => {
  it("pack size puts more of them in the map", () => {
    const plain = buildMap(mapSession(0)).query("monster").length;
    const packed = buildMap(mapSession(seedRolling("packSize"))).query("monster").length;
    expect(packed).toBeGreaterThan(plain);
  });

  it("more life is more life on the spawned monster, not just on paper", () => {
    const seed = seedRolling("monsterLife");
    const lifeOf = (w: World) => {
      const e = w.query("monster", "health")[0]!;
      return w.get<Health>(e, "health")!.maxLife;
    };
    expect(lifeOf(buildMap(mapSession(seed)))).toBeGreaterThan(lifeOf(buildMap(mapSession(0))));
  });

  it("elemental resistance raises every element on every monster", () => {
    const seed = seedRolling("monsterElementalRes");
    const add = waystoneScaleFor(seed).monsterResAdd;
    const world = buildMap(mapSession(seed));
    for (const e of world.query("monster", "defenses")) {
      const d = world.get<DefensesC>(e, "defenses")!;
      if (world.get<MonsterC>(e, "monster")!.rare === 1) {
        // A rare already resists its own element by 30; the modifier stacks on top.
        expect(Math.max(d.res.fire, d.res.cold, d.res.lightning, d.res.chaos)).toBe(add + 30);
        continue;
      }
      // The plain imp resists nothing on its own, so what is left is the modifier.
      expect(d.res.cold).toBe(add);
      expect(d.res.chaos).toBe(add);
    }
  });

  it("a plain stone leaves the monsters exactly as content wrote them", () => {
    const world = buildMap(mapSession(0));
    const e = world.query("monster", "defenses")[0]!;
    expect(world.get<DefensesC>(e, "defenses")!.res.cold).toBe(0);
  });
});

describe("the player's resistances are taxed only inside the map", () => {
  /** A live area-based sim whose session already holds `waystoneSeed`. */
  function runWith(waystoneSeed: number) {
    const { sim, world, playerEntity } = createCombatSim(1234, { area: "hideout" });
    const sessionE = world.query("session")[0]!;
    const base = world.get<SessionC>(sessionE, "session")!;
    world.set<SessionC>(sessionE, "session", {
      ...base, waystoneSeed, areaTier: 1, mapOpen: 1, portalsLeft: 6, activeNodeId: "node.ashen_glade",
    });
    const resOf = () => world.get<DefensesC>(playerEntity, "defenses")!.res.fire;
    const goTo = (area: "hideout" | "map") => {
      const s = world.get<SessionC>(sessionE, "session")!;
      world.set<SessionC>(sessionE, "session", { ...s, pendingArea: area });
      sim.step();
    };
    return { resOf, goTo };
  }

  it("takes the penalty on entering and gives it back on leaving", () => {
    const seed = seedRolling("playerResPenalty");
    const penalty = waystoneScaleFor(seed).playerResPenalty;
    const { resOf, goTo } = runWith(seed);

    expect(resOf()).toBe(0);
    goTo("map");
    expect(resOf()).toBe(-penalty);
    goTo("hideout");
    expect(resOf()).toBe(0);
  });

  it("a stone without the modifier taxes nothing", () => {
    const { resOf, goTo } = runWith(0);
    goTo("map");
    expect(resOf()).toBe(0);
  });
});
