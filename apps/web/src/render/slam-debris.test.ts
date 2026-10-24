// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { NullEngine, Scene, Vector3 } from "@babylonjs/core";
import type { Mesh } from "@babylonjs/core";
import { slamDebris, DEBRIS_NAME, CRACK_NAME, DEBRIS_SECONDS, CRACK_SECONDS, CRACK_HOLD } from "./slam-debris";

let engine: NullEngine | undefined;
afterEach(() => {
  engine?.dispose();
  engine = undefined;
});

function newScene(): Scene {
  engine = new NullEngine();
  return new Scene(engine);
}

function run(seconds: number, step: (dt: number) => void): void {
  for (let t = 0; t < seconds; t += 1 / 30) step(1 / 30);
}

function cracks(scene: Scene): Mesh[] {
  return scene.meshes.filter((m) => m.name.startsWith(CRACK_NAME)) as Mesh[];
}

describe("ground slam debris", () => {
  it("throws real rock chunks, not cards, up and out along the facing", () => {
    const scene = newScene();
    const debris = slamDebris(scene);
    debris.emit(new Vector3(0, 0, 0), 0, 1);
    expect(debris.live).toBeGreaterThan(20);
    // A chunk is a solid: an irregular polyhedron, never a quad.
    const host = scene.getMeshByName(DEBRIS_NAME) as Mesh;
    expect(host.getTotalVertices()).toBeGreaterThan(30);
    run(0.25, (dt) => debris.step(dt));
    const pts = debris.positions();
    expect(Math.max(...pts.map((p) => p.y))).toBeGreaterThan(0.3);
    // Most of it flies the way the weapon came down.
    const ahead = pts.filter((p) => p.z > 0.2).length;
    expect(ahead / pts.length).toBeGreaterThan(0.6);
  });

  it("lands, lies on the floor, then sinks away", () => {
    const scene = newScene();
    const debris = slamDebris(scene);
    debris.emit(new Vector3(2, 0, 2), 1, 0);
    run(DEBRIS_SECONDS * 0.5, (dt) => debris.step(dt));
    expect(debris.live).toBeGreaterThan(0);
    for (const p of debris.positions()) expect(p.y).toBeLessThan(0.12);
    run(DEBRIS_SECONDS * 0.55, (dt) => debris.step(dt));
    expect(debris.live).toBe(0);
  });

  it("leaves a crack in the floor that fades out and is gone", () => {
    const scene = newScene();
    const debris = slamDebris(scene);
    debris.emit(new Vector3(0, 0, 0), 0, 1);
    const shown = cracks(scene).filter((m) => m.isEnabled());
    expect(shown).toHaveLength(1);
    const crack = shown[0]!;
    expect(crack.visibility).toBe(1);
    expect(crack.position.y).toBeGreaterThan(0);
    expect(crack.position.y).toBeLessThan(0.05);
    run(CRACK_HOLD + (CRACK_SECONDS - CRACK_HOLD) / 2, (dt) => debris.step(dt));
    expect(crack.visibility).toBeLessThan(0.9);
    expect(crack.visibility).toBeGreaterThan(0);
    run(CRACK_SECONDS, (dt) => debris.step(dt));
    expect(crack.isEnabled()).toBe(false);
  });

  it("clear wipes chunks and cracks for a new area", () => {
    const scene = newScene();
    const debris = slamDebris(scene);
    debris.emit(new Vector3(0, 0, 0), 0, 1);
    debris.clear();
    expect(debris.live).toBe(0);
    expect(cracks(scene).filter((m) => m.isEnabled())).toHaveLength(0);
  });
});
