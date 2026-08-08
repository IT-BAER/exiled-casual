import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { generateArea } from "@exiled/mapgen";
import { CONTENT_VERSION } from "@exiled/content-runtime";
import { Simulation } from "../loop";
import { registerAreaTransition } from "./area-transition";
import { gridCollision, type CollisionRef } from "../collision";
import type { SessionC, Health, Mana, Position } from "../components";

function makeWorld() {
  const sim = new Simulation();
  registerAreaTransition(sim);
  const { world } = sim;

  const player = world.create();
  world.set(player, "player", { moveSpeed: fp(4), bodyRadius: fp(0.5) });
  world.set<Health>(player, "health", { life: fp(70), maxLife: fp(100) });
  world.set<Mana>(player, "mana", { mana: fp(30), maxMana: fp(60), regen: 0 });
  world.set<Position>(player, "position", { x: fp(5), y: fp(3) });
  world.set(player, "moveTarget", { x: fp(5), y: fp(3), active: 1 });
  world.set(player, "moveDir", { dx: 1, dy: 0 });

  return { sim, world, player };
}

function addSession(world: ReturnType<typeof makeWorld>["world"], pendingArea: "hideout" | "map") {
  const sessionE = world.create();
  const session: SessionC = {
    area: pendingArea === "hideout" ? "map" : "hideout",
    atlasSeed: 0, areaTier: 0, activeNodeId: "", completedNodes: [],
    mapSeed: 0, waystoneSeed: 0,
    portalsLeft: 0,
    mapOpen: 0,
    pendingArea,
  };
  world.set<SessionC>(sessionE, "session", session);
  return { sessionE, session };
}

describe("registerAreaTransition", () => {
  it("destroys area content but preserves the player entity id", () => {
    const { sim, world, player } = makeWorld();
    const { sessionE } = addSession(world, "hideout");

    // A content entity that must be destroyed.
    const monster = world.create();
    world.set(monster, "monster", { defId: "x", state: "idle", moveSpeed: 0, bodyRadius: 0,
      attackRange: 0, attackCooldownTicks: 0, attackDamage: 0, attackType: 1, attackReadyTick: 0, rare: 0, summoned: 0 });
    world.set(monster, "health", { life: fp(40), maxLife: fp(40) });

    sim.step();

    expect(world.alive.has(player)).toBe(true);
    expect(world.alive.has(sessionE)).toBe(true);
    expect(world.alive.has(monster)).toBe(false);
  });

  it("preserves the player's current life and mana across the transition", () => {
    const { sim, world, player } = makeWorld();
    addSession(world, "hideout");

    sim.step();

    const h = world.get<Health>(player, "health")!;
    const m = world.get<Mana>(player, "mana")!;
    expect(h.life).toBe(fp(70));
    expect(m.mana).toBe(fp(30));
  });

  it("moves the player to the hideout spawn point (0, 0)", () => {
    const { sim, world, player } = makeWorld();
    addSession(world, "hideout");

    sim.step();

    const pos = world.get<Position>(player, "position")!;
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(0);
  });

  it("clears pendingArea after the transition", () => {
    const { sim, world } = makeWorld();
    const { sessionE } = addSession(world, "hideout");

    sim.step();

    const session = world.get<SessionC>(sessionE, "session")!;
    expect(session.pendingArea).toBe("");
    expect(session.area).toBe("hideout");
  });

  it("clears moveTarget active and moveDir so held input does not carry across", () => {
    const { sim, world, player } = makeWorld();
    addSession(world, "hideout");

    sim.step();

    expect(world.get<{ active: number }>(player, "moveTarget")!.active).toBe(0);
    expect(world.get<{ dx: number; dy: number }>(player, "moveDir")).toEqual({ dx: 0, dy: 0, hx: 0, hy: 0 });
  });

  it("does nothing when pendingArea is empty", () => {
    const { sim, world, player } = makeWorld();
    const sessionE = world.create();
    world.set<SessionC>(sessionE, "session", {
      area: "hideout",
      atlasSeed: 0, areaTier: 0, activeNodeId: "", completedNodes: [],
      mapSeed: 0, waystoneSeed: 0,
      portalsLeft: 0,
      mapOpen: 0,
      pendingArea: "",
    });

    // Content entity that must survive (no transition triggered).
    const monster = world.create();
    world.set(monster, "monster", { defId: "x", state: "idle", moveSpeed: 0, bodyRadius: 0,
      attackRange: 0, attackCooldownTicks: 0, attackDamage: 0, attackType: 1, attackReadyTick: 0, rare: 0, summoned: 0 });

    const posBefore = world.get<Position>(player, "position")!;
    sim.step();

    expect(world.alive.has(monster)).toBe(true);
    expect(world.get<Position>(player, "position")).toEqual(posBefore);
  });

  it("does nothing when there is no session (legacy sim)", () => {
    const { sim, world, player } = makeWorld();
    // No session entity — transition system must be a no-op.
    const posBefore = world.get<Position>(player, "position")!;
    sim.step();
    expect(world.get<Position>(player, "position")).toEqual(posBefore);
  });
});

