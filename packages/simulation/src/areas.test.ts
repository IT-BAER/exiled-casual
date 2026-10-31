import { describe, it, expect } from "vitest";
import { generateArea, brazierSpotsFor, SPAWN_SAFE_RADIUS } from "@exiled/mapgen";
import { fp } from "@exiled/fixed-point";
import { CONTENT_VERSION, MONSTERS, MONSTER_POOLS, PACK_COUNT, bossFor, mapBase, hideoutFootprints } from "@exiled/content-runtime";
import { familyOf, mapBaseIdForNode, monsterTierScale } from "@exiled/rules";
import type { MonsterDef } from "@exiled/content-schema";
import { World, type Entity } from "./ecs.js";
import { areaCollision, buildArea, spillContainer, HIDEOUT_SPAWN } from "./areas.js";
import { gridCollision } from "./collision.js";
import type { SessionC, Health, MonsterC, Position, ContainerC, ItemC } from "./components.js";
import { grammarForNode } from "./systems/area-transition.js";

function mapSessionAtTier(tier: number): SessionC {
  return {
    area: "map", atlasSeed: 0, mapSeed: 7, waystoneSeed: 0, areaTier: tier, activeNodeId: "node.the_wrackline",
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
    area: "map", atlasSeed: 0, waystoneSeed: 0, areaTier: 1, activeNodeId: "node.the_wrackline",
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
    allowed.add(bossFor(biome).id); // the boss is the biome's, and not from its pool
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

  // Retention report 3.1: a level 1 player died to the Rotting Behemoth, the
  // swamp's heavy the strand borrows, on his first map. Its first clear is his.
  it("the first clear of the first Atlas node fields no heavy, and its next clear does", () => {
    const heavies = (completedNodes: string[]) => {
      let n = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const world = new World();
        const session = { ...mapSessionAtTier(1), mapSeed: seed, completedNodes };
        buildArea(world, "map", session, generateArea(seed, CONTENT_VERSION, grammarForNode(session.activeNodeId)));
        n += world.query("monster").filter((e) => !world.has(e, "boss")
          && MONSTERS.get(world.get<MonsterC>(e, "monster")!.defId)!.archetype === "heavy").length;
      }
      return n;
    };
    expect(heavies([])).toBe(0);
    expect(heavies(["node.the_wrackline"])).toBeGreaterThan(0);
  }, 20_000);

  // Its rares now stand at the first pack (H1): on a level 1 map they keep their
  // life, element and name, and hit for half again a normal monster, not 2-3x.
  it("the first clear's rares hit for 150% of their kind, a later clear's for more", () => {
    const ratios = (completedNodes: string[]) => {
      const out: number[] = [];
      for (let seed = 1; seed <= 10; seed++) {
        const world = new World();
        const session = { ...mapSessionAtTier(0), mapSeed: seed, completedNodes };
        buildArea(world, "map", session, generateArea(seed, CONTENT_VERSION, grammarForNode(session.activeNodeId)));
        for (const e of world.query("monster")) {
          const m = world.get<MonsterC>(e, "monster")!;
          if (m.rare === 1) out.push(m.attackDamage / MONSTERS.get(m.defId)!.attackDamage.amountFixed);
        }
      }
      return out;
    };
    const first = ratios([]);
    expect(first.length).toBeGreaterThan(0);
    for (const r of first) expect(r).toBeCloseTo(1.5, 2);
    for (const r of ratios(["node.the_wrackline"])) expect(r).toBeGreaterThanOrEqual(2);
  }, 20_000);

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

  it("every reward anchor stands a closed container, not loot on the floor", () => {
    const { world, session, layout } = mapFixture({ mapSeed: 7 });
    buildArea(world, "map", session, layout);
    const rewards = layout.objectiveAnchors.filter((a) => a.id.startsWith("reward."));
    expect(rewards.length).toBeGreaterThan(0);
    const containers = world.query("container", "position");
    expect(containers.length).toBe(rewards.length);
    // Nothing pays at build any more: the roll waits for the lid.
    expect(world.query("item").length).toBe(0);
    for (const r of rewards) {
      const near = containers.some((e) => {
        const p = world.get<Position>(e, "position")!;
        // On its anchor, or nudged off a door it would shut (two units at most).
        return Math.hypot(p.x - fp(r.x), p.y - fp(r.y)) <= fp(2);
      });
      expect(near, `${r.id} has no container`).toBe(true);
    }
    for (const e of containers) {
      const c = world.get<ContainerC>(e, "container")!;
      expect(["chest", "barrel", "crate"]).toContain(c.look);
      expect(c.opened).toBe(0);
    }
  });

  it("different anchors wear different furniture, not one chest stamped everywhere", () => {
    const looks = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) {
      const f = mapFixture({ mapSeed: seed });
      buildArea(f.world, "map", f.session, f.layout);
      for (const e of f.world.query("container"))
        looks.add(f.world.get<ContainerC>(e, "container")!.look);
    }
    expect(looks.size).toBeGreaterThan(1);
  });

  const spillAll = (w: World, session: SessionC) => {
    for (const e of w.query("container", "position")) {
      const c = w.get<ContainerC>(e, "container")!;
      const p = w.get<Position>(e, "position")!;
      spillContainer(w, session, c.key, p.x, p.y);
    }
  };

  it("a container favours the opener's class family, 40/30/30", () => {
    const w = new World();
    const session = { ...mapSessionAtTier(5), classId: "class.ironsworn" };
    for (let i = 0; i < 3000; i++) spillContainer(w, session, `cache:family:${i}`, 0, 0);
    const n: Record<string, number> = {};
    for (const e of w.query("item")) {
      const id = w.get<ItemC>(e, "item")!.item.baseId;
      if (id.startsWith("base.")) n[familyOf(id)] = (n[familyOf(id)] ?? 0) + 1;
    }
    const total = n.ironsworn! + n.stalker! + n.ember!;
    expect(Math.abs(n.ironsworn! / total - 0.4)).toBeLessThan(0.03);
    expect(Math.abs(n.stalker! / total - 0.3)).toBeLessThan(0.03);
    expect(Math.abs(n.ember! / total - 0.3)).toBeLessThan(0.03);
  });

  it("opened containers pay with variance, not the same handful every time", () => {
    const counts = new Set<number>();
    for (let seed = 1; seed <= 25; seed++) {
      const f = mapFixture({ mapSeed: seed });
      buildArea(f.world, "map", f.session, f.layout);
      spillAll(f.world, f.session);
      counts.add(f.world.query("item").length);
    }
    // docs/09: a cache that always pays the same amount is a vending machine.
    expect(counts.size, "every map paid the same number of items").toBeGreaterThan(2);
  });

  const groundItems = (w: World) => w.query("item", "position").map((e) =>
    JSON.stringify([w.get<Position>(e, "position"), w.get(e, "item")]));

  it("replays identically: the same map, entered on the same tick, pays the same loot", () => {
    const a = mapFixture({ mapSeed: 99 });
    const b = mapFixture({ mapSeed: 99 });
    buildArea(a.world, "map", a.session, a.layout, 240);
    buildArea(b.world, "map", b.session, b.layout, 240);
    spillAll(a.world, a.session);
    spillAll(b.world, b.session);
    expect(groundItems(a.world)).toEqual(groundItems(b.world));
  });

  it("re-rolls the caches on every entry — loot is not a property of the map", () => {
    // PoE rolls a drop when it drops: a kill uses the killing blow's own state,
    // and a strongbox rolls its contents when it is opened. Ours is seeded off
    // the tick the area is built on for the same reason. mapSeedFor(stone, node)
    // is a pure function, so seeding the caches off the map alone would hand the
    // same stone the same floor forever, and the find is only a find once.
    const seen = new Set<string>();
    for (const tick of [0, 97, 1000, 54321]) {
      const f = mapFixture({ mapSeed: 99 });
      buildArea(f.world, "map", f.session, f.layout, tick);
      spillAll(f.world, f.session);
      seen.add(groundItems(f.world).join("|"));
    }
    expect(seen.size, "every entry laid out the same loot").toBe(4);
  });

  it("every monster spawns where its own body fits", () => {
    const stuck: string[] = [];
    for (const node of ["node.the_wrackline", "node.emberfall", "node.ossuary_steps", "node.cinder_vault"]) {
      for (let seed = 0; seed < 30; seed++) {
        const world = new World();
        const session = { ...mapSessionAtTier(1), mapSeed: seed, activeNodeId: node };
        const layout = generateArea(seed, CONTENT_VERSION, grammarForNode(node));
        buildArea(world, "map", session, layout);
        const col = areaCollision(world, "map", layout);
        for (const e of world.query("monster", "position")) {
          const p = world.get<Position>(e, "position")!;
          const r = MONSTERS.get(world.get<MonsterC>(e, "monster")!.defId)!.radiusFixed;
          if (!col.isWalkable(p.x, p.y, r)) stuck.push(`${node} seed ${seed} ${world.get<MonsterC>(e, "monster")!.defId}`);
        }
      }
    }
    expect(stuck).toEqual([]);
  }, 20_000);

  it("no two monsters of a map spawn on the same spot", () => {
    const stacked: string[] = [];
    for (const node of ["node.the_wrackline", "node.emberfall", "node.ossuary_steps", "node.cinder_vault"]) {
      for (let seed = 0; seed < 30; seed++) {
        const world = new World();
        const session = { ...mapSessionAtTier(1), mapSeed: seed, activeNodeId: node };
        buildArea(world, "map", session, generateArea(seed, CONTENT_VERSION, grammarForNode(node)));
        const seen = new Set<string>();
        for (const e of world.query("monster", "position")) {
          const p = world.get<Position>(e, "position")!;
          const at = `${p.x},${p.y}`;
          if (seen.has(at)) stacked.push(`${node} seed ${seed} at ${at}`);
          seen.add(at);
        }
      }
    }
    expect(stacked).toEqual([]);
  }, 20_000);

  // PoE2's rare-monster density (docs/09 section 2): two or three rares a map,
  // the first on the first pack the player meets, the rest spread down the route.
  it("two or three rares in every grammar, the first on the first fielded pack outside the safe radius", () => {
    const counts = new Set<number>();
    const bad: string[] = [];
    // coast, open-field (desert, forest), loop, sunken-ruins
    for (const node of ["node.the_wrackline", "node.emberfall", "node.cinder_vault", "node.blackmire", "node.thornwake"]) {
      for (let seed = 0; seed < 30; seed++) {
        const world = new World();
        const session = { ...mapSessionAtTier(1), mapSeed: seed, activeNodeId: node };
        const layout = generateArea(seed, CONTENT_VERSION, grammarForNode(node));
        buildArea(world, "map", session, layout);
        const start = layout.objectiveAnchors.find((a) => a.id === "start")!;
        // A monster's socket: the nearest one, since a pack stands round its own.
        const socketOf = (e: Entity): number => {
          const p = world.get<Position>(e, "position")!;
          let best = -1, bestD = Infinity;
          layout.spawnSockets.forEach((s, i) => {
            const d = Math.hypot(p.x / fp(1) - s.x, p.y / fp(1) - s.y);
            if (d < bestD) { bestD = d; best = i; }
          });
          return best;
        };
        const packs = world.query("monster").filter((e) => !world.has(e, "boss"));
        const rares = packs.filter((e) => world.get<MonsterC>(e, "monster")!.rare === 1);
        counts.add(rares.length);
        const at = `${node} seed ${seed}`;
        if (rares.length < 2 || rares.length > 3) { bad.push(`${at}: ${rares.length} rares`); continue; }
        const fielded = [...new Set(packs.map(socketOf))].sort((a, b) => a - b);
        const sockets = rares.map(socketOf).sort((a, b) => a - b);
        if (sockets[0] !== fielded[0]) bad.push(`${at}: first rare on socket ${sockets[0]}, first pack on ${fielded[0]}`);
        if (new Set(sockets).size !== sockets.length) bad.push(`${at}: two rares share a socket`);
        // Spread: consecutive rares at least a quarter of the fielded packs apart.
        const rank = sockets.map((s) => fielded.indexOf(s));
        for (let k = 1; k < rank.length; k++) {
          if (rank[k]! - rank[k - 1]! < Math.floor(fielded.length / 4)) bad.push(`${at}: rares bunched ${rank.join(",")} of ${fielded.length}`);
        }
        for (const e of rares) {
          const p = world.get<Position>(e, "position")!;
          if (Math.hypot(p.x / fp(1) - start.x, p.y / fp(1) - start.y) < SPAWN_SAFE_RADIUS) bad.push(`${at}: a rare inside the safe radius`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect([...counts].sort()).toEqual([2, 3]);
  }, 30_000);

  // docs/09: variance is the mechanism. Each rare rolls its own theme, so two
  // rares of one size in one map can ask for different resistances.
  it("each rare rolls its own element, the same seed the same ones", () => {
    const rares = (seed: number, node: string) => {
      const world = new World();
      const session = { ...mapSessionAtTier(1), mapSeed: seed, activeNodeId: node, completedNodes: [node] };
      buildArea(world, "map", session, generateArea(seed, CONTENT_VERSION, grammarForNode(node)));
      return world.query("monster").map((e) => world.get<MonsterC>(e, "monster")!).filter((m) => m.rare === 1)
        .map((m) => ({ big: ["brute", "heavy"].includes(MONSTERS.get(m.defId)!.archetype), type: m.attackType }));
    };
    let mixed = 0;
    for (const node of ["node.the_wrackline", "node.emberfall", "node.cinder_vault"]) {
      for (let seed = 0; seed < 30; seed++) {
        const r = rares(seed, node);
        expect(rares(seed, node)).toEqual(r);
        for (const big of [true, false]) {
          if (new Set(r.filter((x) => x.big === big).map((x) => x.type)).size > 1) mixed++;
        }
      }
    }
    expect(mixed).toBeGreaterThan(0);
  }, 30_000);

  it("one whole pack is magic: one species, never the rare's pack, the same pack for the same seed", () => {
    const magicOf = (mapSeed: number) => {
      const { world, session, layout } = mapFixture({ mapSeed });
      buildArea(world, "map", session, layout);
      return world.query("monster").filter((e) => world.get<MonsterC>(e, "monster")!.magic === 1)
        .map((e) => ({ m: world.get<MonsterC>(e, "monster")!, p: world.get<Position>(e, "position")! }));
    };
    for (let seed = 1; seed <= 12; seed++) {
      const magic = magicOf(seed);
      expect(magic.length, `seed ${seed}`).toBeGreaterThan(0);
      expect(new Set(magic.map((x) => x.m.defId)).size, `seed ${seed}`).toBe(1);
      for (const x of magic) expect(x.m.rare).toBe(0);
      expect(magicOf(seed).map((x) => `${x.p.x},${x.p.y}`)).toEqual(magic.map((x) => `${x.p.x},${x.p.y}`));
    }
  });

  it("a magic monster carries twice the life of its normal kin in the same map", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { world, session, layout } = mapFixture({ mapSeed: seed });
      buildArea(world, "map", session, layout);
      const mons = world.query("monster").filter((e) => !world.has(e, "boss"))
        .map((e) => ({ m: world.get<MonsterC>(e, "monster")!, h: world.get<Health>(e, "health")! }));
      const magic = mons.find((x) => x.m.magic === 1)!;
      const kin = mons.find((x) => x.m.magic !== 1 && x.m.rare === 0 && x.m.defId === magic.m.defId);
      if (!kin) continue;
      expect(magic.h.maxLife).toBe(2 * kin.h.maxLife);
      return;
    }
    throw new Error("no seed in 1..30 fields a magic pack beside a normal pack of its species");
  });
});

