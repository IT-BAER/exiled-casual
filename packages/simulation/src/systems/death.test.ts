import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { Simulation } from "../loop";
import { registerDeath } from "./death";
import { START_LEVEL, waystoneMods } from "@exiled/rules";
import { WISDOM_SCROLL_BASE_ID, isCurrency } from "@exiled/content-runtime";
import type { World } from "../ecs";
import type { SessionC, ProgressC } from "../components";

/** Ground equipment only: any kill can also pay currency. */
const equipmentDrops = (w: World) =>
  w.query("item", "position").filter((e) => !isCurrency((w.get(e, "item") as { item: { baseId: string } }).item as never));

/** Everything a kill put on the ground, currency included. */
const allDrops = (w: World) => w.query("item", "position");

describe("registerDeath", () => {
  it("destroys a monster with life <= 0", () => {
    const sim = new Simulation();
    registerDeath(sim);
    const { world } = sim;

    const m = world.create();
    world.set(m, "monster", { defId: "test", state: "idle", moveSpeed: 0, bodyRadius: 0,
      attackRange: 0, attackCooldownTicks: 0, attackDamage: 0, attackType: 1, attackReadyTick: 0, rare: 0, summoned: 0 });
    world.set(m, "health", { life: 0, maxLife: fp(40) });

    sim.step();
    expect(world.alive.has(m)).toBe(false);
  });

  it("respawns a player at origin with full life/mana when life <= 0", () => {
    const sim = new Simulation();
    registerDeath(sim);
    const { world } = sim;

    const p = world.create();
    world.set(p, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
    world.set(p, "health", { life: 0, maxLife: fp(100) });
    world.set(p, "mana", { mana: fp(10), maxMana: fp(60), regen: 0 });
    world.set(p, "position", { x: fp(5), y: fp(5) });

    sim.step();

    expect(world.alive.has(p)).toBe(true);
    expect(world.get<{ life: number; maxLife: number }>(p, "health")!.life).toBe(fp(100));
    expect(world.get<{ mana: number; maxMana: number }>(p, "mana")!.mana).toBe(fp(60));
    expect(world.get<{ x: number; y: number }>(p, "position")).toEqual({ x: 0, y: 0 });
  });

  it("respawn clears stale moveTarget, moveDir, and ailment", () => {
    const sim = new Simulation();
    registerDeath(sim);
    const { world } = sim;
    const p = world.create();
    world.set(p, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
    world.set(p, "health", { life: 0, maxLife: fp(100) });
    world.set(p, "mana", { mana: fp(10), maxMana: fp(60), regen: 0 });
    world.set(p, "position", { x: fp(5), y: fp(5) });
    world.set(p, "moveTarget", { x: fp(9), y: fp(9), active: 1 });
    world.set(p, "moveDir", { dx: 1, dy: 0 });
    world.set(p, "ailment", { kind: "burning", stacks: 3, dps: fp(8), expiryTick: 999 });
    sim.step();
    expect(world.get<{ active: number }>(p, "moveTarget")!.active).toBe(0);
    expect(world.get<{ dx: number; dy: number }>(p, "moveDir")).toEqual({ dx: 0, dy: 0 });
    expect(world.get(p, "ailment")).toBeUndefined();
    // existing respawn guarantees still hold:
    expect(world.get<{ life: number }>(p, "health")!.life).toBe(fp(100));
    expect(world.get<{ x: number; y: number }>(p, "position")).toEqual({ x: 0, y: 0 });
  });

  // ── Session-aware death tests ────────────────────────────────────────────

  function makePlayerWithSession(area: "hideout" | "map", portalsLeft: number) {
    const sim = new Simulation();
    registerDeath(sim);
    const { world } = sim;

    const p = world.create();
    world.set(p, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
    world.set(p, "health", { life: 0, maxLife: fp(100) });
    world.set(p, "mana", { mana: fp(0), maxMana: fp(60), regen: 0 });
    world.set(p, "position", { x: fp(3), y: fp(3) });

    const sessionE = world.create();
    world.set<SessionC>(sessionE, "session", {
      area, atlasSeed: 0, areaTier: 0, activeNodeId: "", completedNodes: [],
      mapSeed: 0, waystoneSeed: 0, waystones: [], portalsLeft, mapOpen: 1, pendingArea: "",
    });

    return { sim, world, p, sessionE };
  }

  it("map death decrements portalsLeft and sets pendingArea='hideout'", () => {
    const { sim, world, sessionE } = makePlayerWithSession("map", 6);
    sim.step();
    const session = world.get<SessionC>(sessionE, "session")!;
    expect(session.portalsLeft).toBe(5);
    expect(session.pendingArea).toBe("hideout");
  });

  it("6th map death drives portalsLeft to 0 and sets mapOpen=0", () => {
    const { sim, world, sessionE } = makePlayerWithSession("map", 1);
    sim.step();
    const session = world.get<SessionC>(sessionE, "session")!;
    expect(session.portalsLeft).toBe(0);
    expect(session.mapOpen).toBe(0);
    expect(session.pendingArea).toBe("hideout");
  });

  it("hideout death does NOT decrement portalsLeft", () => {
    const { sim, world, sessionE } = makePlayerWithSession("hideout", 6);
    sim.step();
    const session = world.get<SessionC>(sessionE, "session")!;
    expect(session.portalsLeft).toBe(6);
    expect(session.pendingArea).toBe("");
  });

  it("does not touch a monster with life > 0", () => {
    const sim = new Simulation();
    registerDeath(sim);
    const { world } = sim;

    const m = world.create();
    world.set(m, "monster", { defId: "test", state: "idle", moveSpeed: 0, bodyRadius: 0,
      attackRange: 0, attackCooldownTicks: 0, attackDamage: 0, attackType: 1, attackReadyTick: 0, rare: 0, summoned: 0 });
    world.set(m, "health", { life: fp(1), maxLife: fp(40) });

    sim.step();
    expect(world.alive.has(m)).toBe(true);
  });

  // ── Atlas node completion on boss death ─────────────────────────────────

  function makeBossDeath(area: "hideout" | "map", activeNodeId: string, completedNodes: string[]) {
    const sim = new Simulation();
    registerDeath(sim);
    const { world } = sim;

    const sessionE = world.create();
    world.set<SessionC>(sessionE, "session", {
      area, atlasSeed: 0, mapSeed: 0, waystoneSeed: 0, waystones: [], areaTier: 5, activeNodeId, completedNodes,
      portalsLeft: 6, mapOpen: 1, pendingArea: "",
    });

    const boss = world.create();
    world.set(boss, "monster", { defId: "boss", state: "idle", moveSpeed: 0, bodyRadius: 0,
      attackRange: 0, attackCooldownTicks: 0, attackDamage: 0, attackType: 1, attackReadyTick: 0, rare: 0, summoned: 0 });
    world.set(boss, "health", { life: 0, maxLife: fp(500) });
    world.set(boss, "boss", { phase: 1, nextAbilityTick: 0, spawnX: 0, spawnY: 0, rootedUntilTick: 0 });

    return { sim, world, sessionE, boss };
  }

  it("marks the active node completed when the map boss dies", () => {
    const { sim, world, sessionE } = makeBossDeath("map", "node.ashen_glade", []);
    sim.step();
    expect(world.get<SessionC>(sessionE, "session")!.completedNodes).toContain("node.ashen_glade");
  });

  it("does not double-add an already-completed node", () => {
    const { sim, world, sessionE } = makeBossDeath("map", "node.ashen_glade", ["node.ashen_glade"]);
    sim.step();
    expect(world.get<SessionC>(sessionE, "session")!.completedNodes).toEqual(["node.ashen_glade"]);
  });

  it("does not complete a node when a non-boss monster dies", () => {
    const { sim, world, sessionE } = makeBossDeath("map", "node.ashen_glade", []);
    world.remove(world.query("boss")[0]!, "boss"); // now an ordinary monster at 0 life
    sim.step();
    expect(world.get<SessionC>(sessionE, "session")!.completedNodes).toEqual([]);
  });

  // ── Item drops on boss/rare death ────────────────────────────────────────

  it("drops one ground item when a rare monster dies in a map", () => {
    const sim = new Simulation();
    registerDeath(sim);
    const w = sim.world;
    const s = w.create();
    w.set(s, "session", { area: "map", atlasSeed: 1, mapSeed: 7, waystoneSeed: 0, waystones: [], areaTier: 5, activeNodeId: "node.ashen_glade", completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "" });
    const m = w.create();
    w.set(m, "position", { x: 100, y: 200 });
    w.set(m, "health", { life: 0, maxLife: 40 });
    w.set(m, "monster", { defId: "d", moveSpeed: 0, bodyRadius: 0, attackRange: 0, attackCooldownTicks: 0, attackDamage: 0, attackType: 1, attackReadyTick: 0, state: "idle", rare: 1, summoned: 0 });
    sim.step([]);
    const groundItems = equipmentDrops(w);
    expect(groundItems.length).toBe(1);
    const ic = w.get(groundItems[0]!, "item") as { item: { itemLevel: number }; w: number; h: number };
    expect(ic.item.itemLevel).toBe(71); // 64 + tier 5, +2 because a rare monster drops gear two levels above itself
    expect(ic.w).toBeGreaterThan(0);
  });

  /** First seed whose stone carries the area quantity prefix. */
  const QUANTITY_STONE = (() => {
    for (let s = 1; s < 100_000; s++) if (waystoneMods(s).some((m) => m.id === "quantity")) return s;
    throw new Error("no stone rolls quantity");
  })();

  /** A dead monster in a tier-5 map, boss or rare, ready for one `sim.step`. */
  function makeDrop(opts: { boss: boolean; rare?: boolean; mapSeed?: number; waystoneSeed?: number }) {
    const sim = new Simulation();
    registerDeath(sim);
    const w = sim.world;
    const s = w.create();
    w.set(s, "session", { area: "map", atlasSeed: 1, mapSeed: opts.mapSeed ?? 7, waystoneSeed: opts.waystoneSeed ?? 0, waystones: [], areaTier: 5, activeNodeId: "node.ashen_glade", completedNodes: ["node.ashen_glade"], portalsLeft: 6, mapOpen: 1, pendingArea: "" });
    const m = w.create();
    w.set(m, "position", { x: fp(3), y: fp(-2) });
    w.set(m, "health", { life: 0, maxLife: 40 });
    w.set(m, "monster", { defId: "d", moveSpeed: 0, bodyRadius: 0, attackRange: 0, attackCooldownTicks: 0, attackDamage: 0, attackType: 1, attackReadyTick: 0, state: "idle", rare: opts.boss || opts.rare === false ? 0 : 1, summoned: 0 });
    if (opts.boss) w.set(m, "boss", { phase: 1, nextAbilityTick: 0, spawnX: 0, spawnY: 0, rootedUntilTick: 0 });
    return { sim, w };
  }

  const dropped = (w: World) =>
    equipmentDrops(w).map((e) => w.get(e, "item") as { item: { rarity: string } });

  it("a boss pays a burst sized by the quantity channels", () => {
    // 2850% increased quantity against a 14% base is 4.13 expected items, so
    // PoE's overflow rule pays four every time and five 13% of the time.
    const { sim, w } = makeDrop({ boss: true });
    sim.step([]);
    expect(allDrops(w).length).toBeGreaterThanOrEqual(4);
    expect(allDrops(w).length).toBeLessThanOrEqual(5);
  });

  it("a boss cannot pay out an all-normal burst", () => {
    // Rule 4 of docs/09: the map closes on a guaranteed payout. The other items
    // stay fully variable, so this raises the floor without narrowing variance.
    const { sim, w } = makeDrop({ boss: true });
    sim.step([]);
    expect(dropped(w).some((d) => d.item.rarity !== "normal")).toBe(true);
  });

  it("scatters the burst instead of stacking it on the corpse", () => {
    const { sim, w } = makeDrop({ boss: true });
    sim.step([]);
    const seen = new Set(
      allDrops(w).map((e) => {
        const p = w.get(e, "position") as { x: number; y: number };
        return `${p.x},${p.y}`;
      }),
    );
    expect(seen.size).toBe(allDrops(w).length);
  });

  it("a rare pays two items, and sometimes three", () => {
    // 1400% increased quantity: 2.1 expected, so two guaranteed plus a coin flip.
    const { sim, w } = makeDrop({ boss: false });
    sim.step([]);
    expect(allDrops(w).length).toBeGreaterThanOrEqual(2);
    expect(allDrops(w).length).toBeLessThanOrEqual(3);
  });

  it("a normal monster usually pays nothing, and sometimes pays once", () => {
    const counts = Array.from({ length: 60 }, (_, i) => {
      const { sim, w } = makeDrop({ boss: false, rare: false, mapSeed: i + 1 });
      sim.step([]);
      return allDrops(w).length;
    });
    expect(Math.max(...counts)).toBe(1);
    expect(counts.filter((c) => c === 0).length).toBeGreaterThan(counts.length / 2);
  });

  it("a richer stone pays more", () => {
    const lean = Array.from({ length: 40 }, (_, i) => {
      const { sim, w } = makeDrop({ boss: false, mapSeed: i + 1 });
      sim.step([]);
      return allDrops(w).length;
    }).reduce((a, b) => a + b, 0);
    const rich = Array.from({ length: 40 }, (_, i) => {
      const { sim, w } = makeDrop({ boss: false, mapSeed: i + 1, waystoneSeed: QUANTITY_STONE });
      sim.step([]);
      return allDrops(w).length;
    }).reduce((a, b) => a + b, 0);
    expect(rich).toBeGreaterThan(lean);
  });

  // ── Experience ───────────────────────────────────────────────────────────

  /** A world with a session at `area`/`areaTier`, a progress row, and one dead monster. */
  function makeXpKill(opts: {
    area: "hideout" | "map"; areaTier: number; xp: number; level?: number;
    rare?: 0 | 1; boss?: boolean;
  }) {
    const sim = new Simulation();
    registerDeath(sim);
    const w = sim.world;

    const p = w.create();
    w.set(p, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
    w.set(p, "health", { life: fp(100), maxLife: fp(100) });
    w.set(p, "mana", { mana: fp(60), maxMana: fp(60), regen: 0 });

    const sessionE = w.create();
    w.set<SessionC>(sessionE, "session", {
      area: opts.area, atlasSeed: 0, mapSeed: 0, waystoneSeed: 0, waystones: [], areaTier: opts.areaTier,
      activeNodeId: "", completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "",
    });
    w.set<ProgressC>(sessionE, "progress", { level: opts.level ?? START_LEVEL, xp: opts.xp });
    w.set(sessionE, "equipment", { slots: {} });

    const m = w.create();
    w.set(m, "monster", { defId: "d", moveSpeed: 0, bodyRadius: 0, attackRange: 0, attackCooldownTicks: 0, attackDamage: 0, attackType: 1, attackReadyTick: 0, state: "idle", rare: opts.rare ?? 0, summoned: 0 });
    w.set(m, "health", { life: 0, maxLife: fp(10) });
    if (opts.boss) w.set(m, "boss", { phase: 1, nextAbilityTick: 0, spawnX: 0, spawnY: 0, rootedUntilTick: 0 });

    return { sim, world: w, sessionE, p };
  }

  it("a map kill banks the monster's experience", () => {
    const { sim, world, sessionE } = makeXpKill({ area: "map", areaTier: 1, xp: 0 });
    sim.step([]);
    // areaLevel 65, character 65: no penalty, one normal monster.
    expect(world.get<ProgressC>(sessionE, "progress")).toEqual({ level: 65, xp: 65 });
  });

  it("a boss is worth forty normals", () => {
    const { sim, world, sessionE } = makeXpKill({ area: "map", areaTier: 1, xp: 0, boss: true });
    sim.step([]);
    expect(world.get<ProgressC>(sessionE, "progress")!.xp).toBe(65 * 40);
  });

  it("a hideout kill is worth nothing", () => {
    const { sim, world, sessionE } = makeXpKill({ area: "hideout", areaTier: 0, xp: 0 });
    sim.step([]);
    expect(world.get<ProgressC>(sessionE, "progress")).toEqual({ level: 65, xp: 0 });
  });

  it("crossing the threshold levels up and re-derives the life pool", () => {
    // areaLevel 64 boss = 2560, which is exactly what is missing from the level.
    const { sim, world, sessionE, p } = makeXpKill({ area: "map", areaTier: 0, xp: 60_000 - 2560, boss: true });
    sim.step([]);
    expect(world.get<ProgressC>(sessionE, "progress")).toEqual({ level: 66, xp: 0 });
    // One level = +6 life, granted as headroom rather than as a heal.
    expect(world.get<{ maxLife: number; life: number }>(p, "health")).toEqual({ maxLife: fp(106), life: fp(100) });
  });

  it("killing a monster refills one charge on each flask and never exceeds max", () => {
    const sim = new Simulation();
    registerDeath(sim);
    const w = sim.world;

    const p = w.create();
    w.set(p, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
    w.set(p, "health", { life: fp(100), maxLife: fp(100) });
    w.set(p, "flasks", { lifeCharges: 3, lifeMax: 7, manaCharges: 7, manaMax: 7 });

    const m = w.create();
    w.set(m, "monster", { defId: "d", moveSpeed: 0, bodyRadius: 0, attackRange: 0, attackCooldownTicks: 0, attackDamage: 0, attackType: 1, attackReadyTick: 0, state: "idle", rare: 0, summoned: 0 });
    w.set(m, "health", { life: 0, maxLife: fp(10) });

    sim.step([]);
    const f = w.get(p, "flasks") as { lifeCharges: number; lifeMax: number; manaCharges: number; manaMax: number };
    expect(f.lifeCharges).toBe(4);    // 3 + 1
    expect(f.manaCharges).toBe(7);    // clamped at max
  });

  it("does not drop when an ordinary (non-rare, non-boss) monster dies", () => {
    const sim = new Simulation();
    registerDeath(sim);
    const w = sim.world;
    const s = w.create();
    w.set(s, "session", { area: "map", atlasSeed: 1, mapSeed: 7, waystoneSeed: 0, waystones: [], areaTier: 5, activeNodeId: "n", completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "" });
    const m = w.create();
    w.set(m, "position", { x: 0, y: 0 });
    w.set(m, "health", { life: 0, maxLife: 40 });
    w.set(m, "monster", { defId: "d", moveSpeed: 0, bodyRadius: 0, attackRange: 0, attackCooldownTicks: 0, attackDamage: 0, attackType: 1, attackReadyTick: 0, state: "idle", rare: 0, summoned: 0 });
    sim.step([]);
    expect(equipmentDrops(w).length).toBe(0);
  });

  describe("scroll drops", () => {
    /** `n` ordinary dead monsters in one tier-5 map, ready for a single step. */
    function makeKills(n: number) {
      const sim = new Simulation();
      registerDeath(sim);
      const w = sim.world;
      const s = w.create();
      w.set(s, "session", { area: "map", atlasSeed: 1, mapSeed: 7, waystoneSeed: 0, waystones: [], areaTier: 5, activeNodeId: "n", completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "" });
      for (let i = 0; i < n; i++) {
        const m = w.create();
        w.set(m, "position", { x: fp(i), y: fp(0) });
        w.set(m, "health", { life: 0, maxLife: 40 });
        w.set(m, "monster", { defId: "d", moveSpeed: 0, bodyRadius: 0, attackRange: 0, attackCooldownTicks: 0, attackDamage: 0, attackType: 1, attackReadyTick: 0, state: "idle", rare: 0, summoned: 0 });
      }
      return { sim, w };
    }
    const scrolls = (w: World) =>
      w.query("item", "position").filter((e) => (w.get(e, "item") as { item: { baseId: string } }).item.baseId === WISDOM_SCROLL_BASE_ID);

    /** One map's worth of corpses: five ordinary monsters, the rare, the boss. */
    function makeMapKills(mapSeed: number) {
      const sim = new Simulation();
      registerDeath(sim);
      const w = sim.world;
      const s = w.create();
      w.set(s, "session", { area: "map", atlasSeed: 1, mapSeed, waystoneSeed: 0, waystones: [], areaTier: 5, activeNodeId: "n", completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "" });
      for (let i = 0; i < 7; i++) {
        const m = w.create();
        w.set(m, "position", { x: fp(i), y: fp(0) });
        w.set(m, "health", { life: 0, maxLife: 40 });
        w.set(m, "monster", { defId: "d", moveSpeed: 0, bodyRadius: 0, attackRange: 0, attackCooldownTicks: 0, attackDamage: 0, attackType: 1, attackReadyTick: 0, state: "idle", rare: i === 5 ? 1 : 0, summoned: 0 });
        if (i === 6) w.set(m, "boss", { phase: 1, nextAbilityTick: 0, spawnX: 0, spawnY: 0, rootedUntilTick: 0 });
      }
      return { sim, w };
    }

    it("pays out roughly one scroll per unidentified item it drops", () => {
      // docs/09 rule 1 and docs/02 24: an unread rare is only a tease if the
      // reveal is affordable. The reveal economy has to be self-financing, so
      // this fires if a tuning pass makes upgrades cheap or scrolls scarce.
      let paid = 0, owed = 0;
      for (let seed = 1; seed <= 100; seed++) {
        const { sim, w } = makeMapKills(seed);
        sim.step([]);
        paid += scrolls(w).length;
        owed += w.query("item", "position")
          .filter((e) => (w.get(e, "item") as { item: { unidentified?: boolean } }).item.unidentified === true).length;
      }
      expect(paid / owed).toBeGreaterThan(0.8);
      expect(paid / owed).toBeLessThan(1.5);
    });

    it("drops the same scrolls again for the same map and tick", () => {
      const run = () => { const { sim, w } = makeKills(60); sim.step([]); return scrolls(w).length; };
      expect(run()).toBe(run());
    });

    it("drops no scrolls in the hideout, where there is nothing to identify", () => {
      const { sim, w } = makeKills(60);
      const s = w.query("session")[0]!;
      w.set(s, "session", { ...(w.get(s, "session") as object), area: "hideout" });
      sim.step([]);
      expect(scrolls(w).length).toBe(0);
    });
  });
});

describe("clearing a map hands Waystones back", () => {
  /** A dying map boss on `activeNodeId`, with `completedNodes` already behind it. */
  function makeBossDeath(area: "map", activeNodeId: string, completedNodes: string[]) {
    const sim = new Simulation();
    registerDeath(sim);
    const { world } = sim;
    const sessionE = world.create();
    world.set<SessionC>(sessionE, "session", {
      area, atlasSeed: 0, mapSeed: 0, waystoneSeed: 0, waystones: [], areaTier: 5,
      activeNodeId, completedNodes, portalsLeft: 6, mapOpen: 1, pendingArea: "",
    });
    const boss = world.create();
    world.set(boss, "monster", { defId: "boss", state: "idle", moveSpeed: 0, bodyRadius: 0,
      attackRange: 0, attackCooldownTicks: 0, attackDamage: 0, attackType: 1, attackReadyTick: 0, rare: 0, summoned: 0 });
    world.set(boss, "health", { life: 0, maxLife: fp(500) });
    world.set(boss, "boss", { phase: 1, nextAbilityTick: 0, spawnX: 0, spawnY: 0, rootedUntilTick: 0 });
    return { sim, world, sessionE };
  }

  it("the boss's death adds the run's drops to the owned stock", () => {
    const { sim, world, sessionE } = makeBossDeath("map", "node.ashen_glade", []);
    const before = world.get<SessionC>(sessionE, "session")!.waystones.length;
    sim.step();
    const after = world.get<SessionC>(sessionE, "session")!.waystones;
    expect(after.length).toBeGreaterThan(before);
    for (const w of after) expect(w.tier).toBeGreaterThanOrEqual(1);
  });

  it("a node already cleared pays nothing a second time", () => {
    const { sim, world, sessionE } = makeBossDeath("map", "node.ashen_glade", ["node.ashen_glade"]);
    sim.step();
    expect(world.get<SessionC>(sessionE, "session")!.waystones).toEqual([]);
  });
});
