// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArcRotateCamera, NullEngine, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { PointLight } from "@babylonjs/core";
import { CLIP_NAME } from "../rig";
import { FLASH_NAME } from "../skill-fx";
import { IRONSWORN_LOOKS } from "./ironsworn";
import { IRONSWORN_CUES } from "../../audio/skill-cues/ironsworn";
import type { ActorRef, AreaState, AttachedState, BurstHandle, FxHandle, LookContext } from "./types";

const DT = 1 / 30;
let engine: NullEngine | undefined;
afterEach(() => {
  engine?.dispose();
  engine = undefined;
});

function newScene(): Scene {
  engine = new NullEngine();
  vi.spyOn(engine, "getDeltaTime").mockReturnValue(DT * 1000);
  const scene = new Scene(engine);
  scene.activeCamera = new ArcRotateCamera("cam", 0, 1, 20, new Vector3(0, 0, 0), scene);
  return scene;
}

function counts(scene: Scene) {
  const live = (o: { observers: unknown[] }) =>
    o.observers.filter((x) => !(x as { _willBeUnregistered: boolean })._willBeUnregistered).length;
  return {
    meshes: scene.meshes.length,
    materials: scene.materials.length,
    geometries: scene.geometries.length,
    lights: scene.lights.length,
    transformNodes: scene.transformNodes.length,
    before: live(scene.onBeforeRenderObservable),
    after: live(scene.onAfterRenderObservable),
  };
}

const SKILLS = ["infernal_cry", "leap_slam", "earthquake", "determination", "sunder", "blood_rage"].map((s) => `skill.${s}.v1`);

/** Every look of the class, driven to its end the way the dispatcher drives it. */
/** `abrupt`: every handle dropped a few frames in, as an area change drops them. */
function driveAll(scene: Scene, monster: TransformNode, abrupt = false): void {
  const body = new TransformNode("player", scene);
  let now = 0;
  const ctx = (): LookContext => ({ scene, dt: DT, now, flash: () => {} });
  const step = () => {
    now += DT;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    scene.onAfterRenderObservable.notifyObservers(scene);
  };
  const actor = (): ActorRef => ({ node: body, x: body.position.x, z: body.position.z, yaw: 0 });
  const runOut = (h: FxHandle<never> | FxHandle<ActorRef> | FxHandle<AttachedState> | FxHandle<AreaState>) => {
    let n = 0;
    while (!abrupt && (h.fade?.(ctx(), n * DT) ?? false) && n < 600) { step(); n++; }
    expect(n, "a fade that never ends").toBeLessThan(600);
    h.dispose();
  };
  const runBurst = (b: BurstHandle | void) => {
    if (!b) return;
    let n = 0;
    while (b.update(ctx()) && n < (abrupt ? 3 : 600)) { step(); n++; }
    if (!abrupt) expect(n, "a burst that never ends").toBeLessThan(600);
    b.dispose();
  };

  for (const id of SKILLS) {
    const look = IRONSWORN_LOOKS.skills[id]!;
    const cast = look.cast!.start?.(ctx(), actor(), { skillId: id, windup: 0.4, dirX: 0, dirY: 1 });
    for (let i = 0; i < 14; i++) { cast?.update?.(ctx(), actor()); step(); }
    if (cast) runOut(cast);
    runBurst(look.release?.(ctx(), actor(), { skillId: id, dirX: 0, dirY: 1 }));
    if (look.travel?.start) {
      const t = { skillId: id, progress: 0, seconds: 0.5, dirX: 0, dirY: 1 };
      const h = look.travel.start(ctx(), actor(), t);
      for (let i = 1; i <= 15; i++) {
        body.position.z = (7 * i) / 15;
        h.update?.(ctx(), { body: actor(), travel: { ...t, progress: i / 15 } });
        step();
      }
      runOut(h);
    }
    for (const shape of ["cone", "disc"] as const) {
      for (let index = 0; index < 3; index++) {
        const a: AreaState = { id: 1, skillId: id, x: 0, y: 3, radius: 3, shape, dirX: 0, dirY: 1, arc: shape === "cone" ? 90 : 0, index, impactIn: 1, team: 0 };
        const warn = look.area?.warn?.(ctx(), a);
        for (let i = 0; i < 30; i++) { warn?.update?.(ctx(), { ...a, impactIn: 1 - i * DT }); step(); }
        warn?.dispose();
        runBurst(look.area?.impact?.(ctx(), { ...a, impactIn: 0 }));
      }
    }
  }
  for (const [, buff] of Object.entries(IRONSWORN_LOOKS.buffs)) {
    const h = buff.create(ctx(), { body: actor(), remaining: 5, visible: true, aura: false });
    for (let i = 0; i < 150; i++) { h.update?.(ctx(), { body: actor(), remaining: 5 - i * DT, visible: true }); step(); }
    runOut(h);
  }
  for (const [, status] of Object.entries(IRONSWORN_LOOKS.statuses)) {
    const h = status.create(ctx(), { body: { node: monster, x: 0, z: 0, yaw: 0 }, remaining: 0, visible: true, radius: 0.5, boss: false });
    for (let i = 0; i < 40; i++) { h.update?.(ctx(), { body: { node: monster, x: 0, z: 0, yaw: 0 }, remaining: 0, visible: i % 7 !== 0 }); step(); }
    runOut(h);
  }
  body.dispose();
  // Let the pooled debris and the shared flash finish, and the flash hand back its warm colour.
  for (let i = 0; i < 120; i++) step();
  const light = scene.getLightByName(FLASH_NAME) as PointLight | null;
  if (light) light.intensity = 0;
  step();
}