describe("areaCollision", () => {
  it("hideout: the furniture is solid and the arrival spot is not", () => {
    const world = new World();
    const session: SessionC = {
      area: "hideout", atlasSeed: 0, mapSeed: 1, waystoneSeed: 0, areaTier: 0,
      activeNodeId: "", completedNodes: [], portalsLeft: 0, mapOpen: 0, pendingArea: "",
    };
    const layout = generateArea(1, CONTENT_VERSION);
    buildArea(world, "hideout", session, layout);
    const col = areaCollision(world, "hideout", layout);

    // Every drawn piece except the rug stops a body.
    for (const f of hideoutFootprints()) {
      expect(col.isWalkable(fp(f.x), fp(f.z), 0), `${f.x},${f.z}`).toBe(false);
    }
    // The rug is floor: it is the one thing standing where the player lands.
    expect(col.isWalkable(HIDEOUT_SPAWN.x, HIDEOUT_SPAWN.y, fp(0.5))).toBe(true);
    // The shops are objects too, and a portal is a doorway rather than an object.
    expect(col.isWalkable(fp(-4.95), fp(-2.121), fp(0.5))).toBe(false);
    expect(col.isWalkable(fp(2.121), fp(4.95), fp(0.5))).toBe(false);
  });

  it("hideout: the floor ends past the furniture, so a walk away cannot lose the portals", () => {
    const world = new World();
    const session: SessionC = {
      area: "hideout", atlasSeed: 0, mapSeed: 1, waystoneSeed: 0, areaTier: 0,
      activeNodeId: "", completedNodes: [], portalsLeft: 0, mapOpen: 0, pendingArea: "",
    };
    const layout = generateArea(1, CONTENT_VERSION);
    buildArea(world, "hideout", session, layout);
    const col = areaCollision(world, "hideout", layout);
    // Screen (sx, sy) -> world (x, y), the turn hideout.ts composes in.
    const at = (sx: number, sy: number) => ({ x: fp((sx - sy) * Math.SQRT1_2), y: fp((sx + sy) * Math.SQRT1_2) });

    // Far off in every screen direction is no longer floor.
    for (const [sx, sy] of [[0, -12], [0, 14], [-14, 0], [14, 0], [45, -45]] as const) {
      const p = at(sx, sy);
      expect(col.isWalkable(p.x, p.y, fp(0.5)), `${sx},${sy}`).toBe(false);
    }
    // Everything the room is for stays reachable: the spot in front of every portal,
    // the stash and the vendor (approached from the room's side), and the corners
    // the columns stand in.
    for (const e of world.query("interactable")) {
      const p = world.get<Position>(e, "position")!;
      const toward = (v: number) => v - Math.sign(v) * fp(1.2);
      expect(col.isWalkable(toward(p.x), toward(p.y), fp(0.5)), `${p.x},${p.y}`).toBe(true);
    }
    for (const [sx, sy] of [[-9.6, 0], [9.6, 0], [0, 8], [0, -5]] as const) {
      const p = at(sx, sy);
      expect(col.isWalkable(p.x, p.y, fp(0.5)), `${sx},${sy}`).toBe(true);
    }
  });

  it("map: a brazier is solid where the renderer stands it", () => {
    const { world, session, layout } = mapFixture({ mapSeed: 7 });
    buildArea(world, "map", session, layout);
    const col = areaCollision(world, "map", layout);
    const spots = brazierSpotsFor(layout);
    expect(spots.length).toBeGreaterThan(0);
    for (const s of spots) {
      expect(col.isWalkable(fp(s.x), fp(s.z), 0), `${s.x},${s.z}`).toBe(false);
    }
  });

  it("map: everything a map fields has a nav route from the start", () => {
    // Strongrooms whose door held a container and a bowl 1.5 units apart, a fen pocket
    // with a bowl in its 1.5-unit mouth, and three maps where a bowl left the boss
    // reachable only between cell centres, where the nav (and every chase) cannot go.
    const cases = [["node.cinder_vault", 1463906733], ["node.blackmire", 707292778], ["node.blackmire", 3830032802],
      ["node.blackmire", 94326951], ["node.cinder_vault", 3750417493], ["node.cinder_vault", 4057393686]] as const;
    const shut: string[] = [];
    for (const [node, mapSeed] of cases) {
      const layout = generateArea(mapSeed, CONTENT_VERSION, grammarForNode(node));
      const { world, session } = mapFixture({ mapSeed, activeNodeId: node });
      buildArea(world, "map", session, layout);
      const col = areaCollision(world, "map", layout);
      const start = layout.objectiveAnchors.find((a) => a.id === "start")!;
      // What the map actually fields: every monster (boss included) and every container.
      const targets = [...world.query("monster", "position"), ...world.query("container", "position")].map((e) => {
        const p = world.get<Position>(e, "position")!;
        return { id: `${world.has(e, "container") ? "container" : world.get<MonsterC>(e, "monster")!.defId}@${p.x},${p.y}`, x: p.x / 1000, y: p.y / 1000 };
      });
      // Some standable cell within reach of it has a nav route back to the start (a
      // container's own centre is solid, so the target itself cannot be the question).
      const g = layout.grid;
      const reachable = (t: { x: number; y: number }) => {
        const c0 = Math.round((t.x - g.originX) / g.cellSize), r0 = Math.round((t.y - g.originY) / g.cellSize);
        for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) {
          const x = fp(g.originX + (c0 + dc) * g.cellSize), y = fp(g.originY + (r0 + dr) * g.cellSize);
          if (col.isWalkable(x, y, fp(0.5)) && col.nav!.waypoint(x, y, fp(start.x), fp(start.y), fp(0.5))) return true;
        }
        return false;
      };
      for (const t of targets) if (!reachable(t)) shut.push(`${node} ${mapSeed} ${t.id}`);
    }
    expect(shut).toEqual([]);
  });

  it("map: no pack member stands inside the start's safe radius", () => {
    const near: string[] = [];
    for (const node of ["node.the_wrackline", "node.emberfall", "node.cinder_vault", "node.blackmire", "node.thornwake"]) {
      for (let seed = 1; seed <= 15; seed++) {
        const mapSeed = seed * 104729;
        const layout = generateArea(mapSeed, CONTENT_VERSION, grammarForNode(node));
        const { world, session } = mapFixture({ mapSeed, activeNodeId: node });
        buildArea(world, "map", session, layout);
        const start = layout.objectiveAnchors.find((a) => a.id === "start")!;
        const from = (x: number, y: number) => Math.hypot(x - start.x, y - start.y);
        for (const e of world.query("monster")) {
          const p = world.get<Position>(e, "position")!;
          const d = from(p.x / 1000, p.y / 1000);
          if (d < SPAWN_SAFE_RADIUS) near.push(`${node} ${mapSeed}: ${d.toFixed(1)}`);
        }
      }
    }
    expect(near).toEqual([]);
  }, 20_000);

  it("map: a container is solid, and its walls are still walls", () => {
    const { world, session, layout } = mapFixture({ mapSeed: 7 });
    buildArea(world, "map", session, layout);
    const col = areaCollision(world, "map", layout);
    const bare = gridCollision(layout.grid);

    const containers = world.query("container");
    expect(containers.length).toBeGreaterThan(0);
    for (const e of containers) {
      const p = world.get<Position>(e, "position")!;
      expect(bare.isWalkable(p.x, p.y, 0), "mapgen puts a container on floor").toBe(true);
      expect(col.isWalkable(p.x, p.y, 0), "and it is not floor any more").toBe(false);
      // One body-width clear of it and the floor is floor again.
      expect(col.isWalkable(p.x + fp(1.4), p.y, 0) || col.isWalkable(p.x - fp(1.4), p.y, 0)).toBe(true);
    }
  });

  it("map: a container steps out of a pool that floods its anchor", () => {
    const { world, session, layout } = mapFixture({ mapSeed: 7 });
    const g = layout.grid;
    const water = new Uint8Array(g.cols * g.rows);
    const anchor = layout.objectiveAnchors.find((a) => a.id.startsWith("reward."))!;
    const c0 = Math.round((anchor.x - g.originX) / g.cellSize), r0 = Math.round((anchor.y - g.originY) / g.cellSize);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) water[(r0 + dr) * g.cols + c0 + dc] = 1;
    g.water = water;
    buildArea(world, "map", session, layout);
    for (const e of world.query("container")) {
      const p = world.get<Position>(e, "position")!;
      const cx = Math.round((p.x / 1000 - g.originX) / g.cellSize), cy = Math.round((p.y / 1000 - g.originY) / g.cellSize);
      expect(water[cy * g.cols + cx], `container at ${cx},${cy}`).toBe(0);
    }
  });

  /**
   * The containers stand up after the generator picked where the fights are, so
   * one could be dropped on a body — and a body inside a blocker cannot move in
   * any direction for the rest of the run.
   *
   * Asked as a DELTA against the same layout's bare walls, not as an absolute:
   * some sockets already hand a wide body a spot its own radius does not fit in
   * (seed 3 stands a 0.85 boar in stone), which is the generator's business and
   * older than any of this.
   */
  it("no body that could stand there before is walled in by the furniture", () => {
    for (const mapSeed of [3, 7, 21, 99, 1234]) {
      const { world, session, layout } = mapFixture({ mapSeed });
      buildArea(world, "map", session, layout);
      const col = areaCollision(world, "map", layout);
      const bare = gridCollision(layout.grid);
      for (const e of world.query("monster", "position")) {
        const p = world.get<Position>(e, "position")!;
        const m = world.get<MonsterC>(e, "monster")!;
        const r = MONSTERS.get(m.defId)!.radiusFixed;
        if (!bare.isWalkable(p.x, p.y, r)) continue;
        expect(col.isWalkable(p.x, p.y, r), `seed ${mapSeed} monster ${m.defId}`).toBe(true);
      }
      const start = layout.objectiveAnchors.find((a) => a.id === "start")!;
      expect(col.isWalkable(fp(start.x), fp(start.y), fp(0.5)), `seed ${mapSeed} start`).toBe(true);
    }
  });
});
