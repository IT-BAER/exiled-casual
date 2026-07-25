import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { offerWaystones, atlasGraph, WAYSTONE_OFFER_COUNT } from "@exiled/rules";
import { MAP_PORTALS } from "@exiled/protocol";
import { Simulation } from "../loop";
import { registerInteractSystem } from "./interact";
import type { SessionC, Position, InteractableC } from "../components";

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
    mapSeed: 0,
    portalsLeft: 0,
    mapOpen: 0,
    pendingArea: "",
  };
  world.set<SessionC>(sessionE, "session", session);

  const device = world.create();
  world.set<Position>(device, "position", { x: fp(0), y: fp(8) });
  world.set<InteractableC>(device, "interactable", { kind: "mapDevice", radius: fp(2.5), yaw: 0 });

  return { sim, world, player, sessionE, device };
}

function interactCmd(player: number, targetId: number) {
  return { tick: 0, entity: player, type: "interact", data: { targetId } };
}

function activateCmd(player: number, atlasNodeId: string, waystoneId: string) {
  return { tick: 0, entity: player, type: "activateMap", atlasNodeId, waystoneId };
}

describe("registerInteractSystem", () => {
  it("activateMap opens the chosen waystone's map: sets seed/tier/node, six portals", () => {
    const { sim, world, player, sessionE } = makeWorld();
    const ws = offerWaystones(0, WAYSTONE_OFFER_COUNT)[0]!;

    sim.step([activateCmd(player, "node.ashen_glade", ws.id)]);

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
    const ws = offerWaystones(0, WAYSTONE_OFFER_COUNT)[0]!;
    sim.step([activateCmd(player, "node.nope", ws.id)]);
    expect(world.get<SessionC>(sessionE, "session")!.mapOpen).toBe(0);
  });

  it("activateMap is rejected for a waystone not in the offers", () => {
    const { sim, world, player, sessionE } = makeWorld();
    sim.step([activateCmd(player, "node.ashen_glade", "ws-999")]);
    expect(world.get<SessionC>(sessionE, "session")!.mapOpen).toBe(0);
  });

  it("activateMap is a no-op when a map is already open", () => {
    const { sim, world, player, sessionE } = makeWorld();
    const ws = offerWaystones(0, WAYSTONE_OFFER_COUNT)[0]!;
    sim.step([activateCmd(player, "node.ashen_glade", ws.id)]); // open once
    const seedAfterFirst = world.get<SessionC>(sessionE, "session")!.mapSeed;
    const ws2 = offerWaystones(0, WAYSTONE_OFFER_COUNT)[1]!;
    sim.step([activateCmd(player, "node.emberfall", ws2.id)]); // ignored
    expect(world.get<SessionC>(sessionE, "session")!.mapSeed).toBe(seedAfterFirst);
  });

  it("activateMap is rejected for a node the fog has not opened", () => {
    const { sim, world, player, sessionE } = makeWorld();
    const graph = atlasGraph(0);
    const shut = graph.find((n) => n.id !== graph[0]!.id && !graph[0]!.links.includes(n.id))!;
    const ws = offerWaystones(0, WAYSTONE_OFFER_COUNT)[0]!;
    sim.step([activateCmd(player, shut.id, ws.id)]);
    expect(world.get<SessionC>(sessionE, "session")!.mapOpen).toBe(0);
  });

  it("activateMap opens a neighbour once its route is cleared", () => {
    const { sim, world, player, sessionE } = makeWorld();
    const graph = atlasGraph(0);
    const neighbour = graph[0]!.links[0]!;
    const s = world.get<SessionC>(sessionE, "session")!;
    world.set<SessionC>(sessionE, "session", { ...s, completedNodes: [graph[0]!.id] });
    const ws = offerWaystones(0, WAYSTONE_OFFER_COUNT)[0]!;
    sim.step([activateCmd(player, neighbour, ws.id)]);
    expect(world.get<SessionC>(sessionE, "session")!.mapOpen).toBe(1);
  });

  it("the same waystone draws a different map at a different node", () => {
    const graph = atlasGraph(0);
    const ws = offerWaystones(0, WAYSTONE_OFFER_COUNT)[0]!;
    const seedAt = (nodeId: string, completed: string[]) => {
      const { sim, world, player, sessionE } = makeWorld();
      const s = world.get<SessionC>(sessionE, "session")!;
      world.set<SessionC>(sessionE, "session", { ...s, completedNodes: completed });
      sim.step([activateCmd(player, nodeId, ws.id)]);
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
    const ws = offerWaystones(0, WAYSTONE_OFFER_COUNT)[0]!;
    sim.step([activateCmd(player, "node.ashen_glade", ws.id)]);
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
      mapSeed: 0, portalsLeft: 6, mapOpen: 1, pendingArea: "",
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
      mapSeed: 0, portalsLeft: 4, mapOpen: 1, pendingArea: "",
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
