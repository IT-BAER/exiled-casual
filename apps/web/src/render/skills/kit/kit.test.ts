// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlowLayer, NullEngine, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { PointLight } from "@babylonjs/core";
import { FLASH_NAME } from "../../skill-fx";
import {
  auraSigil, bloodMist, buffSwirl, chainArc, chunkPool, coneWave, curseSigil, dashStreak, emberSmoulder, fire, fireNova, fissure,
  flameTrailPatch, frostBurst, frostCrust, groundBurst, iceCrystalCluster, kitPools, landingImpact, leapArcTrail, lightningBolt,
  markReticle, meteor, scorch, shockRing, skyFall, stunOrbit, sunOrb, tauntRage, warcryBlast, SUN_LIGHT_NAME,
  type FxHandle, type LastingFx,
} from "./index";
import { KIT_PREVIEWS, startKitPreview } from "./preview";

const DT = 1 / 30;
let engine: NullEngine | undefined;
afterEach(() => {
  engine?.dispose();
  engine = undefined;
});

function newScene(glow = false): Scene {
  engine = new NullEngine();
  // The pools and the shared flash step off the engine's frame time; NullEngine has none.
  vi.spyOn(engine, "getDeltaTime").mockReturnValue(DT * 1000);
  const scene = new Scene(engine);
  if (glow) new GlowLayer("glow", scene);
  return scene;
}

/** One scene frame without a render: every pool, flash and fired effect steps. */
function frame(scene: Scene): void {
  scene.onBeforeRenderObservable.notifyObservers(scene);
}

/** Let the shared flash go dark, so a tinted flash's watcher hands the warm colour back and leaves. */
function settleFlash(scene: Scene): void {
  const light = scene.getLightByName(FLASH_NAME) as PointLight | null;
  if (light) light.intensity = 0;
  frame(scene);
}

function counts(scene: Scene) {
  return {
    meshes: scene.meshes.length,
    materials: scene.materials.length,
    multiMaterials: scene.multiMaterials.length,
    geometries: scene.geometries.length,
    textures: scene.textures.length,
    particleSystems: scene.particleSystems.length,
    lights: scene.lights.length,
    transformNodes: scene.transformNodes.length,
    // An observer removed while the observable notifies is only marked, and spliced out on a timer.
    observers: scene.onBeforeRenderObservable.observers.filter((o) => !(o as unknown as { _willBeUnregistered: boolean })._willBeUnregistered).length,
  };
}

/** Everything the kit has emitted so far, pooled solids and particles alike. */
function emittedSoFar(scene: Scene): number {
  const p = kitPools(scene);
  return [p.shards, p.glow, p.smoke, p.motes, p.drops].reduce((n, x) => n + x.emitted, 0)
    + (["rock", "ice", "molten"] as const).reduce((n, k) => n + chunkPool(scene, k).emitted, 0);
}

interface Ctx { node: TransformNode; at: Vector3 }
interface Case { name: string; make: (scene: Scene, c: Ctx) => FxHandle; lasting?: boolean }