describe("registerAreaTransition — map entry (collision + start socket)", () => {
  function makePlayer(world: ReturnType<typeof makeWorld>["world"]) {
    const player = world.create();
    world.set(player, "player", { moveSpeed: fp(4), bodyRadius: fp(0.5) });
    world.set<Position>(player, "position", { x: fp(5), y: fp(3) });
    world.set(player, "moveTarget", { x: fp(5), y: fp(3), active: 1 });
    world.set(player, "moveDir", { dx: 0, dy: 0 });
    return player;
  }

  it("entering the map activates collision and spawns the player at the start socket", () => {
    const sim = new Simulation();
    const ref: CollisionRef = { active: null };
    registerAreaTransition(sim, ref);
    const { world } = sim;
    const player = makePlayer(world);

    const seed = 42;
    const sessionE = world.create();
    world.set<SessionC>(sessionE, "session", {
      area: "hideout", atlasSeed: 0, areaTier: 0, activeNodeId: "", completedNodes: [],
      mapSeed: seed, waystoneSeed: 0, portalsLeft: 0, mapOpen: 1, pendingArea: "map",
    });

    sim.step();

    // Collision is now live (the map has walls).
    expect(ref.active).not.toBeNull();
    // Player lands on the generated map's start socket, not the (0,0) map spawn.
    const start = generateArea(seed, CONTENT_VERSION).objectiveAnchors.find((a) => a.id === "start")!;
    expect(world.get<Position>(player, "position")).toEqual({ x: fp(start.x), y: fp(start.y) });
  });

  it("leaving the map (back to hideout) drops the walls, keeps the furniture, spawns at (0,0)", () => {
    const sim = new Simulation();
    const ref: CollisionRef = { active: gridCollision(generateArea(1, CONTENT_VERSION).grid) };
    registerAreaTransition(sim, ref);
    const { world } = sim;
    const player = makePlayer(world);

    const sessionE = world.create();
    world.set<SessionC>(sessionE, "session", {
      area: "map", atlasSeed: 0, areaTier: 0, activeNodeId: "", completedNodes: [],
      mapSeed: 1, waystoneSeed: 0, portalsLeft: 0, mapOpen: 1, pendingArea: "hideout",
    });

    sim.step();

    // The hideout has no walls: a point far outside any generated map is open.
    expect(ref.active!.isWalkable(fp(400), fp(-400), fp(0.5))).toBe(true);
    // It does have a map device, and the player walks around that.
    expect(ref.active!.isWalkable(fp(-2.828), fp(2.828), fp(0.5))).toBe(false);
    // And he arrives on clear floor rather than inside one of them.
    expect(world.get<Position>(player, "position")).toEqual({ x: 0, y: 0 });
    expect(ref.active!.isWalkable(0, 0, fp(0.5))).toBe(true);
  });
});

/**
 * Leaving a map you can still come back to freezes it. The rule is PoE1's: the
 * portal budget is what says a map is still yours, so a walk home to empty the
 * bag must not re-roll the place.
 */
