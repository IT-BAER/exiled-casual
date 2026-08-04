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