const at = () => new Vector3(1, 0, 2);
const CASES: Case[] = [
  { name: "shockRing", make: (s, c) => shockRing(s, c.at) },
  { name: "shockRing arc", make: (s, c) => shockRing(s, c.at, { arc: { yaw: 0.5, half: 0.6 } }) },
  { name: "coneWave", make: (s, c) => coneWave(s, c.at, 0, 1) },
  { name: "groundBurst", make: (s, c) => groundBurst(s, c.at) },
  { name: "fissure", make: (s, c) => fissure(s, c.at, { yaw: 0, spread: 0.8 }) },
  { name: "scorch", make: (s, c) => scorch(s, c.at, { glow: [1, 0.4, 0.1] }) },
  { name: "landingImpact", make: (s, c) => landingImpact(s, c.at, { glow: [1, 0.5, 0.1] }) },
  { name: "skyFall", make: (s, c) => skyFall(s, c.at.add(new Vector3(-2, 10, 0)), c.at) },
  { name: "meteor", make: (s, c) => meteor(s, c.at) },
  { name: "lightningBolt", make: (s, c) => lightningBolt(s, new Vector3(0, 1.4, 0), c.node) },
  { name: "chainArc", make: (s, c) => chainArc(s, () => new Vector3(0, 1, 0), c.node) },
  { name: "frostBurst", make: (s, c) => frostBurst(s, c.at, { crystals: true }) },
  { name: "iceCrystalCluster", make: (s, c) => iceCrystalCluster(s, c.at) },
  { name: "fireNova", make: (s, c) => fireNova(s, c.at) },
  { name: "flameTrailPatch", make: (s, c) => flameTrailPatch(s, c.at) },
  { name: "warcryBlast", make: (s, c) => warcryBlast(s, c.at) },
  { name: "warcryBlast cone", make: (s, c) => warcryBlast(s, c.at, { yaw: 1, half: 0.5 }) },
  { name: "buffSwirl one-shot", make: (s, c) => buffSwirl(s, c.node, { duration: 0.8 }) },
  { name: "dashStreak", make: (s, c) => dashStreak(s, c.node), lasting: true },
  { name: "leapArcTrail", make: (s, c) => leapArcTrail(s, c.node), lasting: true },
  { name: "sunOrb", make: (s, c) => sunOrb(s, c.node), lasting: true },
  { name: "auraSigil", make: (s, c) => auraSigil(s, c.node), lasting: true },
  { name: "buffSwirl", make: (s, c) => buffSwirl(s, c.node), lasting: true },
  { name: "bloodMist", make: (s, c) => bloodMist(s, c.node), lasting: true },
  { name: "frostCrust", make: (s, c) => frostCrust(s, c.node), lasting: true },
  { name: "emberSmoulder", make: (s, c) => emberSmoulder(s, c.node), lasting: true },
  { name: "stunOrbit", make: (s, c) => stunOrbit(s, c.node), lasting: true },
  { name: "markReticle", make: (s, c) => markReticle(s, c.node), lasting: true },
  { name: "tauntRage", make: (s, c) => tauntRage(s, c.node), lasting: true },
  { name: "curseSigil", make: (s, c) => curseSigil(s, c.node), lasting: true },
];

/** Drive a handle to done, the node moving so trails have somewhere to go; a lasting one is stopped after a second. */
function drive(scene: Scene, h: FxHandle, c: Ctx, lasting: boolean, check?: () => void): number {
  let t = 0;
  for (; t < 10 && !h.done; t += DT) {
    c.node.position.x += 0.15;
    c.node.computeWorldMatrix(true);
    if (lasting && t >= 1 && t < 1 + DT) (h as LastingFx).stop();
    h.update(DT);
    frame(scene);
    check?.();
  }
  return t;
}

function stage(scene: Scene): Ctx {
  const node = new TransformNode("kit-test-body", scene);
  node.position.set(0, 0, 0);
  node.computeWorldMatrix(true);
  return { node, at: at() };
}

