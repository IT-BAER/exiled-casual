// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import { NullEngine, ParticleSystem, Scene } from "@babylonjs/core";
import { AILMENT_FX_NAME, PlayerAilmentFx, type AilmentBuff } from "./player-ailment-fx";

let engine: NullEngine | undefined;
afterEach(() => {
  engine?.dispose();
  engine = undefined;
});

function newScene(): Scene {
  engine = new NullEngine();
  return new Scene(engine);
}

const debuff = (id: string, stacks?: number): AilmentBuff =>
  ({ id, kind: "debuff", remainingSec: 2, ...(stacks !== undefined ? { stacks } : {}) });

function systems(scene: Scene, kind: string): ParticleSystem[] {
  return scene.particleSystems.filter((p) => p.name === AILMENT_FX_NAME[kind as keyof typeof AILMENT_FX_NAME]) as ParticleSystem[];
}

describe("player ailment fx", () => {
  it("draws nothing on a clean player", () => {
    const scene = newScene();
    const fx = new PlayerAilmentFx(scene);
    fx.update(undefined, 0, 0);
    fx.update([{ id: "grace", kind: "buff", remainingSec: 9 }], 0, 0);
    expect(scene.particleSystems).toHaveLength(0);
  });

  it("gives each active ailment its own system at the player, once", () => {
    const scene = newScene();
    const fx = new PlayerAilmentFx(scene);
    const buffs = [debuff("burning", 1), debuff("poison"), debuff("bleeding")];
    fx.update(buffs, 3, -2);
    fx.update(buffs, 3.5, -2);
    for (const kind of ["burning", "poison", "bleeding"]) {
      const [ps, extra] = systems(scene, kind);
      expect(ps, kind).toBeDefined();
      expect(extra, `${kind} built twice`).toBeUndefined();
      expect(ps!.isStarted()).toBe(true);
      const at = ps!.emitter as { x: number; z: number };
      expect(at.x).toBe(3.5);
      expect(at.z).toBe(-2);
    }
  });

  it("burns harder with more stacks", () => {
    const scene = newScene();
    const fx = new PlayerAilmentFx(scene);
    fx.update([debuff("burning", 1)], 0, 0);
    const one = systems(scene, "burning")[0]!.emitRate;
    fx.update([debuff("burning", 5)], 0, 0);
    expect(systems(scene, "burning")[0]!.emitRate).toBeGreaterThan(one);
  });

  it("blood is drawn dark, not added as light", () => {
    const scene = newScene();
    const fx = new PlayerAilmentFx(scene);
    fx.update([debuff("burning", 1), debuff("bleeding")], 0, 0);
    expect(systems(scene, "bleeding")[0]!.blendMode).toBe(ParticleSystem.BLENDMODE_STANDARD);
    expect(systems(scene, "burning")[0]!.blendMode).toBe(ParticleSystem.BLENDMODE_ADD);
  });

  it("stops emitting when the ailment ends, and a new one starts fresh", () => {
    const scene = newScene();
    const fx = new PlayerAilmentFx(scene);
    fx.update([debuff("poison")], 0, 0);
    const first = systems(scene, "poison")[0]!;
    const stop = vi.spyOn(first, "stop");
    fx.update([], 0, 0);
    // The last particles live out their life; the system is not torn down mid-air.
    expect(stop).toHaveBeenCalledTimes(1);
    expect(first.disposeOnStop).toBe(true);
    expect(scene.particleSystems).toContain(first);
    fx.update([debuff("poison")], 0, 0);
    const fresh = systems(scene, "poison").filter((p) => p !== first);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.isStarted()).toBe(true);
  });

  it("dispose leaves nothing behind", () => {
    const scene = newScene();
    const fx = new PlayerAilmentFx(scene);
    fx.update([debuff("burning", 2), debuff("poison")], 0, 0);
    fx.dispose();
    expect(scene.particleSystems).toHaveLength(0);
  });
});
