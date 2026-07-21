import { describe, it, expect } from "vitest";
import { fp } from "@pact/fixed-point";
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

describe("registerInteractSystem", () => {
  it("in-range click on map device opens the map: mapOpen=1, portalsLeft=6, six portals created", () => {
    const { sim, world, player, sessionE, device } = makeWorld();
    // Player is at device position → d2=0 ≤ r2 → in range.
    sim.step([interactCmd(player, device)]);

    const session = world.get<SessionC>(sessionE, "session")!;
    expect(session.mapOpen).toBe(1);
    expect(session.portalsLeft).toBe(6);
    expect(world.query("interactable").filter(e =>
      world.get<InteractableC>(e, "interactable")!.kind === "portal",
    )).toHaveLength(6);
  });

  it("clicking the device again while already open is a no-op", () => {
    const { sim, world, player, sessionE, device } = makeWorld();
    // Open the map first.
    sim.step([interactCmd(player, device)]);
    const portalsBefore = world.query("interactable").filter(e =>
      world.get<InteractableC>(e, "interactable")!.kind === "portal",
    ).length;

    // Second click.
    sim.step([interactCmd(player, device)]);
    const portalsAfter = world.query("interactable").filter(e =>
      world.get<InteractableC>(e, "interactable")!.kind === "portal",
    ).length;

    expect(portalsAfter).toBe(portalsBefore); // no additional portals spawned
    expect(world.get<SessionC>(sessionE, "session")!.portalsLeft).toBe(6);
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