describe("VFX kit primitives", () => {
  for (const glow of [false, true]) {
    for (const k of CASES) {
      it(`${k.name}${glow ? " (glow layer)" : ""}: draws, finishes, and leaves the scene as it found it`, () => {
        const scene = newScene(glow);
        // A first run builds what is per scene (pools, templates, materials, the flash); the second must add nothing that stays.
        const warm = stage(scene);
        const w = k.make(scene, warm);
        drive(scene, w, warm, !!k.lasting);
        w.dispose();
        warm.node.dispose();
        const emitted0 = emittedSoFar(scene);
        settleFlash(scene);
        const before = counts(scene);
        const c = stage(scene);
        const base = scene.meshes.length;
        const h = k.make(scene, c);
        let peak = 0;
        const elapsed = drive(scene, h, c, !!k.lasting, () => {
          peak = Math.max(peak, scene.meshes.length - base);
          // Never a camera-facing card: every mesh the kit draws is real geometry.
          for (const m of scene.meshes) expect(m.billboardMode).toBe(0);
        });
        expect(h.done, `${k.name} reports done`).toBe(true);
        expect(elapsed).toBeLessThan(10);
        // It drew something: geometry of its own, or pooled solids and particles.
        expect(peak + emittedSoFar(scene) - emitted0).toBeGreaterThan(0);
        h.dispose();
        c.node.dispose();
        settleFlash(scene);
        expect(counts(scene)).toEqual({ ...before, transformNodes: before.transformNodes });
      });
    }
  }

  it("fire() drives a one-shot off the scene and disposes it when done", () => {
    const scene = newScene();
    const warm = stage(scene);
    const w = fire(scene, groundBurst(scene, warm.at));
    for (let i = 0; i < 300 && !w.done; i++) frame(scene);
    settleFlash(scene);
    const before = counts(scene);
    const h = fire(scene, groundBurst(scene, warm.at));
    expect(scene.meshes.length).toBeGreaterThan(before.meshes);
    for (let i = 0; i < 300 && !h.done; i++) frame(scene);
    expect(h.done).toBe(true);
    settleFlash(scene);
    expect(counts(scene)).toEqual(before);
  });

  it("disposing a fired effect early removes it and its driver", () => {
    const scene = newScene();
    const c = stage(scene);
    fire(scene, meteor(scene, c.at)).dispose();
    settleFlash(scene);
    const before = counts(scene);
    const h = fire(scene, meteor(scene, c.at));
    for (let i = 0; i < 5; i++) frame(scene);
    h.dispose();
    settleFlash(scene);
    expect(counts(scene)).toEqual(before);
  });

  it("a status ends itself when the monster it rides is disposed", () => {
    const scene = newScene();
    const statuses = [frostCrust, emberSmoulder, stunOrbit, markReticle, tauntRage, curseSigil];
    const warm = stage(scene);
    for (const f of statuses) f(scene, warm.node).dispose();
    warm.node.dispose();
    emittedSoFar(scene);
    const before = counts(scene);
    const c = stage(scene);
    const fxs = statuses.map((f) => f(scene, c.node));
    for (const f of fxs) f.update(DT);
    c.node.dispose();
    for (const f of fxs) expect(f.done).toBe(true);
    expect(counts(scene)).toEqual(before);
  });

  it("a crowd of statuses shares geometry: twenty frozen monsters add meshes, never vertex buffers", () => {
    const scene = newScene();
    const warm = stage(scene);
    frostCrust(scene, warm.node).dispose();
    const geometries = scene.geometries.length;
    const nodes = Array.from({ length: 20 }, (_, i) => {
      const n = new TransformNode(`monster-${i}`, scene);
      n.position.set(i, 0, 0);
      return n;
    });
    const fxs = nodes.map((n) => frostCrust(scene, n));
    for (let i = 0; i < 10; i++) for (const f of fxs) f.update(DT);
    expect(scene.geometries.length).toBe(geometries);
    // Two meshes a monster: the shell and the ice collar.
    expect(scene.meshes.filter((m) => m.isEnabled() && m.name.startsWith("kit-frost")).length).toBe(40);
    for (const f of fxs) f.dispose();
  });

  it("the sun orb owns exactly one light while it lives, and the kit's flashes borrow the shared one", () => {
    const scene = newScene();
    const c = stage(scene);
    const orb = sunOrb(scene, c.node);
    orb.update(DT);
    expect(scene.lights.filter((l) => l.name === SUN_LIGHT_NAME)).toHaveLength(1);
    orb.pulse();
    groundBurst(scene, c.at).update(DT);
    frostBurst(scene, c.at).update(DT);
    // Only the orb's light and the shared flash: no effect makes a light of its own.
    expect(scene.lights.map((l) => l.name).sort()).toEqual([FLASH_NAME, SUN_LIGHT_NAME].sort());
    orb.dispose();
    expect(scene.lights.map((l) => l.name)).toEqual([FLASH_NAME]);
  });

  it("a cold flash tints the shared light and gives the warm colour back once it has faded", () => {
    const scene = newScene();
    const c = stage(scene);
    frostBurst(scene, c.at, { flash: 1 });
    const light = scene.getLightByName(FLASH_NAME) as PointLight;
    expect(light.diffuse.b).toBeGreaterThan(light.diffuse.r);
    settleFlash(scene);
    expect(light.diffuse.r).toBeGreaterThan(light.diffuse.b);
  });

  it("debris is thrown up, falls under gravity and lies on the floor it was thrown from", () => {
    const scene = newScene();
    groundBurst(scene, new Vector3(0, 0.5, 0), { chunks: 30 });
    const rock = chunkPool(scene, "rock");
    for (let i = 0; i < 8; i++) frame(scene);
    expect(Math.max(...rock.positions().map((p) => p.y))).toBeGreaterThan(1);
    for (let i = 0; i < 40; i++) frame(scene);
    for (const p of rock.positions()) expect(p.y).toBeLessThan(0.5 + 0.2);
    for (const p of rock.positions()) expect(p.y).toBeGreaterThan(0.5);
  });

  it("a sky fall lands where it was aimed and calls onLand there", () => {
    const scene = newScene();
    const to = new Vector3(3, 0, -2);
    let landed: Vector3 | null = null;
    const h = skyFall(scene, new Vector3(0, 10, 0), to, { onLand: (p) => (landed = p) });
    for (let i = 0; i < 60 && !landed; i++) h.update(DT);
    expect(landed).not.toBeNull();
    expect(Vector3.Distance(landed!, to)).toBeLessThan(1e-6);
    h.dispose();
  });

  it("a lightning bolt re-jags: its path is not the same two frames apart", () => {
    const scene = newScene();
    const bolt = lightningBolt(scene, new Vector3(0, 1, 0), new Vector3(6, 1, 0), { duration: 1 });
    const core = scene.meshes.find((m) => m.name === "kit-bolt-core")!;
    const a = Float32Array.from(core.getVerticesData("position")!);
    for (let i = 0; i < 3; i++) bolt.update(DT);
    const b = core.getVerticesData("position")!;
    expect(a.some((v, i) => Math.abs(v - b[i]!) > 1e-4)).toBe(true);
    bolt.dispose();
  });

  it("every viewer preview runs, repeats and cleans up", () => {
    const scene = newScene();
    const subject = new TransformNode("viewer-subject", scene);
    const stageOf = (s: TransformNode | null) => ({ anchor: Vector3.Zero(), facing: new Vector3(0, 0, 1), subject: s, radius: 0.6, height: 1.7 });
    expect(startKitPreview(scene, "nope", stageOf(subject))).toBeNull();
    // Warm every preview once, then measure a second pass.
    for (const p of KIT_PREVIEWS) {
      const run = startKitPreview(scene, p.name, stageOf(p.name.startsWith("frost") ? null : subject))!;
      for (let i = 0; i < 60; i++) frame(scene);
      run.dispose();
    }
    emittedSoFar(scene);
    settleFlash(scene);
    const before = counts(scene);
    for (const p of KIT_PREVIEWS) {
      const run = startKitPreview(scene, p.name, stageOf(subject));
      expect(run, p.name).not.toBeNull();
      // Past one repeat of the slowest preview.
      for (let i = 0; i < Math.ceil((p.period + 0.5) / DT); i++) frame(scene);
      run!.dispose();
      settleFlash(scene);
      expect(counts(scene), p.name).toEqual(before);
    }
  });
});
