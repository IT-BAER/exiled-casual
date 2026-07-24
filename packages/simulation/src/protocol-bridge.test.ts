import { describe, it, expect } from "vitest";
import { fp, toNumber } from "@exiled/fixed-point";
import { createCombatSim } from "./combat-sim";
import { intentToCommand, buildSnapshot } from "./protocol-bridge";
import { CONTENT_VERSION } from "@exiled/content-runtime";
import { ITEM_POOLS, baseOf } from "@exiled/content-runtime";
import { rollItem } from "@exiled/rules";
import type { Intent } from "@exiled/protocol";
import { World } from "./ecs";
import type {
  Position, Health, Mana, MonsterC, BossC, TelegraphC, SessionC, InteractableC,
} from "./components";

describe("intentToCommand", () => {
  it("moveTo maps to correct Command shape", () => {
    const intent: Intent = { kind: "moveTo", x: fp(3), y: fp(-2) };
    const cmd = intentToCommand(intent, 1, 5);
    expect(cmd).toEqual({ tick: 5, entity: 1, type: "moveTo", data: { x: fp(3), y: fp(-2) } });
  });

  it("moveDir maps to correct Command shape", () => {
    const intent: Intent = { kind: "moveDir", dx: 1, dy: -1 };
    const cmd = intentToCommand(intent, 1, 0);
    expect(cmd).toEqual({ tick: 0, entity: 1, type: "moveDir", data: { dx: 1, dy: -1 } });
  });

  it("useSkill maps to correct Command shape with skillId at top level", () => {
    const intent: Intent = { kind: "useSkill", skillId: "skill.ember_bolt.v1", tx: fp(5), ty: fp(0) };
    const cmd = intentToCommand(intent, 2, 10);
    expect(cmd.type).toBe("useSkill");
    expect(cmd.entity).toBe(2);
    expect(cmd.tick).toBe(10);
    expect(cmd.skillId).toBe("skill.ember_bolt.v1");
    expect(cmd.data?.tx).toBe(fp(5));
    expect(cmd.data?.ty).toBe(fp(0));
  });

  it("stop maps to correct Command shape", () => {
    const intent: Intent = { kind: "stop" };
    const cmd = intentToCommand(intent, 1, 3);
    expect(cmd).toEqual({ tick: 3, entity: 1, type: "stop" });
  });
});

