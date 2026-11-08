import { describe, it, expect } from "vitest";
import { fp, toNumber } from "@exiled/fixed-point";
import { MemoryKv } from "@exiled/persistence";
import { CONTENT_VERSION, HIDEOUT_SERVICES, decorById } from "@exiled/content-runtime";
import type { Intent } from "@exiled/protocol";
import { createCombatSim } from "./combat-sim";
import { intentToCommand, buildSnapshot } from "./protocol-bridge";
import { hideoutCollision, spawnPortalRing, MAP_DEVICE_POS } from "./areas";
import { saveTo, loadInto, snapshot as persistSnapshot } from "./persist";
import { checksumWorld } from "./checksum";
import type { HideoutLayoutC, InteractableC, Position } from "./components";

type G = ReturnType<typeof createCombatSim>;

const hideout = (): G => createCombatSim(7, { area: "hideout" });
const send = (g: G, intent: Intent) => g.sim.step([intentToCommand(intent, g.playerEntity, g.sim.tick)]);
const idle = (g: G, ticks: number) => { for (let i = 0; i < ticks; i++) g.sim.step([]); };
/** Screen units (right, up the frame) to world, the turn hideout.ts composes in. */
const at = (sx: number, sy: number) => ({ x: (sx - sy) * Math.SQRT1_2, z: (sx + sy) * Math.SQRT1_2 });
const place = (g: G, pieceId: string, p: { x: number; z: number }, rot = 0) =>
  send(g, { kind: "placeHideoutPiece", pieceId, x: fp(p.x), y: fp(p.z), rot });
const entityOf = (g: G, kind: string) => g.world.query("interactable")
  .find((e) => g.world.get<InteractableC>(e, "interactable")!.kind === kind)!;
const posOf = (g: G, kind: string) => g.world.get<Position>(entityOf(g, kind), "position")!;
const layout = (g: G) => g.world.get<HideoutLayoutC>(g.world.query("session")[0]!, "hideoutLayout")?.pieces ?? [];
const walkable = (g: G, p: { x: number; z: number }, body = 0) => hideoutCollision(g.world).isWalkable(fp(p.x), fp(p.z), fp(body));

describe("the hideout's default arrangement", () => {
  /** The owner's ask: Varkis behind a counter, and still clickable across it. */
  for (const [kind, table] of [["vendor", "vendor-counter"], ["cartographer", "carto-table"]] as const) {
    it(`${kind} stands behind ${table}, and the click on them still gets the player there`, () => {
      const g = hideout();
      const npc = HIDEOUT_SERVICES[kind];
      const t = decorById(table)!;
      const screen = (p: { x: number; z: number }) => ({ sx: (p.x + p.z) * Math.SQRT1_2, sy: (p.z - p.x) * Math.SQRT1_2 });
      // Behind = further up the frame than the table, in line with it.
      expect(screen(npc).sy).toBeGreaterThan(screen(t).sy + 0.6);
      expect(Math.abs(screen(npc).sx - screen(t).sx)).toBeLessThan(0.3);
      // The canvas click is a routed moveTo at the entity, then an interact once
      // the snapshot reports it in range (input/bindings.ts).
      const target = posOf(g, kind);
      for (let i = 0; i < 300; i++) {
        const snap = buildSnapshot(g.world, g.sim, g.sim.tick, CONTENT_VERSION);
        if (snap.entities.find((e) => e.kind === kind)!.inRange) return;
        send(g, { kind: "moveTo", x: target.x, y: target.y, routed: true });
      }
      throw new Error(`never came in range of ${kind}`);
    });
  }

  it("leaves the walk from the arrival spot to the device open", () => {
    const g = hideout();
    for (let t = 0; t <= 10; t++) {
      const p = { x: toNumber(MAP_DEVICE_POS.x) * t / 10 * 0.7, z: toNumber(MAP_DEVICE_POS.y) * t / 10 * 0.7 };
      expect(walkable(g, p, 0.5), `lane ${t}`).toBe(true);
    }
  });
});

