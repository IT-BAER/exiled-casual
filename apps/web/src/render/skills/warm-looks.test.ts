// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine, Scene } from "@babylonjs/core";
import { warmSkillLooks } from "./warm-looks";
import { IRONSWORN_LOOKS } from "./ironsworn";

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

  it("builds looks whose growth and stretch never ask for a squashed shader variant", () => {
    engine = new NullEngine();
    vi.spyOn(engine, "getDeltaTime").mockReturnValue(1000 / 30);
    const scene = new Scene(engine);
    const meshes = scene.meshes.length;
    const release = warmSkillLooks(scene);
    // Sunder's fangs grow taller than wide: NONUNIFORMSCALING was a 0.4 s link on the first cast.
    const fangs = scene.meshes.slice(meshes).filter((m) => m.name.startsWith("iron-fangs"));
    expect(fangs.length).toBeGreaterThan(0);
    for (const m of fangs) { m.scaling.set(1, 1.18, 1); m.computeWorldMatrix(true); }
    expect(fangs.filter((m) => m.nonUniformScaling).map((m) => m.name)).toEqual([]);
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

  it("warms only the looks it is handed: the hideout needs the player's own class", () => {
    engine = new NullEngine();
    vi.spyOn(engine, "getDeltaTime").mockReturnValue(1000 / 30);
    const scene = new Scene(engine);
    const release = warmSkillLooks(scene, IRONSWORN_LOOKS);
    expect(scene.meshes.some((m) => m.name.startsWith("iron-fangs"))).toBe(true);
    expect(scene.meshes.some((m) => m.name.startsWith("eb-wake"))).toBe(false);
    release();
  });

  it("fires each status's death burst too, so the first frozen kill compiles no shatter", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    let deaths = 0;
    const release = warmSkillLooks(scene, {
      skills: {}, buffs: {},
      statuses: { frozen: { create: () => ({ dispose: () => {} }), death: () => { deaths++; } } },
    });
    expect(deaths).toBe(1);
    release();
  });
});