describe("buildSnapshot", () => {
  it("reflects player position, full life/mana on fresh world", () => {
    const { world, sim, playerEntity } = createCombatSim(42);
    const snap = buildSnapshot(world, sim, 0, CONTENT_VERSION);
    expect(snap.tick).toBe(0);
    expect(snap.player.id).toBe(playerEntity);
    expect(snap.player.x).toBe(0);
    expect(snap.player.y).toBe(0);
    expect(snap.player.life).toBeCloseTo(toNumber(fp(100)), 5);
    expect(snap.player.maxLife).toBeCloseTo(toNumber(fp(100)), 5);
    expect(snap.player.mana).toBeCloseTo(toNumber(fp(60)), 5);
    expect(snap.player.alive).toBe(true);
    expect(snap.player.casting).toBe(false);
  });

  it("player.casting is true during a cast's recovery window", () => {
    const { world, sim, playerEntity } = createCombatSim(42);
    const intent: Intent = { kind: "useSkill", skillId: "skill.ember_bolt.v1", tx: fp(5), ty: fp(0) };
    sim.step([intentToCommand(intent, playerEntity, 0)]); // castTicks 8 → untilTick 8
    const snap = buildSnapshot(world, sim, sim.tick, CONTENT_VERSION);
    expect(snap.player.casting).toBe(true);
  });

  it("cooldown shows remaining seconds after a skill is cast", () => {
    const { world, sim, playerEntity } = createCombatSim(42);
    const intent: Intent = { kind: "useSkill", skillId: "skill.ember_bolt.v1", tx: fp(5), ty: fp(0) };
    const cmd = intentToCommand(intent, playerEntity, 0);
    sim.step([cmd]);
    const snap = buildSnapshot(world, sim, sim.tick, CONTENT_VERSION);
    expect(snap.player.cooldowns["skill.ember_bolt.v1"]).toBeCloseTo(5 / 30, 5);
  });

  it("monster entities appear in snapshot sorted by id with life/maxLife/rare", () => {
    const { world, sim } = createCombatSim(42);
    const snap = buildSnapshot(world, sim, 0, CONTENT_VERSION);
    const monsters = snap.entities.filter(e => e.kind === "monster");
    expect(monsters).toHaveLength(6);
    for (let i = 1; i < monsters.length; i++) {
      expect(monsters[i]!.id).toBeGreaterThan(monsters[i - 1]!.id);
    }
    expect(monsters.filter(e => e.rare).length).toBe(1);
    for (const m of monsters) {
      expect(m.life).toBeCloseTo(m.maxLife!, 5);
    }
  });

  it("a spawned projectile appears as a projectile entity", () => {
    const { world, sim, playerEntity } = createCombatSim(42);
    const intent: Intent = { kind: "useSkill", skillId: "skill.ember_bolt.v1", tx: fp(5), ty: fp(0) };
    sim.step([intentToCommand(intent, playerEntity, 0)]);
    const snap = buildSnapshot(world, sim, sim.tick, CONTENT_VERSION);
    const projs = snap.entities.filter(e => e.kind === "projectile");
    expect(projs).toHaveLength(1);
    expect(typeof projs[0]!.radius).toBe("number");
  });

  it("all entities are sorted by id", () => {
    const { world, sim, playerEntity } = createCombatSim(42);
    const intent: Intent = { kind: "useSkill", skillId: "skill.cinder_ground.v1", tx: fp(3), ty: fp(0) };
    sim.step([intentToCommand(intent, playerEntity, 0)]);
    const snap = buildSnapshot(world, sim, sim.tick, CONTENT_VERSION);
    for (let i = 1; i < snap.entities.length; i++) {
      expect(snap.entities[i]!.id).toBeGreaterThan(snap.entities[i - 1]!.id);
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers for minimal-world fixtures (no content needed)
// ---------------------------------------------------------------------------

function makeMinimalWorld() {
  const world = new World();
  const p = world.create();
  world.set<Position>(p, "position", { x: fp(0), y: fp(0) });
  world.set<Health>(p, "health", { life: fp(100), maxLife: fp(100) });
  world.set<Mana>(p, "mana", { mana: fp(60), maxMana: fp(60), regen: fp(0) });
  world.set(p, "cooldowns", {});
  world.set(p, "player", { moveSpeed: fp(0), bodyRadius: fp(0.5) });
  return { world, playerEntity: p };
}

function addMonster(world: World, x: number, y: number): number {
  const e = world.create();
  world.set<Position>(e, "position", { x: fp(x), y: fp(y) });
  world.set<Health>(e, "health", { life: fp(200), maxLife: fp(200) });
  world.set<MonsterC>(e, "monster", {
    defId: "test.monster",
    moveSpeed: fp(2), bodyRadius: fp(1),
    attackRange: fp(1.5), attackCooldownTicks: 60,
    attackDamage: fp(10), attackType: 1 as const,
    attackReadyTick: 0, state: "idle",
    rare: 0 as const, summoned: 0 as const,
  });
  return e;
}

function addBoss(world: World, x: number, y: number): number {
  const e = addMonster(world, x, y);
  world.set<BossC>(e, "boss", {
    phase: 1, nextAbilityTick: 0,
    spawnX: fp(x), spawnY: fp(y), rootedUntilTick: 0,
  });
  return e;
}

function addTelegraph(world: World, x: number, y: number, startTick: number, impactTick: number): number {
  const e = world.create();
  world.set<Position>(e, "position", { x: fp(x), y: fp(y) });
  world.set<TelegraphC>(e, "telegraph", {
    ownerId: 0, team: 1,
    radius: fp(3), startTick, impactTick,
    damage: fp(28), damageType: 0 as const, leavesGroundTicks: 120,
  });
  return e;
}

describe("buildSnapshot — boss & telegraph", () => {
  it("boss entity serialises as kind:monster with boss===true and bossPhase===1", () => {
    const { world } = makeMinimalWorld();
    addBoss(world, 5, 3);
    // sim is unused; pass a minimal stub
    const snap = buildSnapshot(world, {} as never, 0, "test");
    const bosses = snap.entities.filter(e => e.kind === "monster" && e.boss === true);
    expect(bosses).toHaveLength(1);
    expect(bosses[0]!.bossPhase).toBe(1);
  });

  it("plain monster does NOT carry boss or bossPhase keys", () => {
    const { world } = makeMinimalWorld();
    addMonster(world, 2, 2);
    const snap = buildSnapshot(world, {} as never, 0, "test");
    const plain = snap.entities.filter(e => e.kind === "monster");
    expect(plain).toHaveLength(1);
    expect(plain[0]!.boss).toBeUndefined();
    expect(plain[0]!.bossPhase).toBeUndefined();
  });

  it("telegraph entity serialises with correct kind, float x/y/radius", () => {
    const { world } = makeMinimalWorld();
    addTelegraph(world, 4, -2, 10, 40);
    const snap = buildSnapshot(world, {} as never, 0, "test");
    const tgs = snap.entities.filter(e => e.kind === "telegraph");
    expect(tgs).toHaveLength(1);
    expect(tgs[0]!.x).toBeCloseTo(4, 5);
    expect(tgs[0]!.y).toBeCloseTo(-2, 5);
    expect(tgs[0]!.radius).toBeCloseTo(3, 5);
  });

  it("progress is 0 at startTick, ~0.5 halfway, 1 at impactTick, clamped past it", () => {
    const { world } = makeMinimalWorld();
    const startTick = 10;
    const impactTick = 40;
    addTelegraph(world, 0, 0, startTick, impactTick);

    const snapStart = buildSnapshot(world, {} as never, startTick, "test");
    expect(snapStart.entities[0]!.progress).toBeCloseTo(0, 5);

    const snapMid = buildSnapshot(world, {} as never, 25, "test");
    expect(snapMid.entities[0]!.progress).toBeCloseTo(0.5, 5);

    const snapImpact = buildSnapshot(world, {} as never, impactTick, "test");
    expect(snapImpact.entities[0]!.progress).toBeCloseTo(1, 5);

    const snapPast = buildSnapshot(world, {} as never, impactTick + 5, "test");
    expect(snapPast.entities[0]!.progress).toBe(1);
  });

  it("zero-length wind-up (startTick === impactTick) yields progress 1", () => {
    const { world } = makeMinimalWorld();
    addTelegraph(world, 0, 0, 10, 10);
    const snap = buildSnapshot(world, {} as never, 10, "test");
    expect(snap.entities[0]!.progress).toBe(1);
  });

  it("combined entity list stays sorted by id when telegraphs are mixed in", () => {
    const { world } = makeMinimalWorld();
    addMonster(world, 1, 1);
    addTelegraph(world, 2, 2, 0, 30);
    addMonster(world, 3, 3);
    const snap = buildSnapshot(world, {} as never, 0, "test");
    for (let i = 1; i < snap.entities.length; i++) {
      expect(snap.entities[i]!.id).toBeGreaterThan(snap.entities[i - 1]!.id);
    }
  });
});

// ---------------------------------------------------------------------------
// Session + interactable snapshot tests
// ---------------------------------------------------------------------------

describe("buildSnapshot — session fields and interactables", () => {
  function makeWorldWithSession(area: "hideout" | "map", portalsLeft: number, mapOpen: 0 | 1) {
    const { world, playerEntity } = makeMinimalWorld();
    const sessionE = world.create();
    world.set<SessionC>(sessionE, "session", {
      area, atlasSeed: 0, areaTier: 0, activeNodeId: "", completedNodes: [],
      mapSeed: 0, portalsLeft, mapOpen, pendingArea: "",
    });
    return { world, playerEntity };
  }

  it("snapshot carries area, portalsLeft, mapOpen from session", () => {
    const { world } = makeWorldWithSession("hideout", 4, 1);
    const snap = buildSnapshot(world, {} as never, 0, "test");
    expect(snap.area).toBe("hideout");
    expect(snap.portalsLeft).toBe(4);
    expect(snap.mapOpen).toBe(true);
  });

  it("defaults to area='map', portalsLeft=0, mapOpen=false when no session (legacy sim)", () => {
    const { world } = makeMinimalWorld();
    const snap = buildSnapshot(world, {} as never, 0, "test");
    expect(snap.area).toBe("map");
    expect(snap.portalsLeft).toBe(0);
    expect(snap.mapOpen).toBe(false);
  });

  it("snapshot carries areaTier, atlasSeed, completedNodes from session", () => {
    const { world } = makeMinimalWorld();
    const sessionE = world.create();
    world.set<SessionC>(sessionE, "session", {
      area: "map", atlasSeed: 42, mapSeed: 7, areaTier: 3, activeNodeId: "node.emberfall",
      completedNodes: ["node.emberfall"], portalsLeft: 6, mapOpen: 1, pendingArea: "",
    });
    const snap = buildSnapshot(world, {} as never, 0, "test");
    expect(snap.areaTier).toBe(3);
    expect(snap.atlasSeed).toBe(42);
    expect(snap.completedNodes).toEqual(["node.emberfall"]);
  });

  it("defaults areaTier=0, atlasSeed=0, completedNodes=[] when no session (legacy sim)", () => {
    const { world } = makeMinimalWorld();
    const snap = buildSnapshot(world, {} as never, 0, "test");
    expect(snap.areaTier).toBe(0);
    expect(snap.atlasSeed).toBe(0);
    expect(snap.completedNodes).toEqual([]);
  });

  it("map device entity appears with correct kind and yaw", () => {
    const { world } = makeMinimalWorld();
    const device = world.create();
    world.set<Position>(device, "position", { x: fp(0), y: fp(8) });
    world.set<InteractableC>(device, "interactable", { kind: "mapDevice", radius: fp(2.5), yaw: 0 });

    const snap = buildSnapshot(world, {} as never, 0, "test");
    const devices = snap.entities.filter(e => e.kind === "mapDevice");
    expect(devices).toHaveLength(1);
    expect(devices[0]!.yaw).toBe(0);
    expect(devices[0]!.x).toBeCloseTo(0, 5);
    expect(devices[0]!.y).toBeCloseTo(8, 5);
  });

  it("portal entity appears with yaw", () => {
    const { world } = makeMinimalWorld();
    const portal = world.create();
    world.set<Position>(portal, "position", { x: fp(4.33), y: fp(10.5) });
    world.set<InteractableC>(portal, "interactable", { kind: "portal", radius: fp(2.5), yaw: 1.0472 });

    const snap = buildSnapshot(world, {} as never, 0, "test");
    const portals = snap.entities.filter(e => e.kind === "portal");
    expect(portals).toHaveLength(1);
    expect(portals[0]!.yaw).toBe(1.0472);
  });

  it("inRange is false when player is far, true when player is within radius", () => {
    const { world, playerEntity } = makeMinimalWorld();
    // Player at (0,0). Device at (0, fp(8))=8 units away. Radius=fp(2.5)=2.5 units.
    // Distance 8 > 2.5 → out of range.
    const device = world.create();
    world.set<Position>(device, "position", { x: 0, y: fp(8) });
    world.set<InteractableC>(device, "interactable", { kind: "mapDevice", radius: fp(2.5), yaw: 0 });

    const snapFar = buildSnapshot(world, {} as never, 0, "test");
    expect(snapFar.entities.find(e => e.kind === "mapDevice")!.inRange).toBe(false);

    // Move player right next to the device.
    world.set<Position>(playerEntity, "position", { x: 0, y: fp(8) });
    const snapNear = buildSnapshot(world, {} as never, 0, "test");
    expect(snapNear.entities.find(e => e.kind === "mapDevice")!.inRange).toBe(true);
  });
});

describe("buildSnapshot — ground items and inventory", () => {
  it("reports ground items and an empty inventory in the snapshot", () => {
    const { world, sim, playerEntity } = createCombatSim(42, { area: "map" });
    const playerPos = world.get<Position>(playerEntity, "position")!;

    const item = rollItem(ITEM_POOLS, 1, 65, 1);
    const base = baseOf(item.baseId);
    const ge = world.create();
    // Offset by fp(1) in x: within the fp(2.5) pickup radius → in range.
    world.set(ge, "position", { x: playerPos.x + fp(1), y: playerPos.y });
    world.set(ge, "item", { item, w: base.w, h: base.h });

    const snap = buildSnapshot(world, sim, 1, "test");
    const gi = snap.entities.find((e) => e.kind === "groundItem");
    expect(gi).toBeDefined();
    expect(gi!.rarity).toBe(item.rarity);
    expect(gi!.name).toBe(base.name);
    expect(gi!.inRange).toBe(true);
    expect(snap.inventory).toEqual({ cols: 12, rows: 5, items: [] });
  });

  it("reports inRange false for a ground item beyond the pickup radius", () => {
    const { world, sim, playerEntity } = createCombatSim(42, { area: "map" });
    const playerPos = world.get<Position>(playerEntity, "position")!;

    const item = rollItem(ITEM_POOLS, 1, 65, 1);
    const base = baseOf(item.baseId);
    const ge = world.create();
    // Offset by fp(3) in x: beyond the fp(2.5) pickup radius → out of range.
    world.set(ge, "position", { x: playerPos.x + fp(3), y: playerPos.y });
    world.set(ge, "item", { item, w: base.w, h: base.h });

    const snap = buildSnapshot(world, sim, 1, "test");
    const gi = snap.entities.find((e) => e.kind === "groundItem");
    expect(gi).toBeDefined();
    expect(gi!.inRange).toBe(false);
  });
});
