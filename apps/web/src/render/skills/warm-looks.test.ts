// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine, Scene } from "@babylonjs/core";
import { warmSkillLooks } from "./warm-looks";

let engine: NullEngine | undefined;
afterEach(() => { engine?.dispose(); engine = undefined; });

describe("warmSkillLooks", () => {
  it("draws every class look behind the plate and leaves only the kit's shared pieces once released", () => {
    engine = new NullEngine();
    vi.spyOn(engine, "getDeltaTime").mockReturnValue(1000 / 30);
    const scene = new Scene(engine);
    const meshes = scene.meshes.length;
    const nodes = scene.transformNodes.length;
    const release = warmSkillLooks(scene);
    const built = scene.meshes.slice(meshes);
    // Sunder, Solar Orb and Firestorm each stalled their first cast for 0.5-0.8 s.
    expect(built.length).toBeGreaterThan(20);
    expect(built.every((m) => m.alwaysSelectAsActiveMesh)).toBe(true);
    release();
    // One-shots fired onto the scene loop run out on their own, as under the plate.
    for (let i = 0; i < 300; i++) scene.onBeforeRenderObservable.notifyObservers(scene);
    const left = scene.meshes.slice(meshes);
    expect(left.filter((m) => !/^kit-(tpl|pool|chunks)-/.test(m.name)).map((m) => m.name)).toEqual([]);
    // A template drawn always would cost its draw for the rest of the area.
    expect(left.filter((m) => m.name.startsWith("kit-tpl-") && m.alwaysSelectAsActiveMesh).map((m) => m.name)).toEqual([]);
    expect(scene.transformNodes.length).toBe(nodes);
  });
});
