import { describe, it, expect, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { applyGraphics } from "./engine";
import { DEFAULT_SETTINGS } from "../settings";

function bareScene() {
  const engine = new NullEngine();
  return { engine, scene: new Scene(engine) };
}

describe("applyGraphics", () => {
  it("is a no-op on a scene that has none of the pieces", () => {
    const { engine, scene } = bareScene();
    for (const shadows of ["off", "low", "high"] as const) {
      expect(() =>
        applyGraphics(scene, engine, { ...DEFAULT_SETTINGS.graphics, shadows }),
      ).not.toThrow();
    }
    expect(() =>
      applyGraphics(scene, null, { ...DEFAULT_SETTINGS.graphics, ambientOcclusion: false }),
    ).not.toThrow();
    engine.dispose();
  });

  it("turns the shadow lights off and back on without disposing anything", () => {
    const { engine, scene } = bareScene();
    const sun = new DirectionalLight("sun", new Vector3(0, -1, 0), scene);
    const torch = new PointLight("torch", new Vector3(0, 2, 0), scene);
    const sunGen = new ShadowGenerator(256, sun);
    new ShadowGenerator(128, torch);

    applyGraphics(scene, engine, { ...DEFAULT_SETTINGS.graphics, shadows: "off" });
    expect(sun.shadowEnabled).toBe(false);
    expect(torch.shadowEnabled).toBe(false);
    // Off must be REVERSIBLE: a disposed generator cannot come back without
    // rebuilding the scene, and the panel has to be able to turn this back on.
    expect(sun.getShadowGenerator()).toBe(sunGen);

    applyGraphics(scene, engine, { ...DEFAULT_SETTINGS.graphics, shadows: "high" });
    expect(sun.shadowEnabled).toBe(true);
    expect(torch.shadowEnabled).toBe(true);
    engine.dispose();
  });

  it("low keeps the sun and drops the torch, which is the expensive one", () => {
    const { engine, scene } = bareScene();
    const sun = new DirectionalLight("sun", new Vector3(0, -1, 0), scene);
    const torch = new PointLight("torch", new Vector3(0, 2, 0), scene);
    new ShadowGenerator(256, sun);
    new ShadowGenerator(128, torch);

    applyGraphics(scene, engine, { ...DEFAULT_SETTINGS.graphics, shadows: "low" });
    expect(sun.shadowEnabled).toBe(true);
    expect(torch.shadowEnabled).toBe(false); // a cube map is six faces
    engine.dispose();
  });

  it("moves the fog band when the atmosphere changes", () => {
    const { engine, scene } = bareScene();
    applyGraphics(scene, engine, { ...DEFAULT_SETTINGS.graphics, atmosphere: "soft" });
    const soft = scene.fogEnd;
    applyGraphics(scene, engine, { ...DEFAULT_SETTINGS.graphics, atmosphere: "heavy" });
    expect(scene.fogEnd).not.toBe(soft);
    expect(scene.fogEnd).toBeLessThan(soft);
    engine.dispose();
  });

  it("asks the engine for the resolution it was given, inverted", () => {
    const { engine, scene } = bareScene();
    // Spied, not read back: NullEngine overrides getHardwareScalingLevel() to a
    // hard-coded 1.0 (nullEngine.js:66) so headless rendering has a fixed size,
    // which makes the getter unobservable here. The call is the seam.
    const set = vi.spyOn(engine, "setHardwareScalingLevel");
    applyGraphics(scene, engine, { ...DEFAULT_SETTINGS.graphics, resolutionScale: 0.5 });
    expect(set).toHaveBeenLastCalledWith(2);
    applyGraphics(scene, engine, { ...DEFAULT_SETTINGS.graphics, resolutionScale: 1 });
    expect(set).toHaveBeenLastCalledWith(1);
    set.mockRestore();
    engine.dispose();
  });
});
