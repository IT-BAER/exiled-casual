import { afterEach, describe, expect, it } from "vitest";
import { Mesh, NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { clearGallery, galleryCell, gallerySize, spawnAsset, SPAWNABLE } from "./gallery";

let engine: NullEngine | null = null;

afterEach(() => {
  engine?.dispose();
  engine = null;
});

function emptyScene(): Scene {
  engine = new NullEngine();
  return new Scene(engine);
}

describe("asset spawner", () => {
  it("offers every prop and every species under a readable name", () => {
    const props = SPAWNABLE.filter((s) => s.group === "Props");
    const creatures = SPAWNABLE.filter((s) => s.group === "Creatures");
    expect(props.length).toBeGreaterThan(10);
    expect(creatures.length).toBeGreaterThan(10);
    // A wire id is not a name to read off a button.
    for (const c of creatures) {
      expect(c.id).toMatch(/^monster\./);
      expect(c.label).not.toContain(".");
      expect(c.label).not.toContain("_");
    }
    expect(new Set(SPAWNABLE.map((s) => s.id)).size).toBe(SPAWNABLE.length);
  });

  it("stands each one in front of the player, never on him", () => {
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

  it("counts and drops its own meshes and nothing else", () => {
    const scene = emptyScene();
    const keep = new Mesh("hideout-decor-3", scene);
    expect(gallerySize(scene)).toBe(0);

    const exhibit = new Mesh("asset-gallery-0-table", scene);
    new Mesh("child", scene).parent = exhibit;
    expect(gallerySize(scene)).toBe(1);

    clearGallery(scene);
    expect(gallerySize(scene)).toBe(0);
    expect(scene.meshes).toContain(keep);
    // The instanced art hangs off the root, so the root has to take it with it.
    expect(scene.meshes.some((m) => m.name === "child")).toBe(false);
  });

  it("leaves no empty root behind when the asset never loaded", () => {
    // Headless: props.glb and monsters.glb are not there, so the spawn fails and
    // must not leave a nameless hole standing in the next free spot.
    const scene = emptyScene();
    expect(spawnAsset(scene, "table", Vector3.Zero())).toBe(false);
    expect(gallerySize(scene)).toBe(0);
  });
});
