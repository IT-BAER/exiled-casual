// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { Matrix, NullEngine, Scene, Vector3 } from "@babylonjs/core";
import type { Mesh } from "@babylonjs/core";
import { MONSTERS } from "@exiled/content-runtime";
import { hitSpray, hitStrength, flashPeak, sprayKindOf, SPRAY_NAME, SPRAY_CAPACITY, SPLAT_SECONDS } from "./hit-spray";

let engine: NullEngine | undefined;
afterEach(() => {
  engine?.dispose();
  engine = undefined;
});

function newScene(): Scene {
  engine = new NullEngine();
  return new Scene(engine);
}

function host(scene: Scene, kind: "blood" | "grit"): Mesh {
  return scene.getMeshByName(`${SPRAY_NAME}-${kind}`) as Mesh;
}

/** Every drawn droplet's world position and scale, zero-scale slots left out. */
function droplets(mesh: Mesh): { pos: Vector3; scale: Vector3 }[] {
  // The raw buffer: `thinInstanceGetWorldMatrices` caches its first read and
  // `thinInstanceBufferUpdated` never invalidates it (Babylon 9.20).
  const data = (mesh as unknown as { _thinInstanceDataStorage: { matrixData: Float32Array } })
    ._thinInstanceDataStorage.matrixData;
  const out: { pos: Vector3; scale: Vector3 }[] = [];
  for (let i = 0; i < mesh.thinInstanceCount; i++) {
    const scale = new Vector3();
    const pos = new Vector3();
    Matrix.FromArray(data, i * 16).decompose(scale, undefined, pos);
    if (scale.x > 1e-6) out.push({ pos, scale });
  }
  return out;
}

describe("hit strength", () => {
  it("keeps a starter chip quiet and lets a big hit pop", () => {
    expect(hitStrength(0.03)).toBeLessThan(0.4);
    expect(hitStrength(0.03)).toBeGreaterThan(0);
    expect(hitStrength(0.2)).toBeGreaterThan(hitStrength(0.03));
    expect(hitStrength(0.6)).toBe(1);
    expect(hitStrength(-1)).toBeGreaterThan(0);
  });

  it("makes a killing blow louder than the same hit that left it standing", () => {
    expect(hitStrength(0.05, true)).toBeGreaterThan(hitStrength(0.05));
    expect(hitStrength(1, true)).toBe(1);
  });

  it("scales the body flash with it, never to nothing", () => {
    expect(flashPeak(0)).toBeGreaterThan(0.2);
    expect(flashPeak(0)).toBeLessThan(flashPeak(1));
    expect(flashPeak(1)).toBe(1);
  });
});

describe("spray kind", () => {
  it("bleeds flesh, chips stone and leaves a wisp dry", () => {
    expect(sprayKindOf("monster.vaal_husk.v1")).toBe("blood");
    expect(sprayKindOf("monster.vaal_construct.v1")).toBe("grit");
    expect(sprayKindOf("monster.sunbaked_colossus.v1")).toBe("grit");
    expect(sprayKindOf("monster.fen_wisp.v1")).toBeNull();
    expect(sprayKindOf(undefined)).toBe("blood");
  });

  it("names only species that exist", () => {
    for (const id of ["monster.vaal_construct.v1", "monster.sunbaked_colossus.v1", "monster.fen_wisp.v1"]) {
      expect(MONSTERS.has(id), id).toBe(true);
    }
  });
});

describe("hit spray", () => {
  it("throws droplets away from the blow, and more of them for a bigger hit", () => {
    const scene = newScene();
    const spray = hitSpray(scene);
    spray.emit(new Vector3(0, 0.8, 0), 1, 0, 0.1, "blood");
    const small = droplets(host(scene, "blood")).length;
    spray.clear();
    spray.emit(new Vector3(0, 0.8, 0), 1, 0, 1, "blood");
    const big = droplets(host(scene, "blood")).length;
    expect(small).toBeGreaterThan(0);
    expect(big).toBeGreaterThan(small * 2);

    spray.step(0.1);
    for (const d of droplets(host(scene, "blood"))) expect(d.pos.x).toBeGreaterThan(0);
  });

  it("lands every droplet flat on the floor, keeps it a while, then dries it away", () => {
    const scene = newScene();
    const spray = hitSpray(scene);
    spray.emit(new Vector3(2, 0.8, -1), 0, 1, 0.8, "blood");
    for (let t = 0; t < 2; t += 1 / 60) spray.step(1 / 60);
    const landed = droplets(host(scene, "blood"));
    expect(landed.length).toBeGreaterThan(0);
    for (const d of landed) {
      expect(d.pos.y).toBeLessThan(0.05);
      // A splat, not a bead: flatter than it is wide.
      expect(d.scale.y).toBeLessThan(d.scale.x * 0.5);
      expect(d.pos.z).toBeGreaterThan(-1);
    }
    for (let t = 2; t < SPLAT_SECONDS - 1; t += 1 / 30) spray.step(1 / 30);
    expect(droplets(host(scene, "blood")).length).toBe(landed.length);
    for (let t = 0; t < 3; t += 1 / 30) spray.step(1 / 30);
    expect(droplets(host(scene, "blood"))).toHaveLength(0);
  });

  it("colours stone chips apart from blood, on their own host", () => {
    const scene = newScene();
    const spray = hitSpray(scene);
    spray.emit(Vector3.Zero(), 1, 0, 0.5, "grit");
    expect(droplets(host(scene, "grit")).length).toBeGreaterThan(0);
    expect(droplets(host(scene, "blood"))).toHaveLength(0);
    expect(host(scene, "grit").material).not.toBe(host(scene, "blood").material);
  });

  it("never grows past its capacity: the oldest droplet is reused", () => {
    const scene = newScene();
    const spray = hitSpray(scene);
    for (let i = 0; i < 200; i++) spray.emit(Vector3.Zero(), 1, 0, 1, "blood");
    expect(host(scene, "blood").thinInstanceCount).toBe(SPRAY_CAPACITY);
    expect(droplets(host(scene, "blood")).length).toBeLessThanOrEqual(SPRAY_CAPACITY);
  });

  it("is one instance per scene, unpickable, and cleared on demand", () => {
    const scene = newScene();
    expect(hitSpray(scene)).toBe(hitSpray(scene));
    const mesh = host(scene, "blood");
    expect(mesh.isPickable).toBe(false);
    // Thin instances: one host's bounds cannot follow droplets, so it is never culled.
    expect(mesh.alwaysSelectAsActiveMesh).toBe(true);
    hitSpray(scene).emit(Vector3.Zero(), 1, 0, 1, "blood");
    hitSpray(scene).clear();
    expect(droplets(mesh)).toHaveLength(0);
  });
});
