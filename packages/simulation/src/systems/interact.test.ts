import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { offerWaystones, atlasGraph, WAYSTONE_OFFER_COUNT, atlasNodeTier, WAYSTONE_MAX_TIER } from "@exiled/rules";
import { MAP_PORTALS } from "@exiled/protocol";
import { waystoneItem, permanentWaystone, isPermanentWaystone, describeItem, currencyItem, isPortalScroll, PORTAL_SCROLL_BASE_ID, SKILLS, TOWN_PORTAL_SKILL } from "@exiled/content-runtime";
import { Simulation } from "../loop";
import { registerInteractSystem } from "./interact";
import { registerSkillCast } from "./skill-cast";
import type { World } from "../ecs";
import type { SessionC, Position, InteractableC, InventoryC, ContainerC } from "../components";

function makeWorld() {
  const sim = new Simulation();
  registerInteractSystem(sim);
  // The Portal skill is the way home now, so the session rules it obeys (an open
  // map, a scroll in the bag, no doorway already underfoot) are cast through the
  // skill system rather than through a command of its own.
  registerSkillCast(sim, SKILLS);
  const { world } = sim;

  const player = world.create();
  world.set(player, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
  world.set(player, "mana", { mana: fp(60), maxMana: fp(60), regen: 0 });
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

    sim.step([activateCmd(player, "node.the_wrackline", { x: 0, y: 0 })]);

    const session = world.get<SessionC>(sessionE, "session")!;
    expect(session.mapOpen).toBe(1);
    expect(session.areaTier).toBe(ws.tier);
    expect(session.activeNodeId).toBe("node.the_wrackline");
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
    sim.step([activateCmd(player, "node.the_wrackline", { x: 99, y: 0 })]);
    expect(world.get<SessionC>(sessionE, "session")!.mapOpen).toBe(0);
  });

  /**
   * The device used to refuse while a run was open, which meant an open map made
   * the Atlas unreachable until you finished it or died in it. It replaces now.
   */
  it("activateMap with a run already open replaces it", () => {
    const { sim, world, player, sessionE } = makeWorld();
    sim.step([activateCmd(player, "node.the_wrackline", { x: 0, y: 0 })]);
    const first = world.get<SessionC>(sessionE, "session")!;
    expect(first.mapOpen).toBe(1);
    // Spend some of the first run's budget, so a fresh six is visible as a reset.
    world.set<SessionC>(sessionE, "session", { ...first, portalsLeft: 2 });

    const at = giveStone(world, sessionE, WAYSTONE_MAX_TIER);
    sim.step([activateCmd(player, "node.the_wrackline", at)]);

    const second = world.get<SessionC>(sessionE, "session")!;
    expect(second.mapSeed).not.toBe(first.mapSeed);
    expect(second.portalsLeft).toBe(MAP_PORTALS);
    expect(second.mapOpen).toBe(1);
  });

  it("replacing a run leaves six portals round the device, not twelve", () => {
    const { sim, world, player, sessionE } = makeWorld();
    sim.step([activateCmd(player, "node.the_wrackline", { x: 0, y: 0 })]);
    const ring = () => world
      .query("interactable")
      .filter((e) => world.get<InteractableC>(e, "interactable")!.kind === "portal").length;
    expect(ring()).toBe(MAP_PORTALS);
    const at = giveStone(world, sessionE, WAYSTONE_MAX_TIER);
    sim.step([activateCmd(player, "node.the_wrackline", at)]);
    expect(ring()).toBe(MAP_PORTALS);
  });

  it("but not from inside the map, where there is no device", () => {
    const { sim, world, player, sessionE } = makeWorld();
    sim.step([activateCmd(player, "node.the_wrackline", { x: 0, y: 0 })]);
    const first = world.get<SessionC>(sessionE, "session")!;
    world.set<SessionC>(sessionE, "session", { ...first, area: "map" });
    const at = giveStone(world, sessionE, WAYSTONE_MAX_TIER);
    sim.step([activateCmd(player, "node.the_wrackline", at)]);
    expect(world.get<SessionC>(sessionE, "session")!.mapSeed).toBe(first.mapSeed);
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

  /**
   * PoE1's rule, not PoE2's: a map is somewhere you can always go back to when
   * you hold a stone for it. With 15 fixed nodes, "cleared = never again" would
   * end the game at run 15. Completion still drives fog, tiers and the boss's
   * first-clear reward; it is not a lock.
   */
  it("activateMap re-opens an already-completed node", () => {
    const { sim, world, player, sessionE } = makeWorld();
    const s = world.get<SessionC>(sessionE, "session")!;
    world.set<SessionC>(sessionE, "session", { ...s, completedNodes: ["node.the_wrackline"] });
    sim.step([activateCmd(player, "node.the_wrackline", { x: 0, y: 0 })]);
    expect(world.get<SessionC>(sessionE, "session")!.mapOpen).toBe(1);
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

  /**
   * Walking out closes one portal behind you, which is PoE1's rule and the second
   * half of the Portal Scroll ask: a way home that costs nothing would make the
   * budget meaningless.
   */
  it("portal click in the map sets pendingArea='hideout' and closes one portal", () => {
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
    expect(session.portalsLeft).toBe(3);
    expect(session.mapOpen).toBe(1);
  });

  it("walking out on the last portal closes the map behind him", () => {
    const { sim, world, player, sessionE } = makeWorld();
    world.set<SessionC>(sessionE, "session", {
      area: "map", atlasSeed: 0, areaTier: 0, activeNodeId: "", completedNodes: [],
      mapSeed: 0, waystoneSeed: 0, portalsLeft: 1, mapOpen: 1, pendingArea: "",
    });
    const portal = world.create();
    world.set<Position>(portal, "position", { x: fp(0), y: fp(8) });
    world.set<InteractableC>(portal, "interactable", { kind: "portal", radius: fp(2.5), yaw: 0 });

    sim.step([interactCmd(player, portal)]);

    const session = world.get<SessionC>(sessionE, "session")!;
    expect(session.portalsLeft).toBe(0);
    expect(session.mapOpen).toBe(0);
  });

  /**
   * The floor under sustain. Stones are spent on activation and only come back
   * off a dead map boss, so before this a character who abandoned a run on the
   * last one could never enter a map again — every one of these three rules is
   * load-bearing for that, and all three are invisible in the client.
   */
  describe("the permanent waystone", () => {
    /** Nothing but the permanent stone in the bag, at a known cell. */
    function onlyPermanent(world: World, sessionE: number) {
      const inv = world.get<InventoryC>(sessionE, "inventory")!;
      world.set<InventoryC>(sessionE, "inventory", {
        ...inv, items: [{ x: 3, y: 2, w: 1, h: 1, item: permanentWaystone() }],
      });
    }

    it("opens a map without being consumed", () => {
      const { sim, world, player, sessionE } = makeWorld();
      onlyPermanent(world, sessionE);

      sim.step([activateCmd(player, "node.the_wrackline", { x: 3, y: 2 })]);

      const session = world.get<SessionC>(sessionE, "session")!;
      expect(session.mapOpen, "the map opened").toBe(1);
      // Tier 1 with no modifiers, so what it buys is the right to keep playing
      // and never a better run than a stone the Atlas actually paid out.
      expect(session.areaTier).toBe(1);
      expect(session.waystoneSeed).toBe(0);
      const after = world.get<InventoryC>(sessionE, "inventory")!.items;
      expect(after, "still in the bag").toHaveLength(1);
      expect(isPermanentWaystone(after[0]!.item)).toBe(true);
    });

    it("stays white: normal rarity, no modifiers, and says so", () => {
      const described = describeItem(permanentWaystone());
      expect(described.rarity).toBe("normal");
      expect(described.lines).toEqual(["Not consumed on use", "Cannot be modified"]);
    });

    it("cannot open a node that outranks Tier 1", () => {
      const { sim, world, player, sessionE } = makeWorld();
      onlyPermanent(world, sessionE);
      const graph = atlasGraph(0);
      const steep = graph.find((n) => atlasNodeTier(graph, n.id) > 1);
      if (!steep) return; // no such node on this seed
      sim.step([activateCmd(player, steep.id, { x: 3, y: 2 })]);
      expect(world.get<SessionC>(sessionE, "session")!.mapOpen).toBe(0);
    });
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

/**
 * The Portal Scroll: a way home from where you are standing, for a bag that filled
 * up two rooms from the exit.
 */
describe("Portal Scroll", () => {
  function inMap(portalsLeft = 6, scrolls = 1) {
    const w = makeWorld();
    w.world.set<SessionC>(w.sessionE, "session", {
      area: "map", atlasSeed: 0, areaTier: 3, activeNodeId: "", completedNodes: [],
      mapSeed: 0, waystoneSeed: 0, portalsLeft, mapOpen: 1, pendingArea: "",
    });
    w.world.set<InventoryC>(w.sessionE, "inventory", {
      cols: 12, rows: 5,
      items: scrolls > 0
        ? [{ x: 0, y: 0, w: 1, h: 1, item: currencyItem(PORTAL_SCROLL_BASE_ID), count: scrolls }]
        : [],
    });
    return w;
  }
  /** Press Y and hold still until the doorway is torn open. The skill has a
   *  wind-up, so nothing at all has happened on the tick of the press. */
  const CAST_TICKS = SKILLS.get(TOWN_PORTAL_SKILL)!.castTicks!;
  function castPortal(sim: Simulation, player: number): void {
    sim.step([{ tick: sim.tick, entity: player, type: "useSkill", skillId: TOWN_PORTAL_SKILL }]);
    for (let t = 0; t < CAST_TICKS; t++) sim.step([]);
  }
  const portals = (world: World) => world
    .query("interactable", "position")
    .filter((e) => world.get<InteractableC>(e, "interactable")!.kind === "portal");
  const scrollsLeft = (world: World, sessionE: number) => {
    const held = world.get<InventoryC>(sessionE, "inventory")!.items.find((p) => isPortalScroll(p.item));
    return held === undefined ? 0 : held.count ?? 1;
  };

  it("opens a portal at the player's feet and spends one scroll", () => {
    const { sim, world, player, sessionE } = inMap(6, 3);
    castPortal(sim, player);
    const open = portals(world);
    expect(open).toHaveLength(1);
    expect(world.get<Position>(open[0]!, "position")).toEqual({ x: fp(0), y: fp(8) });
    expect(scrollsLeft(world, sessionE)).toBe(2);
    // Opening it is not walking through it: the portal budget is untouched.
    expect(world.get<SessionC>(sessionE, "session")!.portalsLeft).toBe(6);
  });

  it("the last scroll leaves the cell rather than a stack of zero", () => {
    const { sim, world, player, sessionE } = inMap(6, 1);
    castPortal(sim, player);
    expect(world.get<InventoryC>(sessionE, "inventory")!.items).toHaveLength(0);
    expect(portals(world)).toHaveLength(1);
  });

  it("no scroll, no portal", () => {
    const { sim, world, player } = inMap(6, 0);
    castPortal(sim, player);
    expect(portals(world)).toHaveLength(0);
  });

  it("does nothing in the hideout, where there is nothing to leave", () => {
    const { sim, world, player, sessionE } = makeWorld();
    world.set<InventoryC>(sessionE, "inventory", {
      cols: 12, rows: 5,
      items: [{ x: 0, y: 0, w: 1, h: 1, item: currencyItem(PORTAL_SCROLL_BASE_ID) }],
    });
    castPortal(sim, player);
    expect(portals(world)).toHaveLength(0);
    expect(scrollsLeft(world, sessionE)).toBe(1);
  });

  /** A scroll spent on a doorway that is already there buys nothing, so it is kept. */
  it("refuses to spend a scroll where a portal already stands", () => {
    const { sim, world, player, sessionE } = inMap(6, 2);
    castPortal(sim, player);
    castPortal(sim, player);
    expect(portals(world)).toHaveLength(1);
    expect(scrollsLeft(world, sessionE)).toBe(1);
  });

  /** One way home per area: a second casting moves the doorway, it does not add
   *  one. Every portal in a map leads to the same hideout, so a second is only a
   *  thing to trip over. */
  it("a second casting replaces the first rather than standing beside it", () => {
    const { sim, world, player, sessionE } = inMap(6, 2);
    castPortal(sim, player);
    world.set<Position>(player, "position", { x: fp(30), y: fp(30) });
    // Past the cooldown: it is ten seconds, which is the whole answer to "so it
    // doesn't get spammed", and a test that skipped it would be testing nothing.
    for (let t = 0; t < SKILLS.get(TOWN_PORTAL_SKILL)!.cooldownTicks; t++) sim.step([]);
    castPortal(sim, player);
    const open = portals(world);
    expect(open).toHaveLength(1);
    expect(world.get<Position>(open[0]!, "position")).toEqual({ x: fp(30), y: fp(30) });
    expect(scrollsLeft(world, sessionE)).toBe(0);
  });

  it("will not open a second one inside the cooldown", () => {
    const { sim, world, player, sessionE } = inMap(6, 2);
    castPortal(sim, player);
    world.set<Position>(player, "position", { x: fp(30), y: fp(30) });
    castPortal(sim, player); // pressed again immediately: refused, scroll kept
    expect(portals(world)).toHaveLength(1);
    expect(scrollsLeft(world, sessionE)).toBe(1);
  });

  /** A press that opened nothing must not cost ten seconds: the cooldown is
   *  refunded, so an empty bag reads as "nothing happened" and not as "broken". */
  it("refunds the cooldown when there was no scroll to spend", () => {
    const { sim, world, player, sessionE } = inMap(6, 0);
    castPortal(sim, player);
    expect(portals(world)).toHaveLength(0);
    world.set<InventoryC>(sessionE, "inventory", {
      cols: 12, rows: 5,
      items: [{ x: 0, y: 0, w: 1, h: 1, item: currencyItem(PORTAL_SCROLL_BASE_ID) }],
    });
    castPortal(sim, player);
    expect(portals(world)).toHaveLength(1);
  });

  it("the portal it opens is a real way out: taking it spends a portal", () => {
    const { sim, world, player, sessionE } = inMap(4, 1);
    castPortal(sim, player);
    const portal = portals(world)[0]!;
    sim.step([interactCmd(player, portal)]);
    const session = world.get<SessionC>(sessionE, "session")!;
    expect(session.pendingArea).toBe("hideout");
    expect(session.portalsLeft).toBe(3);
  });
});

describe("containers", () => {
  function withContainer() {
    const ctx = makeWorld();
    const { world } = ctx;
    const chest = world.create();
    world.set<Position>(chest, "position", { x: fp(0), y: fp(8) });
    world.set<InteractableC>(chest, "interactable", { kind: "container", radius: fp(2), yaw: 0 });
    world.set<ContainerC>(chest, "container", { look: "chest", key: "cache:7:0:reward.test", opened: 0 });
    return { ...ctx, chest };
  }

  it("opening a container spills at least one item and marks it opened", () => {
    const { sim, world, player, chest } = withContainer();
    sim.step([interactCmd(player, chest)]);
    expect(world.get<ContainerC>(chest, "container")!.opened).toBe(1);
    expect(world.query("item").length).toBeGreaterThanOrEqual(1);
  });

  it("a second click is a no-op, not a re-roll", () => {
    const { sim, world, player, chest } = withContainer();
    sim.step([interactCmd(player, chest)]);
    const paid = world.query("item").length;
    sim.step([interactCmd(player, chest)]);
    expect(world.query("item").length).toBe(paid);
  });

  it("out of range pays nothing", () => {
    const { sim, world, player, chest } = withContainer();
    world.set<Position>(player, "position", { x: fp(20), y: fp(20) });
    sim.step([interactCmd(player, chest)]);
    expect(world.get<ContainerC>(chest, "container")!.opened).toBe(0);
    expect(world.query("item").length).toBe(0);
  });

  it("the same key pays the same items — the roll is the anchor's, not the click's", () => {
    const a = withContainer();
    const b = withContainer();
    a.sim.step([interactCmd(a.player, a.chest)]);
    // Open b's on a different tick to prove the click's moment does not matter.
    b.sim.step([]);
    b.sim.step([]);
    b.sim.step([interactCmd(b.player, b.chest)]);
    const names = (w: World) => w.query("item").map((e) => JSON.stringify(w.get(e, "item"))).sort();
    expect(names(a.world)).toEqual(names(b.world));
  });
});
