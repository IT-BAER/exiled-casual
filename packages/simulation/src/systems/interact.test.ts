import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { offerWaystones, atlasGraph, WAYSTONE_OFFER_COUNT, atlasNodeTier, WAYSTONE_MAX_TIER } from "@exiled/rules";
import { MAP_PORTALS } from "@exiled/protocol";
import { waystoneItem } from "@exiled/content-runtime";
import { Simulation } from "../loop";
import { registerInteractSystem } from "./interact";
import type { World } from "../ecs";
import type { SessionC, Position, InteractableC, InventoryC } from "../components";

function makeWorld() {
  const sim = new Simulation();
  registerInteractSystem(sim);
  const { world } = sim;

  const player = world.create();
  world.set(player, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
  // Place player at the map device position so range checks pass by default.
  world.set<Position>(player, "position", { x: fp(0), y: fp(8) });

  const sessionE = world.create();
  const session: SessionC = {
    area: "hideout",
    atlasSeed: 0, areaTier: 0, activeNodeId: "", completedNodes: [],
    mapSeed: 0, waystoneSeed: 0,
    portalsLeft: 0,
    mapOpen: 0,
    pendingArea: "",
  };
  world.set<SessionC>(sessionE, "session", session);
  // Opening stock: 1x1 waystone items in backpack, one per offer slot.
  world.set<InventoryC>(sessionE, "inventory", {
    cols: 12, rows: 5,
    items: offerWaystones(0, WAYSTONE_OFFER_COUNT).map((w, i) => ({
      x: i, y: 0, w: 1, h: 1, item: waystoneItem(w.seed, w.tier),
    })),
  });

  const device = world.create();
  world.set<Position>(device, "position", { x: fp(0), y: fp(8) });
  world.set<InteractableC>(device, "interactable", { kind: "mapDevice", radius: fp(2.5), yaw: 0 });

  return { sim, world, player, sessionE, device };
}

function interactCmd(player: number, targetId: number) {
  return { tick: 0, entity: player, type: "interact", data: { targetId } };
}

function activateCmd(player: number, atlasNodeId: string, pos: { x: number; y: number }) {
  return { tick: 0, entity: player, type: "activateMap", atlasNodeId, data: pos };
}

describe("registerInteractSystem", () => {
  it("activateMap opens the chosen waystone's map: sets seed/tier/node, six portals", () => {
    const { sim, world, player, sessionE } = makeWorld();
    const ws = offerWaystones(0, WAYSTONE_OFFER_COUNT)[0]!;

    sim.step([activateCmd(player, "node.ashen_glade", { x: 0, y: 0 })]);

    const session = world.get<SessionC>(sessionE, "session")!;
    expect(session.mapOpen).toBe(1);
    expect(session.areaTier).toBe(ws.tier);
    expect(session.activeNodeId).toBe("node.ashen_glade");
    expect(session.portalsLeft).toBe(MAP_PORTALS);
    expect(world.query("interactable").filter((e) =>
      world.get<InteractableC>(e, "interactable")!.kind === "portal",
    )).toHaveLength(MAP_PORTALS);
  });

  it("activateMap is rejected for an unknown node", () => {
    const { sim, world, player, sessionE } = makeWorld();
    sim.step([activateCmd(player, "node.nope", { x: 0, y: 0 })]);
    expect(world.get<SessionC>(sessionE, "session")!.mapOpen).toBe(0);
  });

  it("activateMap is rejected when no stone sits at the specified cell", () => {
    const { sim, world, player, sessionE } = makeWorld();
    sim.step([activateCmd(player, "node.ashen_glade", { x: 99, y: 0 })]);
    expect(world.get<SessionC>(sessionE, "session")!.mapOpen).toBe(0);
  });

  it("activateMap is a no-op when a map is already open", () => {
    const { sim, world, player, sessionE } = makeWorld();
    sim.step([activateCmd(player, "node.ashen_glade", { x: 0, y: 0 })]); // open once
    const seedAfterFirst = world.get<SessionC>(sessionE, "session")!.mapSeed;
    sim.step([activateCmd(player, "node.emberfall", { x: 1, y: 0 })]); // ignored
    expect(world.get<SessionC>(sessionE, "session")!.mapSeed).toBe(seedAfterFirst);
  });

  it("activateMap is rejected for a node the fog has not opened", () => {
    const { sim, world, player, sessionE } = makeWorld();
    const graph = atlasGraph(0);
    const shut = graph.find((n) => n.id !== graph[0]!.id && !graph[0]!.links.includes(n.id))!;
    sim.step([activateCmd(player, shut.id, { x: 0, y: 0 })]);
    expect(world.get<SessionC>(sessionE, "session")!.mapOpen).toBe(0);
  });

  /** Append a stone of `tier` to the inventory and return its grid position. */
  function giveStone(world: World, sessionE: number, tier: number): { x: number; y: number } {
    const inv = world.get<InventoryC>(sessionE, "inventory")!;
    const pos = { x: inv.items.length, y: 0 };
    world.set<InventoryC>(sessionE, "inventory", {
      ...inv,
      items: [...inv.items, { x: pos.x, y: pos.y, w: 1, h: 1, item: waystoneItem(4242, tier) }],
    });
    return pos;
  }

  it("activateMap opens a neighbour once its route is cleared", () => {
    const { sim, world, player, sessionE } = makeWorld();
    const graph = atlasGraph(0);
    const neighbour = graph[0]!.links[0]!;
    const s = world.get<SessionC>(sessionE, "session")!;
    world.set<SessionC>(sessionE, "session", { ...s, completedNodes: [graph[0]!.id] });
    // A neighbour of the start demands Tier 3; the opening stone is Tier 1.
    const pos = giveStone(world, sessionE, atlasNodeTier(graph, neighbour));
    sim.step([activateCmd(player, neighbour, pos)]);
    expect(world.get<SessionC>(sessionE, "session")!.mapOpen).toBe(1);
  });

  it("a place refuses a stone below its own tier", () => {
    const { sim, world, player, sessionE } = makeWorld();
    const graph = atlasGraph(0);
    const neighbour = graph[0]!.links[0]!;
    const s = world.get<SessionC>(sessionE, "session")!;
    world.set<SessionC>(sessionE, "session", { ...s, completedNodes: [graph[0]!.id] });
    const pos = giveStone(world, sessionE, atlasNodeTier(graph, neighbour) - 1);
    sim.step([activateCmd(player, neighbour, pos)]);
    const after = world.get<SessionC>(sessionE, "session")!;
    expect(after.mapOpen).toBe(0);
    // ...and the stone is still in the character's hand, not burnt on a refusal.
    const inv = world.get<InventoryC>(sessionE, "inventory")!;
    expect(inv.items.some((p) => p.item.waystone?.seed === 4242)).toBe(true);
  });

  it("the same waystone draws a different map at a different node", () => {
    const graph = atlasGraph(0);
    const seedAt = (nodeId: string, completed: string[]) => {
      const { sim, world, player, sessionE } = makeWorld();
      const s = world.get<SessionC>(sessionE, "session")!;
      world.set<SessionC>(sessionE, "session", { ...s, completedNodes: completed });
      // The same stone at both places, high enough for either to accept it.
      const pos = giveStone(world, sessionE, WAYSTONE_MAX_TIER);
      sim.step([activateCmd(player, nodeId, pos)]);
      return world.get<SessionC>(sessionE, "session")!.mapSeed;
    };
    const first = seedAt(graph[0]!.id, []);
    const second = seedAt(graph[0]!.links[0]!, [graph[0]!.id]);
    expect(first).not.toBe(second);
    expect(seedAt(graph[0]!.id, [])).toBe(first); // and stays put for a place
  });

  it("activateMap is rejected for an already-completed node", () => {
    const { sim, world, player, sessionE } = makeWorld();
    const s = world.get<SessionC>(sessionE, "session")!;
    world.set<SessionC>(sessionE, "session", { ...s, completedNodes: ["node.ashen_glade"] });
    sim.step([activateCmd(player, "node.ashen_glade", { x: 0, y: 0 })]);
    expect(world.get<SessionC>(sessionE, "session")!.mapOpen).toBe(0);
  });

  it("out-of-range click on map device is ignored (trust boundary)", () => {
    const { sim, world, player, sessionE, device } = makeWorld();
    // Move player far away from the device.
    world.set<Position>(player, "position", { x: fp(10), y: fp(10) });

    sim.step([interactCmd(player, device)]);

    const session = world.get<SessionC>(sessionE, "session")!;
    expect(session.mapOpen).toBe(0);
    expect(session.portalsLeft).toBe(0);
  });

  it("targetId naming a non-interactable entity is ignored without throwing", () => {
    const { sim, world, player, sessionE } = makeWorld();
    // player entity itself has no interactable component.
    expect(() => sim.step([interactCmd(player, player)])).not.toThrow();
    expect(world.get<SessionC>(sessionE, "session")!.mapOpen).toBe(0);
  });

  it("targetId naming a destroyed entity is ignored without throwing", () => {
    const { sim, world, player, sessionE, device } = makeWorld();
    world.destroy(device);
    expect(() => sim.step([interactCmd(player, device)])).not.toThrow();
    expect(world.get<SessionC>(sessionE, "session")!.mapOpen).toBe(0);
  });

  it("portal click in the hideout sets pendingArea='map' without changing portalsLeft", () => {
    const { sim, world, player, sessionE } = makeWorld();
    // Set up: map is open with portals.
    world.set<SessionC>(sessionE, "session", {
      area: "hideout", atlasSeed: 0, areaTier: 0, activeNodeId: "", completedNodes: [],
      mapSeed: 0, waystoneSeed: 0, portalsLeft: 6, mapOpen: 1, pendingArea: "",
    });
    const portal = world.create();
    world.set<Position>(portal, "position", { x: fp(0), y: fp(8) }); // at player
    world.set<InteractableC>(portal, "interactable", { kind: "portal", radius: fp(2.5), yaw: 0 });

    sim.step([interactCmd(player, portal)]);

    const session = world.get<SessionC>(sessionE, "session")!;
    expect(session.pendingArea).toBe("map");
    expect(session.portalsLeft).toBe(6); // unchanged
  });

  it("portal click in the map sets pendingArea='hideout' without changing portalsLeft", () => {
    const { sim, world, player, sessionE } = makeWorld();
    world.set<SessionC>(sessionE, "session", {
      area: "map", atlasSeed: 0, areaTier: 0, activeNodeId: "", completedNodes: [],
      mapSeed: 0, waystoneSeed: 0, portalsLeft: 4, mapOpen: 1, pendingArea: "",
    });
    const portal = world.create();
    world.set<Position>(portal, "position", { x: fp(0), y: fp(8) }); // at player
    world.set<InteractableC>(portal, "interactable", { kind: "portal", radius: fp(2.5), yaw: 0 });

    sim.step([interactCmd(player, portal)]);

    const session = world.get<SessionC>(sessionE, "session")!;
    expect(session.pendingArea).toBe("hideout");
    expect(session.portalsLeft).toBe(4); // unchanged
  });

  it("no-op when there is no session entity (legacy sim)", () => {
    // Build a sim WITHOUT a session entity.
    const sim = new Simulation();
    registerInteractSystem(sim);
    const { world } = sim;

    const player = world.create();
    world.set<Position>(player, "position", { x: 0, y: 0 });
    const device = world.create();
    world.set<Position>(device, "position", { x: 0, y: 0 });
    world.set<InteractableC>(device, "interactable", { kind: "mapDevice", radius: fp(2.5), yaw: 0 });

    expect(() => sim.step([interactCmd(player, device)])).not.toThrow();
    // No session means no interactable effects; world should remain stable.
    expect(world.alive.has(player)).toBe(true);
  });
});
