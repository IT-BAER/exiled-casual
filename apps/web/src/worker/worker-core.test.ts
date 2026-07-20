import { describe, it, expect } from "vitest";
import { WorkerCore } from "./worker-core";
import type { Intent } from "@pact/protocol";
import { fp } from "@pact/fixed-point";

function monsters(core: WorkerCore) {
  return core.snapshot()!.entities.filter((e) => e.kind === "monster");
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
});