describe("Edit Hideout", () => {
  it("moves a piece: the save, the snapshot and the collision all follow it", () => {
    const g = hideout();
    const crate = decorById("crate-carto")!;
    const to = at(-2, -2.5);
    expect(walkable(g, to)).toBe(true);
    place(g, crate.id, to, 90);
    expect(layout(g)).toEqual([{ id: crate.id, x: fp(to.x), y: fp(to.z), rot: 90 }]);
    expect(walkable(g, to)).toBe(false);
    expect(walkable(g, crate)).toBe(true);
    const snap = buildSnapshot(g.world, g.sim, g.sim.tick, CONTENT_VERSION);
    expect(snap.hideoutLayout).toEqual([{ id: crate.id, x: toNumber(fp(to.x)), y: toNumber(fp(to.z)), rot: 90 }]);
    expect(() => checksumWorld(g.world)).not.toThrow();
  });

  it("collides the live player against where the piece now stands", () => {
    const g = hideout();
    const spot = at(0, -2);
    place(g, "crate-carto", spot);
    // Straight down the frame from the arrival spot, through where the crate is.
    send(g, { kind: "moveDir", dx: 1, dy: -1 });
    idle(g, 90);
    const p = g.world.get<Position>(g.playerEntity, "position")!;
    const gap = Math.hypot(toNumber(p.x) - spot.x, toNumber(p.y) - spot.z);
    expect(gap).toBeGreaterThanOrEqual(0.28 + 0.5 - 0.05);
    // ...and he stopped on the near side of it, not past.
    expect(toNumber(p.x)).toBeLessThan(spot.x);
  });

  it("refuses a piece off the floor, on the player, on the arrival spot, off a rotation step or unknown", () => {
    const g = hideout();
    place(g, "crate-carto", at(0, 20));
    place(g, "crate-carto", at(0, 0));
    place(g, "crate-carto", at(3, 0), 7);
    place(g, "nope", at(3, 0));
    g.world.set<Position>(g.playerEntity, "position", { x: fp(at(3, 0).x), y: fp(at(3, 0).z) });
    place(g, "crate-carto", at(3, 0));
    expect(layout(g)).toEqual([]);
  });

  it("does nothing outside the hideout", () => {
    const g = createCombatSim(7, { area: "map" });
    place(g, "crate-carto", { x: 3, z: 3 });
    expect(layout(g)).toEqual([]);
  });

  it("moves a service, turned, and the device takes its portal ring with it", () => {
    const g = hideout();
    place(g, "vendor", at(2, -2), 90);
    const v = posOf(g, "vendor");
    expect([v.x, v.y]).toEqual([fp(at(2, -2).x), fp(at(2, -2).z)]);
    expect(g.world.get<InteractableC>(entityOf(g, "vendor"), "interactable")!.yaw).toBeCloseTo(Math.PI / 2, 6);

    spawnPortalRing(g.world, 6);
    const portals = () => g.world.query("interactable")
      .filter((e) => g.world.get<InteractableC>(e, "interactable")!.kind === "portal")
      .map((e) => ({ ...g.world.get<Position>(e, "position")! }));
    const before = portals();
    const d0 = { ...posOf(g, "mapDevice") };
    place(g, "mapDevice", at(0, 5));
    const d1 = posOf(g, "mapDevice");
    expect(portals()).toEqual(before.map((p) => ({ x: p.x + d1.x - d0.x, y: p.y + d1.y - d0.y })));
  });

  it("survives a save and a load, and the loaded room collides where the piece was put", async () => {
    const g = hideout();
    const to = at(-2, -2.5);
    place(g, "crate-carto", to, 45);
    place(g, "cartographer", at(-3, 0.5), 180);
    const kv = new MemoryKv();
    await saveTo(kv, g.world);
    expect(persistSnapshot(g.world)!.hideoutLayout).toHaveLength(2);

    const h = hideout();
    expect(await loadInto(kv, h.world)).toBe(true);
    idle(h, 1);
    expect(layout(h)).toEqual(layout(g));
    expect(walkable(h, to)).toBe(false);
    expect(posOf(h, "cartographer")).toEqual(posOf(g, "cartographer"));
  });

  it("drops what a hand-edited save cannot mean, and keeps the rest", async () => {
    const g = hideout();
    const state = persistSnapshot(g.world)!;
    const good = { id: "pillar-e", x: fp(at(5, -3).x), y: fp(at(5, -3).z), rot: 30 };
    state.hideoutLayout = [
      good,
      { id: "nope", x: 0, y: 0, rot: 0 },
      { id: "barrel-carto", x: 1.5, y: 0, rot: 0 },
      { id: "crate-carto", x: 0, y: fp(40), rot: 0 },
      { id: "sack-nw", x: 0, y: 0, rot: 10 },
    ];
    const kv = new MemoryKv();
    await kv.save(JSON.stringify(state));
    const h = hideout();
    await loadInto(kv, h.world);
    expect(layout(h)).toEqual([good]);
  });

  it("resets every piece, and a player the furniture comes back onto is put on the arrival spot", () => {
    const g = hideout();
    const crate = decorById("crate-carto")!;
    place(g, crate.id, at(-2, -2.5));
    // Stand him where the crate used to be, then put it back on him.
    g.world.set<Position>(g.playerEntity, "position", { x: fp(crate.x), y: fp(crate.z) });
    send(g, { kind: "resetHideoutLayout" });
    expect(layout(g)).toEqual([]);
    expect(walkable(g, crate)).toBe(false);
    expect(g.world.get<Position>(g.playerEntity, "position")).toEqual({ x: 0, y: 0 });
  });
});
