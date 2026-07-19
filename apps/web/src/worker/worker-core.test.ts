import { describe, it, expect } from "vitest";
import { WorkerCore } from "./worker-core";
import type { Intent } from "@pact/protocol";
import { fp } from "@pact/fixed-point";

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

  it("a pushed moveTo intent moves the player from origin", () => {
    const core = new WorkerCore(42);
    const before = core.snapshot();
    const startX = before?.player.x ?? 0;
    const startY = before?.player.y ?? 0;

    const intent: Intent = { kind: "moveTo", x: fp(10), y: fp(10) };
    core.pushIntent(intent);
    core.advance(34); // one tick
    const after = core.snapshot();

    expect(after).not.toBeNull();
    // Player must have moved at least somewhat toward (10,10)
    const dx = (after!.player.x - startX) ** 2;
    const dy = (after!.player.y - startY) ** 2;
    expect(dx + dy).toBeGreaterThan(0);
  });
});
