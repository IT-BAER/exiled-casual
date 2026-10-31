import { describe, it, expect, afterEach } from "vitest";
import { NullEngine, Scene, type StandardMaterial, type Mesh } from "@babylonjs/core";
import { makeMesh, updateMapDevice } from "./meshes";

describe("the Map Device's beckon", () => {
  const engine = new NullEngine();
  let scene: Scene;
  afterEach(() => scene.dispose());

  const glow = (root: Mesh) => (root.metadata as { brassRim: StandardMaterial }).brassRim.emissiveColor.r;

  it("breathes the device's own brass from its idle glow past its hover glow", () => {
    scene = new Scene(engine);
    const device = makeMesh(scene, "mapDevice", "device") as Mesh;
    updateMapDevice(device, false);
    const idle = glow(device);
    updateMapDevice(device, true);
    const hover = glow(device);
    updateMapDevice(device, false, 0);
    expect(glow(device)).toBeCloseTo(idle, 6);
    updateMapDevice(device, false, 1);
    expect(glow(device)).toBeGreaterThan(hover);
    // No marker joins the scene: the device is the highlight.
    expect(scene.meshes.every((m) => m === device || m.parent === device || m.isDescendantOf(device))).toBe(true);
  });
});
