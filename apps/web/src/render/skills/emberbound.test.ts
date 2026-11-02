// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";
import { EMBERBOUND_LOOKS } from "./emberbound";
import { SUN_LIGHT_NAME } from "./kit";
import type { ActorRef, AreaState, BurstHandle, FxHandle, GroundState, LookContext } from "./types";

const DT = 1 / 30;
let engine: NullEngine | undefined;
afterEach(() => { engine?.dispose(); engine = undefined; });

function newScene(): Scene {
  engine = new NullEngine();
  vi.spyOn(engine, "getDeltaTime").mockReturnValue(DT * 1000);
  return new Scene(engine);
}

/** One drawn frame: the scene-driven pieces (pools, flash, fired one-shots) step, and the look context advances. */
function step(scene: Scene, ctx: LookContext): void {
  ctx.now += DT;
  scene.onBeforeRenderObservable.notifyObservers(scene);
}

function counts(scene: Scene) {
  return {
    meshes: scene.meshes.length,
    materials: scene.materials.length,
    geometries: scene.geometries.length,
    lights: scene.lights.filter((l) => l.name === SUN_LIGHT_NAME).length,
    transformNodes: scene.transformNodes.length,
    observers: scene.onBeforeRenderObservable.observers.filter((o) => !(o as unknown as { _willBeUnregistered: boolean })._willBeUnregistered).length,
  };
}

const look = (id: string) => EMBERBOUND_LOOKS.skills[`skill.${id}.v1`]!;

/** Run a handle through `frames` updates, then its fade to the end, then dispose. */
function runOut<S>(scene: Scene, ctx: LookContext, h: FxHandle<S>, state: (i: number) => S, frames: number, seen: (s: Scene) => void): void {
  for (let i = 0; i < frames; i++) { h.update?.(ctx, state(i)); step(scene, ctx); seen(scene); }
  let t = 0;
  while (h.fade?.(ctx, t)) { step(scene, ctx); t += DT; expect(t).toBeLessThan(3); }
  h.dispose();
}

function runBurst(scene: Scene, ctx: LookContext, b: BurstHandle | void): void {
  if (!b) return;
  let n = 0;
  while (b.update(ctx)) { step(scene, ctx); expect(++n).toBeLessThan(300); }
  b.dispose();
}

/** Every look of the class, through its whole life, once. */
function scenario(scene: Scene, seen: (s: Scene) => void): void {
  const ctx: LookContext = { scene, dt: DT, now: 1, flash: () => {} };
  const node = new TransformNode("player", scene);
  const player: ActorRef = { node, x: 0, z: 0, yaw: 0 };
  const cast = { skillId: "x", dirX: 0, dirY: 1, windup: 0.3 };
  for (const id of ["flame_dash", "ember_nova", "flammability", "solar_orb", "firestorm", "herald_of_ash"]) {
    const start = look(id).cast!.start!;
    runOut(scene, ctx, start(ctx, player, { ...cast, skillId: id }), () => player, 10, seen);
  }
  const travel = { skillId: "skill.flame_dash.v1", progress: 0, seconds: 0.2, dirX: 0, dirY: 1 };
  const t = look("flame_dash").travel!;
  runOut(scene, ctx, t.start!(ctx, player, travel), (i) => {
    node.position.z = i * 0.6;
    return { body: player, travel: { ...travel, progress: i / 6 } };
  }, 6, seen);
  runBurst(scene, ctx, t.land!(ctx, player, travel));

  const area = (id: string, impactIn: number, index: number): AreaState => ({
    id: 100 + index, skillId: id, x: 2 + index * 0.3, y: 3, radius: 1.3, shape: "disc", dirX: 0, dirY: 1, arc: 0, index, impactIn, team: 0,
  });
  runBurst(scene, ctx, look("ember_nova").area!.impact!(ctx, { ...area("n", 0, 0), radius: 3 }));
  // The curse's slam lands on its marker area, cursed bodies or none.
  runBurst(scene, ctx, look("flammability").area!.impact!(ctx, { ...area("c", 0, 0), radius: 3 }));
  // A storm of four: index 0 lands at once, the rest warn and fall.
  const storm = look("firestorm").area!;
  const warns = [1, 2, 3].map((i) => ({ i, h: storm.warn!(ctx, area("f", i * 0.17, i)) }));
  runBurst(scene, ctx, storm.impact!(ctx, area("f", 0, 0)));
  for (const { i, h } of warns) {
    for (let k = 0; k < 6 * i; k++) { h.update?.(ctx, area("f", Math.max(0, i * 0.17 - k * DT), i)); step(scene, ctx); seen(scene); }
    h.dispose();
    runBurst(scene, ctx, storm.impact!(ctx, area("f", 0, i)));
  }

  const ground = (id: string, remaining: number, age: number): GroundState => ({
    id: 7, skillId: id, x: 1, y: 1, radius: 2.5, remaining, age, team: 0, caster: { x: 0, y: -3 },
  });
  for (const id of ["flame_dash", "solar_orb", "herald_of_ash"]) {
    const g = look(id).ground!;
    runOut(scene, ctx, g.create(ctx, ground(id, 4, 0)), (i) => ground(id, Math.max(0, 4 - i * DT), i * DT), 125, seen);
  }

  const herald = EMBERBOUND_LOOKS.buffs["herald_of_ash"]!;
  runOut(scene, ctx, herald.create(ctx, { body: player, remaining: 0, visible: true, aura: true }), () => ({ body: player, remaining: 0, visible: true }), 30, seen);

  // Two monsters cursed at once; one hides while asleep.
  const status = EMBERBOUND_LOOKS.statuses["flammable"]!;
  const bodies = [0, 1].map((i) => ({ node: new TransformNode(`m${i}`, scene), x: i, z: 4, yaw: 0 }));
  const hs = bodies.map((b) => status.create(ctx, { body: b, remaining: 0, visible: true, radius: 0.5, boss: false }));
  for (let i = 0; i < 40; i++) {
    hs.forEach((h, k) => h.update?.(ctx, { body: bodies[k]!, remaining: 0, visible: !(k === 1 && i > 20) }));
    step(scene, ctx);
    seen(scene);
  }
  hs.forEach((h, k) => runOut(scene, ctx, h, () => ({ body: bodies[k]!, remaining: 0, visible: true }), 0, seen));
  for (let i = 0; i < 150; i++) step(scene, ctx);
  for (const b of bodies) b.node.dispose();
  node.dispose();
}

