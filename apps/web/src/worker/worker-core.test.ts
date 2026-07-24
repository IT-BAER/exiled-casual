import { describe, it, expect } from "vitest";
import { WorkerCore } from "./worker-core";
import type { Intent, Snapshot } from "@exiled/protocol";
import { fp } from "@exiled/fixed-point";
import { generateArea } from "@exiled/mapgen";
import { offerWaystones, WAYSTONE_OFFER_COUNT } from "@exiled/rules";
import { CONTENT_VERSION } from "@exiled/content-runtime";

function monsters(core: WorkerCore) {
  return core.snapshot()!.entities.filter((e) => e.kind === "monster");
}

function advanceUntil(core: WorkerCore, pred: (s: Snapshot) => boolean, maxTicks = 600): Snapshot {
  for (let i = 0; i < maxTicks; i++) {
    core.advance(34);
    const s = core.snapshot()!;
    if (pred(s)) return s;
  }
  throw new Error("advanceUntil: predicate never held");
}

/**
 * Steer to a world-unit point and advance until the player is within interact
 * range of it. Snapshot positions are world floats, but moveTo wants fixed-point.
 */
function walkTo(core: WorkerCore, x: number, y: number): void {
  core.pushIntent({ kind: "moveTo", x: fp(x), y: fp(y) });
  advanceUntil(core, (s) => Math.hypot(s.player.x - x, s.player.y - y) <= 2);
}

// ponytail: determinism is the whole point — these three cases cover the contract
describe("WorkerCore", () => {
  it("advance(100) from rest produces exactly 3 ticks (3 × ~33.33 ms ≤ 100 ms)", () => {
    const core = new WorkerCore(42);
    const snaps = core.advance(100);
    expect(snaps.length).toBe(3);
    expect(snaps[snaps.length - 1]!.tick).toBe(3);
  });

  it("two seeds produce identical snapshot sequences (determinism)", () => {
    const intent: Intent = { kind: "moveDir", dx: 1, dy: 0 };
    const coreA = new WorkerCore(42);
    const coreB = new WorkerCore(42);
    coreA.pushIntent(intent);
    coreB.pushIntent(intent);
    const snapsA = coreA.advance(100);
    const snapsB = coreB.advance(100);
    expect(JSON.stringify(snapsA)).toBe(JSON.stringify(snapsB));
  });

  it("starts with an empty arena so an actor can be inspected in peace", () => {
    const core = new WorkerCore(42);
    core.advance(34); // one tick
    expect(monsters(core).length).toBe(0);
  });

  it("spawns on demand and clears again", () => {
    const core = new WorkerCore(42);
    core.advance(34);

    core.spawn("pack");
    core.advance(34);
    expect(monsters(core).length).toBe(5);

    core.spawn("boss");
    core.advance(34);
    const withBoss = monsters(core);
    expect(withBoss.length).toBe(6);
    expect(withBoss.some((e) => e.boss)).toBe(true);

    core.spawn("clear");
    core.advance(34);
    expect(monsters(core).length).toBe(0);
  });

  it("a pushed moveTo intent moves the player toward the target", () => {
    const core = new WorkerCore(42);
    // Player spawns at origin (0,0); target is +x/+y, so both coords must increase.
    const intent: Intent = { kind: "moveTo", x: fp(10), y: fp(10) };
    core.pushIntent(intent);
    core.advance(34); // one tick
    const after = core.snapshot();

    expect(after).not.toBeNull();
    expect(after!.player.x).toBeGreaterThan(0);
    expect(after!.player.y).toBeGreaterThan(0);
  });

  it("exposes the area layout for transport, deterministic for the seed", () => {
    // Same seed + content version as generateArea → identical layout (same hash).
    const core = new WorkerCore(42);
    expect(core.getAreaLayout().hash).toBe(generateArea(42, CONTENT_VERSION).hash);
  });

  it("flags an area change and swaps to the map layout when the player enters through a portal", () => {
    const core = new WorkerCore(42);
    core.advance(34);
    expect(core.getArea()).toBe("hideout");
    expect(core.consumeAreaChange()).toBe(false); // no change yet

    // Open the portal ring by activating a map (T5: activateMap opens it, not a
    // device interact — that is now a no-op). ws-0 resolves against the session seed.
    core.pushIntent({ kind: "activateMap", atlasNodeId: "node.ashen_glade", waystoneId: "ws-0" });
    advanceUntil(core, (s) => s.entities.some((e) => e.kind === "portal"));

    // Step through a portal into the dungeon.
    const portal = core.snapshot()!.entities.find((e) => e.kind === "portal")!;
    walkTo(core, portal.x, portal.y);
    core.pushIntent({ kind: "interact", targetId: portal.id });
    advanceUntil(core, () => core.getArea() === "map");

    // The glue can now re-send `area`, and the rendered layout must match the map
    // the sim actually installed collision for: generateArea(mapSeed), where the
    // map seed is the activated waystone's seed — NOT the combat-lab seed. If the
    // render layout and the collision grid diverge, walls are walkable and empty
    // floor blocks (the "walk through some walls, invisible walls elsewhere" bug).
    expect(core.consumeAreaChange()).toBe(true);
    expect(core.consumeAreaChange()).toBe(false); // one-shot
    const mapSeed = offerWaystones(42, WAYSTONE_OFFER_COUNT)[0]!.seed;
    expect(core.getAreaLayout().hash).toBe(generateArea(mapSeed, CONTENT_VERSION).hash);
  });
});