describe("a map with portals left is still standing when you come back", () => {
  /** A session mid-run: in a map, one portal already spent, five left. */
  function inOpenMap(world: ReturnType<typeof makeWorld>["world"]) {
    const sessionE = world.create();
    const session: SessionC = {
      area: "map", atlasSeed: 0, areaTier: 3, activeNodeId: "node.the_wrackline",
      completedNodes: [], mapSeed: 4242, waystoneSeed: 0,
      portalsLeft: 5, mapOpen: 1, pendingArea: "hideout",
    };
    world.set<SessionC>(sessionE, "session", session);
    return sessionE;
  }

  /** One thinned pack and one opened chest, the two things a return has to find. */
  function populate(world: ReturnType<typeof makeWorld>["world"]) {
    const hurt = world.create();
    world.set(hurt, "monster", { defId: "monster.vaal_husk.v1", state: "chase", moveSpeed: fp(2),
      bodyRadius: fp(0.4), attackRange: fp(1), attackCooldownTicks: 40, attackDamage: fp(3),
      attackType: 1, attackReadyTick: 90, slamReadyTick: 0, rootedUntilTick: 0, rare: 0, summoned: 0 });
    world.set<Health>(hurt, "health", { life: fp(12), maxLife: fp(66) });
    world.set<Position>(hurt, "position", { x: fp(11), y: fp(-7) });
    const chest = world.create();
    world.set(chest, "interactable", { kind: "container", radius: fp(2), yaw: 0 });
    world.set(chest, "container", { look: "chest", key: "cache:4242:0:r1", opened: 1 });
    world.set<Position>(chest, "position", { x: fp(3), y: fp(3) });
    return { hurt, chest };
  }

  /** Walk out, wait `idle` ticks in the hideout, walk back in. */
  function roundTrip(idle: number) {
    const { sim, world, player } = makeWorld();
    const sessionE = inOpenMap(world);
    populate(world);
    sim.step(); // out
    const inHideout = world.get<SessionC>(sessionE, "session")!;
    for (let t = 0; t < idle; t++) sim.step();
    world.set<SessionC>(sessionE, "session", { ...inHideout, pendingArea: "map" });
    sim.step(); // back in
    return { sim, world, player, sessionE };
  }

  const monstersOf = (world: ReturnType<typeof makeWorld>["world"]) =>
    world.query("monster", "health").map((e) => ({
      life: world.get<Health>(e, "health")!.life,
      pos: world.get<Position>(e, "position")!,
      ready: (world.get(e, "monster") as { attackReadyTick: number }).attackReadyTick,
    }));

  it("brings back the same wounded monster, in the same place", () => {
    const { sim, world } = roundTrip(0);
    // `ready` is rebased by the ticks that passed, so it is asserted as the time
    // it has LEFT — which is the thing that has to survive the trip.
    expect(monstersOf(world).map((m) => ({ ...m, ready: m.ready - sim.tick }))).toEqual([
      { life: fp(12), pos: { x: fp(11), y: fp(-7) }, ready: 89 },
    ]);
  });

  it("brings back the opened chest still opened", () => {
    const { world } = roundTrip(0);
    const chests = world.query("container");
    expect(chests).toHaveLength(1);
    expect(world.get(chests[0]!, "container")).toEqual(
      { look: "chest", key: "cache:4242:0:r1", opened: 1 },
    );
  });

  it("gives a cooldown back the time it had left, not the time it was away", () => {
    // Left on tick 1 with 89 ticks to go; 200 ticks of hideout must not spend them.
    const { sim, world } = (() => {
      const r = roundTrip(200);
      return { sim: r.sim, world: r.world };
    })();
    const ready = monstersOf(world)[0]!.ready;
    expect(ready - sim.tick).toBe(89);
  });

  it("rolls a fresh map when the last portal closed it", () => {
    const { sim, world } = makeWorld();
    const sessionE = world.create();
    world.set<SessionC>(sessionE, "session", {
      area: "map", atlasSeed: 0, areaTier: 3, activeNodeId: "node.the_wrackline",
      completedNodes: [], mapSeed: 4242, waystoneSeed: 0,
      portalsLeft: 0, mapOpen: 0, pendingArea: "hideout",
    });
    populate(world);
    sim.step();
    const inHideout = world.get<SessionC>(sessionE, "session")!;
    world.set<SessionC>(sessionE, "session", { ...inHideout, mapOpen: 1, pendingArea: "map" });
    sim.step();
    // Whatever the generator rolled, it is not one husk on 12 life at (11,-7).
    expect(monstersOf(world).map((m) => ({ ...m, ready: m.ready - sim.tick }))).not.toEqual([
      { life: fp(12), pos: { x: fp(11), y: fp(-7) }, ready: 89 },
    ]);
  });
});
