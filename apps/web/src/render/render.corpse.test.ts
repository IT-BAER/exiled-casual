// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import { NullEngine } from "@babylonjs/core";
import { createScene } from "./engine";
import { SnapshotRenderer } from "./renderer";
import type { Snapshot } from "@exiled/protocol";
import { testPlayer, testStats } from "../test-fixtures";

// Havok never loads headless, so dropDead refuses and fell() can't run. The
// physics is the boundary being mocked, not the behavior under test: with it
// stubbed, a monster that vanishes from a same-area snapshot takes the real
// corpse path, which is exactly the population that rode into the hideout.
vi.mock("./ragdoll", async (importOriginal) => ({
  ...await importOriginal<typeof import("./ragdoll")>(),
  dropDead: () => true,
  freezeRagdoll: vi.fn(),
  disposeRagdoll: vi.fn(),
}));

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    tick: 1,
    player: testPlayer(),
    area: "map",
    portalsLeft: 0,
    mapOpen: false,
    areaTier: 0,
    atlasSeed: 0,
    completedNodes: [],
    entities: [],
    inventory: { cols: 12, rows: 5, items: [] },
    stash: { cols: 12, rows: 12, items: [] },
    vendor: { cols: 12, rows: 12, items: [] },
    shards: {},
    equipment: {},
    ...overrides,
  };
}

let engine: InstanceType<typeof NullEngine>;

afterEach(() => {
  engine?.dispose();
});

describe("corpses across an area change", () => {
  it("keeps a fallen monster lying in its own area", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);

    const s0 = makeSnapshot({
      entities: [{ id: 3, kind: "monster", x: 1, y: 1, life: 10, maxLife: 10 }],
    });
    renderer.apply(null, s0, 1);
    const mesh = scene.getMeshByName("entity-3")!;
    expect(mesh).not.toBeNull();

    renderer.apply(s0, makeSnapshot({ tick: 2 }), 1);
    expect(mesh.isDisposed()).toBe(false);
  });

  it("disposes corpses on the crossing instead of letting them ride the sink timer", () => {
    // The sim's last map snapshot arrives with the entities already stripped, so
    // every live monster falls as a corpse; the next snapshot is the hideout.
    // The corpse timer is 25s+3s of map ticks, which is exactly how long ~220
    // meshes sat in the hideout at 40fps before clearing themselves.
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);

    const s0 = makeSnapshot({
      entities: [{ id: 3, kind: "monster", x: 1, y: 1, life: 10, maxLife: 10 }],
    });
    renderer.apply(null, s0, 1);
    const mesh = scene.getMeshByName("entity-3")!;

    const s1 = makeSnapshot({ tick: 2 });
    renderer.apply(s0, s1, 1);
    expect(mesh.isDisposed()).toBe(false); // a corpse, per the test above

    renderer.apply(s1, makeSnapshot({ tick: 3, area: "hideout" }), 1);
    expect(mesh.isDisposed()).toBe(true);
  });

  it("catches a crossing even when the snapshot pair straddling it was never applied", () => {
    // apply() runs per rendered frame while snapshots advance per worker
    // message: a burst across the transition leaves both prev and next already
    // in the new area by the first apply after it. Keyed on prev.area alone,
    // that apply reads as "same area, 37 monsters vanished" and fell() ragdolls
    // the lot of them into the hideout - the fast-switch strand.
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);

    const s0 = makeSnapshot({
      entities: [{ id: 3, kind: "monster", x: 1, y: 1, life: 10, maxLife: 10 }],
    });
    renderer.apply(null, s0, 1);
    const mesh = scene.getMeshByName("entity-3")!;

    const h1 = makeSnapshot({ tick: 2, area: "hideout" });
    const h2 = makeSnapshot({ tick: 3, area: "hideout" });
    renderer.apply(h1, h2, 1); // the (s0, h1) pair was skipped by a burst

    expect(mesh.isDisposed()).toBe(true);
  });
});