describe("Ironsworn looks", () => {
  it("gives each skill its own shipped take", () => {
    const clips = SKILLS.map((id) => IRONSWORN_LOOKS.skills[id]!.cast!.clip);
    expect(new Set(clips).size).toBe(SKILLS.length);
    for (const c of clips) expect(CLIP_NAME[c], c).toBeDefined();
    const leap = IRONSWORN_LOOKS.skills["skill.leap_slam.v1"]!.travel!;
    expect(leap.arcHeight).toBeGreaterThanOrEqual(1.5);
    expect(leap.face).toBe("travel");
    expect(CLIP_NAME[leap.clip!]).toBeDefined();
  });

  it("draws every look and leaves nothing behind", () => {
    const scene = newScene();
    const monster = new TransformNode("monster", scene);
    driveAll(scene, monster);
    const warm = counts(scene);
    const meshesBefore = scene.meshes.length;
    driveAll(scene, monster);
    expect(counts(scene)).toEqual(warm);
    expect(scene.meshes.length).toBe(meshesBefore);
    driveAll(scene, monster, true);
    expect(counts(scene)).toEqual(warm);
  }, 20_000); // three full passes over every look

  it("thumps the camera through the shared shake", () => {
    const scene = newScene();
    const shake = vi.fn();
    const ctx = { scene, dt: DT, now: 0, flash: () => {}, shake } as LookContext;
    const a: AreaState = { id: 1, skillId: "skill.leap_slam.v1", x: 0, y: 0, radius: 2.5, shape: "disc", dirX: 0, dirY: 1, arc: 0, index: 0, impactIn: 0, team: 0 };
    const b = IRONSWORN_LOOKS.skills["skill.leap_slam.v1"]!.area!.impact!(ctx, a)!;
    expect(shake).toHaveBeenCalledTimes(1);
    expect(shake.mock.calls[0]![0]).toBeGreaterThan(0.5);
    b.dispose();
  });

  it("rings the roar on the cry's release, the loud cues on the two big impacts", () => {
    expect(IRONSWORN_CUES.skills["skill.infernal_cry.v1"]?.release).toBe("skill-infernal-cry-impact");
    expect(IRONSWORN_CUES.buffs["infernal_cry"]?.on).toBeUndefined();
    expect(IRONSWORN_CUES.skills["skill.leap_slam.v1"]?.land).toBeUndefined();
    const quake = IRONSWORN_CUES.skills["skill.earthquake.v1"]!.areaImpact as (a: { index: number; shape: "disc" | "cone"; radius: number }) => string;
    expect(quake({ index: 0, shape: "disc", radius: 3 })).toBe("skill-earthquake-aftershock");
    expect(quake({ index: 0, shape: "cone", radius: 3.5 })).toBe("skill-earthquake-impact");
  });
});
