// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { NullEngine, Scene, Vector3 } from "@babylonjs/core";
import type { Mesh } from "@babylonjs/core";
import { hitSparkle, shardCount, SPARKLE_NAME, SPARKLE_CAPACITY, MAX_SHARDS, MIN_SHARDS } from "./hit-sparkle";

let engine: NullEngine | undefined;
afterEach(() => {
  engine?.dispose();
  engine = undefined;
});

function newScene(): Scene {
  engine = new NullEngine();
  return new Scene(engine);
}

function host(scene: Scene, part: "core" | "shard"): Mesh {
  return scene.getMeshByName(`${SPARKLE_NAME}-${part}`) as Mesh;
}

/** Thin instances drawn at a non-zero scale, read off the raw matrix buffer. */
function drawn(mesh: Mesh): number {
  const data = (mesh as unknown as { _thinInstanceDataStorage: { matrixData: Float32Array } })
    ._thinInstanceDataStorage.matrixData;
  let n = 0;
  for (let i = 0; i < mesh.thinInstanceCount; i++) {
    const o = i * 16;
    if (Math.hypot(data[o]!, data[o + 1]!, data[o + 2]!) > 1e-6) n++;
  }
  return n;
}

describe("hit sparkle", () => {
  it("throws more shards for a harder hit, within 5..8", () => {
    expect(MIN_SHARDS).toBe(5);
    expect(MAX_SHARDS).toBe(8);
    expect(shardCount(0)).toBe(MIN_SHARDS);
    expect(shardCount(1)).toBe(MAX_SHARDS);
    expect(shardCount(0.5)).toBeGreaterThanOrEqual(shardCount(0.1));

    const scene = newScene();
    const fx = hitSparkle(scene);
    fx.emit(new Vector3(0, 0.8, 0), new Vector3(-1, 0, 0), 0);
    expect(drawn(host(scene, "shard"))).toBe(MIN_SHARDS);
    fx.emit(new Vector3(3, 0.8, 0), new Vector3(-1, 0, 0), 1);
    expect(drawn(host(scene, "shard"))).toBe(MIN_SHARDS + MAX_SHARDS);
    expect(drawn(host(scene, "core"))).toBe(2);
  });

  it("recycles the oldest hit past capacity and never grows its buffers", () => {
    const scene = newScene();
    const fx = hitSparkle(scene);
    const core = host(scene, "core");
    const shard = host(scene, "shard");
    expect(core.thinInstanceCount).toBe(SPARKLE_CAPACITY);
    expect(shard.thinInstanceCount).toBe(SPARKLE_CAPACITY * MAX_SHARDS);
    for (let i = 0; i < SPARKLE_CAPACITY + 3; i++) fx.emit(new Vector3(i, 0.8, 0), new Vector3(0, 0, -1), 1);
    expect(core.thinInstanceCount).toBe(SPARKLE_CAPACITY);
    expect(shard.thinInstanceCount).toBe(SPARKLE_CAPACITY * MAX_SHARDS);
    expect(drawn(core)).toBe(SPARKLE_CAPACITY);
    expect(fx.live).toBe(SPARKLE_CAPACITY);
    expect(scene.meshes.filter((m) => m.name.startsWith(SPARKLE_NAME)).length).toBe(2);
  });

  it("is gone in an eighth of a second, and is never pickable", () => {
    const scene = newScene();
    const fx = hitSparkle(scene);
    fx.emit(new Vector3(0, 0.8, 0), new Vector3(1, 0, 0), 0.7);
    fx.step(0.05);
    expect(drawn(host(scene, "core"))).toBe(1);
    fx.step(0.1);
    expect(drawn(host(scene, "core"))).toBe(0);
    expect(drawn(host(scene, "shard"))).toBe(0);
    expect(fx.live).toBe(0);
    for (const part of ["core", "shard"] as const) {
      expect(host(scene, part).isPickable).toBe(false);
      expect(host(scene, part).receiveShadows).toBe(false);
    }
  });
});
