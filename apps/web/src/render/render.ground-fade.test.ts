// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import { NullEngine } from "@babylonjs/core";
import { createScene } from "./engine";
import { SnapshotRenderer, GROUND_FADE_TICKS } from "./renderer";
import type { AreaKind, Snapshot, SnapshotEntity } from "@exiled/protocol";
import { testPlayer } from "../test-fixtures";

function snap(tick: number, entities: SnapshotEntity[] = [], area: AreaKind = "map"): Snapshot {
  return {
    tick, player: testPlayer(), area, portalsLeft: 0, mapOpen: false, areaTier: 0, atlasSeed: 0,
    completedNodes: [], entities,
    inventory: { cols: 12, rows: 5, items: [] }, stash: { cols: 12, rows: 12, items: [] },
    vendor: { cols: 12, rows: 12, items: [] }, shards: {}, equipment: {},
  };
}

const patch: SnapshotEntity = { id: 7, kind: "groundArea", x: 2, y: 2, radius: 2.5, skillId: "cinder_ground" };

let engine: InstanceType<typeof NullEngine>;
afterEach(() => engine?.dispose());

describe("a ground effect the sim removed", () => {
  it("burns out over a short tail instead of vanishing", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const r = new SnapshotRenderer(scene);
    const s0 = snap(1, [patch]);
    r.apply(null, s0, 1);
    const mesh = scene.getMeshByName("entity-7")!;
    const width = mesh.scaling.x;
    const embers = scene.particleSystems.find((p) => p.emitter === mesh)!;
    const stop = vi.spyOn(embers, "stop");

    let prev = snap(2);
    r.apply(s0, prev, 1);
    expect(mesh.isDisposed()).toBe(false);

    const mid = snap(2 + Math.floor(GROUND_FADE_TICKS / 2));
    r.apply(prev, mid, 1);
    prev = mid;
    expect(mesh.visibility).toBeLessThan(1);
    expect(mesh.visibility).toBeGreaterThan(0);
    expect(mesh.scaling.x).toBeLessThan(width);
    expect(stop).toHaveBeenCalled();

    const end = snap(2 + GROUND_FADE_TICKS * 3);
    r.apply(prev, end, 1);
    expect(mesh.isDisposed()).toBe(true);
  });

  it("does not follow the player across an area change", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const r = new SnapshotRenderer(scene);
    const s0 = snap(1, [patch]);
    r.apply(null, s0, 1);
    const mesh = scene.getMeshByName("entity-7")!;
    r.apply(s0, snap(2, [], "hideout"), 1);
    expect(mesh.isDisposed()).toBe(true);
  });
});
