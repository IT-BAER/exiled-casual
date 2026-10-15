import { describe, it, expect, afterEach } from "vitest";
import { NullEngine, Scene, FreeCamera, Vector3 } from "@babylonjs/core";
import { canvasProjector, type RenderSize } from "./projector";

describe("canvasProjector", () => {
  let engine: NullEngine | null = null;
  afterEach(() => { engine?.dispose(); engine = null; });

  /** An 800x600 CSS canvas drawn at `scale` of its size, as the resolution option does. */
  const canvasAt = (scale: number): RenderSize => ({
    getRenderWidth: () => Math.floor(800 * scale),
    getRenderHeight: () => Math.floor(600 * scale),
    getHardwareScalingLevel: () => 1 / scale,
  });

  it("places a point at the same CSS pixel whatever the resolution scale", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const camera = new FreeCamera("cam", new Vector3(0, 10, -10), scene);
    camera.setTarget(Vector3.Zero());
    scene.render();

    const full = canvasProjector(scene, camera, canvasAt(1))(3, 2);
    const low = canvasProjector(scene, camera, canvasAt(0.75))(3, 2);

    expect(full.visible).toBe(true);
    expect(full.x).toBeGreaterThan(400); // right of centre: the point is at +x
    expect(low.x).toBeCloseTo(full.x, 0);
    expect(low.y).toBeCloseTo(full.y, 0);
    expect(low.visible).toBe(true);
  });
});
