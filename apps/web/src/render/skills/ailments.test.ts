// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";
import { AILMENT_LOOKS } from "./ailments";
import { SKILL_LOOKS } from "./index";
import type { AttachedState, FxHandle, LookContext } from "./types";

let engine: NullEngine | undefined;
afterEach(() => { engine?.dispose(); engine = undefined; });

const DT = 1 / 30;

describe("ailment looks", () => {
  it("are registered for every ailment the snapshot names on a monster", () => {
    for (const id of ["frozen", "freezing", "shocked", "burning", "poison", "bleeding"]) expect(SKILL_LOOKS.statuses[id], id).toBeDefined();
  });

  it("leave nothing behind but their shared templates and pools, and the freeze meter grows its rime", () => {
    engine = new NullEngine();
    vi.spyOn(engine, "getDeltaTime").mockReturnValue(1000 / 30);
    const scene = new Scene(engine);
    const ctx: LookContext = { scene, dt: DT, now: 0, flash: () => {} };
    const node = new TransformNode("imp", scene);
    const shared = (n: string) => /^kit-(tpl|pool|chunks)-/.test(n);
    const run = (amount?: number) => {
      const before = scene.meshes.filter((m) => !shared(m.name)).length;
      const live: { id: string; h: FxHandle<AttachedState> }[] = [];
      for (const [id, look] of Object.entries(AILMENT_LOOKS.statuses)) {
        const s: AttachedState & { radius: number; boss: boolean } = { body: { node, x: 0, z: 0, yaw: 0 }, remaining: 0, visible: true, radius: 0.5, boss: false, ...(id === "freezing" ? { amount } : {}) };
        live.push({ id, h: look.create(ctx, s) });
      }
      for (let i = 0; i < 30; i++) {
        for (const { id, h } of live) h.update?.(ctx, { body: { node, x: 0, z: 0, yaw: 0 }, remaining: 0, visible: true, ...(id === "freezing" ? { amount } : {}) });
        scene.onBeforeRenderObservable.notifyObservers(scene);
      }
      const rime = scene.meshes.find((m) => m.name.startsWith("kit-frost-creep") && !m.name.includes("shell"));
      const height = rime?.scaling.y ?? -1;
      for (const { h } of live) {
        let t = 0;
        while (h.fade?.(ctx, t)) { scene.onBeforeRenderObservable.notifyObservers(scene); t += DT; expect(t).toBeLessThan(3); }
        h.dispose();
      }
      for (let i = 0; i < 120; i++) scene.onBeforeRenderObservable.notifyObservers(scene);
      expect(scene.meshes.filter((m) => !shared(m.name)).length).toBe(before);
      return height;
    };
    const low = run(0.2);
    const high = run(0.9);
    expect(high).toBeGreaterThan(low * 3);
    node.dispose();
  });
});
