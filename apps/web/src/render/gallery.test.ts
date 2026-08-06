import { afterEach, describe, expect, it } from "vitest";
import { Mesh, NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { clearGallery, galleryCell, isGalleryOpen, toggleGallery } from "./gallery";

let engine: NullEngine | null = null;

afterEach(() => {
  engine?.dispose();
  engine = null;
});

function emptyScene(): Scene {
  engine = new NullEngine();
  return new Scene(engine);
}

describe("asset gallery", () => {
  it("stands the rows in front of the player, never on him", () => {
    const at = new Vector3(10, 0, -4);
    for (let i = 0; i < 24; i++) {
      const cell = galleryCell(i, at);
      expect(cell.z).toBeGreaterThan(at.z);
      expect(Math.abs(cell.x - at.x)).toBeLessThan(10);
    }
  });

  it("centres each row on him and walks the next one further out", () => {
    const at = new Vector3(0, 0, 0);
    const first = galleryCell(0, at);
    const last = galleryCell(5, at);
    expect(first.x).toBeCloseTo(-last.x);
    expect(first.z).toBe(last.z);
    expect(galleryCell(6, at).z).toBeGreaterThan(first.z);
    expect(galleryCell(6, at).x).toBeCloseTo(first.x);
  });

  it("finds and drops its own meshes and nothing else", () => {
    const scene = emptyScene();
    const keep = new Mesh("hideout-decor-3", scene);
    expect(isGalleryOpen(scene)).toBe(false);

    const exhibit = new Mesh("asset-gallery-0-table", scene);
    new Mesh("child", scene).parent = exhibit;
    expect(isGalleryOpen(scene)).toBe(true);

    clearGallery(scene);
    expect(isGalleryOpen(scene)).toBe(false);
    expect(scene.meshes).toContain(keep);
    // The instanced art hangs off the root, so the root has to take it with it.
    expect(scene.meshes.some((m) => m.name === "child")).toBe(false);
  });

  it("reports itself closed when no asset could be stood up", () => {
    // Headless: props.glb and monsters.glb never loaded, so every exhibit falls
    // through and the mode must not claim to be open with an empty floor.
    const scene = emptyScene();
    expect(toggleGallery(scene, Vector3.Zero())).toBe(false);
    expect(isGalleryOpen(scene)).toBe(false);
  });
});
