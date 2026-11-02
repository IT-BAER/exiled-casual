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

  it("draws every look a second time squashed, the variant a growing or flinching mesh compiles", () => {
    engine = new NullEngine();
    vi.spyOn(engine, "getDeltaTime").mockReturnValue(1000 / 30);
    const scene = new Scene(engine);
    const meshes = scene.meshes.length;
    const release = warmSkillLooks(scene);
    // Sunder's fangs grow taller than wide: NONUNIFORMSCALING, a 0.4 s link on the first cast.
    const fangs = scene.meshes.slice(meshes).filter((m) => m.name.startsWith("iron-fangs"));
    const squashed = (m: (typeof fangs)[number]) => m.scaling.isNonUniformWithinEpsilon(1e-4);
    expect(fangs.filter(squashed).length).toBeGreaterThan(0);
    expect(fangs.filter((m) => !squashed(m)).length).toBeGreaterThan(0);
    release();
  });

  it("ticks each warning into its last half second, where Firestorm builds the falling rock", () => {
    engine = new NullEngine();
    vi.spyOn(engine, "getDeltaTime").mockReturnValue(1000 / 30);
    const scene = new Scene(engine);
    const release = warmSkillLooks(scene);
    // Built mid-fight instead, the rock and its wake cost Firestorm's first cast 0.15 s.
    expect(scene.meshes.some((m) => m.name.startsWith("eb-wake"))).toBe(true);
    release();
  });
});
