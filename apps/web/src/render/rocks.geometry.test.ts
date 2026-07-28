import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine, Scene, MeshBuilder, StandardMaterial, type Mesh } from "@babylonjs/core";

/**
 * Boulders and floor debris are the same six source meshes at two sizes, so they
 * are built by two `buildRocks` calls that clone the same sources. A clone SHARES
 * its source's Geometry, and `thinInstanceSetBuffer` writes the instanced
 * attributes onto the geometry while the matrices it reports back live on the
 * mesh — so the second call silently overwrote what the first one drew and the
 * map's whole boundary rendered as pebbles lying on open floor.
 *
 * Nothing caught it: instance count, bounding box and matrix buffer all still
 * read as correct boulders, because every one of those is per-mesh. The only
 * thing that was wrong was what the GPU had, which is what this pins.
 */

let sources: Mesh[] = [];

vi.mock("@babylonjs/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@babylonjs/core")>()),
  LoadAssetContainerAsync: () =>
    Promise.resolve({ meshes: sources, dispose: () => {} }),
}));

const { buildRocks, loadRocks, resetRocks } = await import("./rocks");

const placement = (x: number, width: number) => ({
  x, y: 0, z: 0, width, height: width, yaw: 0, tiltX: 0, tiltZ: 0, variant: 0,
});

describe("buildRocks geometry ownership", () => {
  let engine: InstanceType<typeof NullEngine>;
  let scene: Scene;

  beforeEach(async () => {
    engine = new NullEngine();
    scene = new Scene(engine);
    sources = [MeshBuilder.CreateBox("rock-a", { size: 1 }, scene)];
    resetRocks();
    await loadRocks(scene);
  });

  afterEach(() => {
    resetRocks();
    scene.dispose();
    engine.dispose();
  });

  it("gives each prefix its own geometry, so one build cannot overwrite the other", () => {
    const material = new StandardMaterial("m", scene);
    const boulders = buildRocks(scene, [placement(0, 1.8)], material);
    const debris = buildRocks(scene, [placement(5, 0.2)], material, "wallrun-debris-");

    expect(boulders).not.toBeNull();
    expect(debris).not.toBeNull();
    expect(boulders![0]!.geometry).not.toBe(debris![0]!.geometry);
    // and neither may still be riding the source's geometry
    expect(boulders![0]!.geometry).not.toBe(sources[0]!.geometry);
  });

  it("keeps the boulder's own scale after a debris build has run", () => {
    const material = new StandardMaterial("m", scene);
    const boulders = buildRocks(scene, [placement(0, 1.8)], material);
    buildRocks(scene, [placement(5, 0.2)], material, "wallrun-debris-");

    // The instanced attribute buffer on the boulder's geometry, not the copy the
    // mesh keeps: the mesh-side copy stayed correct all through the bug.
    const buf = boulders![0]!.geometry!.getVertexBuffer("world0");
    expect(buf).toBeTruthy();
    expect(buf!.getData()![0]).toBeCloseTo(1.8, 5);
  });
});