describe("Emberbound looks", () => {
  it("leave nothing behind, draw no camera-facing cards, and the orb owns one light at most", () => {
    const scene = newScene();
    let maxLights = 0;
    const seen = (s: Scene) => {
      maxLights = Math.max(maxLights, counts(s).lights);
      for (const m of s.meshes) expect(m.billboardMode).toBe(0);
    };
    scenario(scene, seen);
    // Templates and pools are built once per scene; the second pass must return to the same counts.
    const warmed = counts(scene);
    scenario(scene, seen);
    expect(counts(scene)).toEqual(warmed);
    expect(maxLights).toBe(1);
    expect(warmed.lights).toBe(0);
  });

  it("keeps the orb a small sun at its height for the ground's whole life, and fades it as the ground runs out", () => {
    const scene = newScene();
    const ctx: LookContext = { scene, dt: DT, now: 1, flash: () => {} };
    const total = 4.2;
    const g = (age: number): GroundState => ({ id: 1, skillId: "o", x: 0, y: 0, radius: 3, remaining: Math.max(0, total - age), age, team: 0 });
    const h = look("solar_orb").ground!.create(ctx, g(0));
    const surface = () => scene.meshes.find((m) => m.name === "eb-sun-surface" && m.isEnabled())!;
    const at = (age: number) => { h.update?.(ctx, g(age)); step(scene, ctx); return surface(); };
    for (let age = 0; age < 1; age += DT) at(age);
    const s1 = at(1);
    expect(s1.position.y).toBeGreaterThan(1.3);
    expect(s1.position.y).toBeLessThan(1.7);
    // Surface radius 0.5 to 0.7, swelling a little on a pulse.
    expect(s1.scaling.x / 2).toBeGreaterThan(0.45);
    expect(s1.scaling.x / 2).toBeLessThan(0.8);
    for (let age = 1; age < total - 0.5; age += DT) expect(at(age).visibility, `age ${age.toFixed(2)}`).toBeGreaterThan(0.8);
    expect(at(total - 0.05).visibility).toBeLessThan(0.2);
    h.dispose();
  });

  it("gives a second orb no light while the first holds it, and the light back once it is gone", () => {
    const scene = newScene();
    const ctx: LookContext = { scene, dt: DT, now: 1, flash: () => {} };
    const g = (id: number): GroundState => ({ id, skillId: "o", x: id, y: 0, radius: 2.5, remaining: 4, age: 0.5, team: 0 });
    const create = look("solar_orb").ground!.create;
    const a = create(ctx, g(1));
    const b = create(ctx, g(2));
    a.update?.(ctx, g(1)); b.update?.(ctx, g(2));
    expect(counts(scene).lights).toBe(1);
    a.dispose(); b.dispose();
    const c = create(ctx, g(3));
    c.update?.(ctx, g(3));
    expect(counts(scene).lights).toBe(1);
    c.dispose();
    expect(counts(scene).lights).toBe(0);
  });

  it("plays a different take for every skill and turns the dash down its heading", () => {
    const clips = Object.values(EMBERBOUND_LOOKS.skills).flatMap((l) => (l.cast ? [l.cast.clip] : []));
    // The shipped skills dressed here keep their own cast, so only the class skills bring a clip.
    expect(new Set(clips).size).toBe(clips.length);
    expect(look("flame_dash").travel!.face).toBe("travel");
  });
});
