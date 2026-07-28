import { describe, it, expect } from "vitest";
import { generateArea } from "@exiled/mapgen";
import { fp } from "@exiled/fixed-point";
import { CONTENT_VERSION, MONSTERS, MONSTER_POOLS, PACK_COUNT, mapBase } from "@exiled/content-runtime";
import { mapBaseIdForNode, monsterTierScale } from "@exiled/rules";
import type { MonsterDef } from "@exiled/content-schema";
import { World, type Entity } from "./ecs.js";
import { buildArea } from "./areas.js";
import type { SessionC, Health, MonsterC, Position } from "./components.js";

function mapSessionAtTier(tier: number): SessionC {
  return {
    area: "map", atlasSeed: 0, mapSeed: 7, waystoneSeed: 0, areaTier: tier, activeNodeId: "node.ashen_glade",
    completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "",
  };
}

// A non-rare, non-boss monster from whatever spawned: the scaling formula is
// generic across species, so the tests below don't need to know which one
// the active node's biome pool happened to roll.
function firstRegular(world: World): { e: Entity; def: MonsterDef } {
  const e = world.query("monster", "health").find((id) => {
    const m = world.get<MonsterC>(id, "monster")!;
    return m.rare === 0 && !world.has(id, "boss");
  })!;
  const m = world.get<MonsterC>(e, "monster")!;
  return { e, def: MONSTERS.get(m.defId)! };
}

describe("tier scaling on map spawn", () => {
  it("scales monster life and attack damage by the tier per-mille", () => {
    const tier = 10;
    const world = new World();
    const session = mapSessionAtTier(tier);
    const layout = generateArea(session.mapSeed, CONTENT_VERSION);
    buildArea(world, "map", session, layout);

    const { lifeMilli, dmgMilli } = monsterTierScale(tier);
    const { e, def } = firstRegular(world);
    const expectedLife = Math.trunc(def.maxLifeFixed * lifeMilli / 1000);
    const expectedDmg = Math.trunc(def.attackDamage.amountFixed * dmgMilli / 1000);

    const h = world.get<Health>(e, "health")!;
    const m = world.get<MonsterC>(e, "monster")!;
    expect(h.maxLife).toBe(expectedLife);
    expect(m.attackDamage).toBe(expectedDmg);
  });

  it("tier 0 leaves stats unchanged", () => {
    const world = new World();
    const session = mapSessionAtTier(0);
    const layout = generateArea(session.mapSeed, CONTENT_VERSION);
    buildArea(world, "map", session, layout);
    const { e, def } = firstRegular(world);
    expect(world.get<Health>(e, "health")!.maxLife).toBe(def.maxLifeFixed);
  });
});

// Local fixture: a world + a map session + the layout it was built against,
// with an overridable mapSeed. Mirrors mapSessionAtTier's field list so the
// two helpers can't drift on what a session needs.
function mapFixture(overrides: Partial<SessionC> & { mapSeed: number }) {
  const session: SessionC = {
    area: "map", atlasSeed: 0, waystoneSeed: 0, areaTier: 1, activeNodeId: "node.ashen_glade",
    completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "",
    ...overrides,
  };
  const world = new World();
  const layout = generateArea(session.mapSeed, CONTENT_VERSION);
  return { world, session, layout };
}

describe("pool-driven spawning", () => {
  const speciesIn = (world: World): string[] =>
    world.query("monster").map((e) => world.get<MonsterC>(e, "monster")!.defId);

  it("spawns only species from the active node's biome pool", () => {
    const { world, session, layout } = mapFixture({ mapSeed: 1234 });
    buildArea(world, "map", session, layout);
    const biome = mapBase(mapBaseIdForNode(session.activeNodeId)).biomeId;
    const allowed = new Set(MONSTER_POOLS[biome].map((e) => e.defId));
    allowed.add("monster.cinder_warden.v1"); // the boss is not from the pool
    for (const id of speciesIn(world)) expect(allowed.has(id), id).toBe(true);
  });

  it("the same map seed spawns the same species in the same order", () => {
    const a = mapFixture({ mapSeed: 99 });
    const b = mapFixture({ mapSeed: 99 });
    buildArea(a.world, "map", a.session, a.layout);
    buildArea(b.world, "map", b.session, b.layout);
    expect(speciesIn(a.world)).toEqual(speciesIn(b.world));
  });

  it("a different map seed can spawn a different mix", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const f = mapFixture({ mapSeed: seed });
      buildArea(f.world, "map", f.session, f.layout);
      seen.add(speciesIn(f.world).join(","));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("a socket holds that archetype's pack count", () => {
    const { world, session, layout } = mapFixture({ mapSeed: 7 });
    buildArea(world, "map", session, layout);
    // Group the non-boss monsters by species and check each count is a whole
    // multiple of that archetype's pack count.
    const counts = new Map<string, number>();
    for (const e of world.query("monster")) {
      if (world.has(e, "boss")) continue;
      const id = world.get<MonsterC>(e, "monster")!.defId;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const [id, n] of counts) {
      const def = MONSTERS.get(id)!;
      expect(n % PACK_COUNT[def.archetype], id).toBe(0);
    }
  });

  it("exactly one rare, and it is still on the last layout socket", () => {
    const { world, session, layout } = mapFixture({ mapSeed: 21 });
    buildArea(world, "map", session, layout);
    const rares = world.query("monster").filter((e) => world.get<MonsterC>(e, "monster")!.rare === 1);
    expect(rares.length).toBe(1);
    const last = layout.spawnSockets[layout.spawnSockets.length - 1]!;
    const pos = world.get<Position>(rares[0]!, "position")!;
    expect(pos.x).toBe(fp(last.x));
    expect(pos.y).toBe(fp(last.y));
  });
});
