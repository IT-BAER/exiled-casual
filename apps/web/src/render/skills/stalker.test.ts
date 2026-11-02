// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { Mesh } from "@babylonjs/core";
import { attachArrowStreak, buildArrow, FLASH_NAME, PROJECTILE_ARROW_SCALE, SKILL_FX } from "../skill-fx";
import { chunkPool, kitPools } from "./kit";
import type { SnapshotEntity } from "@exiled/protocol";
import { STALKER_LOOKS } from "./stalker";
import { SkillLookDispatcher } from "./dispatcher";
import type { AreaState, AttachedState, FxHandle, LookContext, ProjectileHandle, ProjectileState } from "./types";

const DT = 1 / 30;
let engine: NullEngine | undefined;
afterEach(() => {
  engine?.dispose();
  engine = undefined;
});

function newScene(): Scene {
  engine = new NullEngine();
  vi.spyOn(engine, "getDeltaTime").mockReturnValue(DT * 1000);
  return new Scene(engine);
}

function ctxOf(scene: Scene): LookContext {
  return { scene, dt: DT, now: 0, flash: () => {} };
}

function frame(scene: Scene, n = 1): void {
  for (let i = 0; i < n; i++) scene.onBeforeRenderObservable.notifyObservers(scene);
}

function counts(scene: Scene) {
  const light = scene.getLightByName(FLASH_NAME);
  if (light) light.intensity = 0;
  frame(scene);
  return {
    meshes: scene.meshes.length,
    materials: scene.materials.length,
    geometries: scene.geometries.length,
    lights: scene.lights.length,
    transformNodes: scene.transformNodes.length,
    observers: scene.onBeforeRenderObservable.observers.filter((o) => !(o as unknown as { _willBeUnregistered: boolean })._willBeUnregistered).length,
  };
}

function emitted(scene: Scene): number {
  const p = kitPools(scene);
  return [p.shards, p.glow, p.smoke, p.motes, p.drops].reduce((n, x) => n + x.emitted, 0)
    + (["rock", "ice", "molten"] as const).reduce((n, k) => n + chunkPool(scene, k).emitted, 0);
}

/** Drive a lasting handle a second, fade it out and dispose it, stepping the scene alongside. */
function runLasting<S>(scene: Scene, h: FxHandle<S>, state: S): void {
  const ctx = ctxOf(scene);
  for (let i = 0; i < 30; i++) {
    h.update?.(ctx, state);
    frame(scene);
  }
  let s = 0;
  while (h.fade && h.fade(ctx, s) && s < 5) {
    s += DT;
    frame(scene);
  }
  h.dispose();
  frame(scene, 120);
}

function arrow(scene: Scene, skill: string): Mesh {
  const m = buildArrow(scene, `entity-${Math.random()}`);
  m.scaling.setAll(PROJECTILE_ARROW_SCALE);
  attachArrowStreak(scene, m, STALKER_LOOKS.skills[skill]!.projectileFx!);
  return m;
}

/** The look the dispatcher would make for this arrow, with the state it hands it each frame. */
function fly(scene: Scene, id: string, a: Mesh, chainFrom?: ProjectileState["chainFrom"]) {
  const state = (): ProjectileState => ({ id: 1, skillId: id, node: a, dirX: 0, dirY: 1, team: 0, spent: false, arrow: true, ...(chainFrom ? { chainFrom } : {}) });
  const h: ProjectileHandle = STALKER_LOOKS.skills[id]!.projectile!.create(ctxOf(scene), state());
  return { h, step: (n = 1) => { for (let i = 0; i < n; i++) { h.update(ctxOf(scene), state()); frame(scene); } }, state };
}

const BOW_SKILLS = ["skill.escape_shot.v1", "skill.ice_shot.v1", "skill.lightning_arrow.v1"];

describe("stalker looks", () => {
  it("gives every arrow its own wake, so the three read apart", () => {
    const wakes = [...Object.values(SKILL_FX).filter((f) => f.arrow), ...BOW_SKILLS.map((id) => STALKER_LOOKS.skills[id]!.projectileFx!)]
      .map((f) => f.wake.toHexString());
    const mine = BOW_SKILLS.map((id) => STALKER_LOOKS.skills[id]!.projectileFx!.wake.toHexString());
    for (const w of mine) expect(wakes.filter((x) => x === w), w).toHaveLength(1);
  });

  it("uses a different clip for every skill", () => {
    const clips = Object.values(STALKER_LOOKS.skills).flatMap((l) => (l.cast ? [l.cast.clip] : []));
    // The shipped skills dressed here keep their own cast, so only the class skills bring a clip.
    expect(new Set(clips).size).toBe(clips.length);
  });

  it.each(BOW_SKILLS)("dresses a %s arrow in flight, bursts where it strikes, and leaves nothing behind", (id) => {
    const scene = newScene();
    // Warm the templates, pools and materials once; the second shot must cost nothing lasting.
    for (let shot = 0; shot < 2; shot++) {
      const before = shot === 1 ? counts(scene) : null;
      const a = arrow(scene, id);
      a.position.set(0, 1, 0.5);
      const bare = scene.meshes.length;
      const { h, step, state } = fly(scene, id, a);
      step(2);
      expect(scene.meshes.length, `${id} dressed`).toBeGreaterThan(bare);
      for (let i = 0; i < 10; i++) {
        a.position.z += 0.5;
        step();
      }
      const was = emitted(scene);
      h.impact!(ctxOf(scene), { ...state(), spent: true });
      h.dispose();
      a.dispose();
      expect(emitted(scene), `${id} burst`).toBeGreaterThan(was + 10);
      frame(scene, 150);
      if (before) expect(counts(scene), id).toEqual(before);
    }
  });

  it("an arrow that ran out of range just drops: no burst", () => {
    const scene = newScene();
    const a = arrow(scene, "skill.ice_shot.v1");
    const { h, step } = fly(scene, "skill.ice_shot.v1", a);
    step(3);
    const was = emitted(scene);
    h.dispose();
    a.dispose();
    expect(emitted(scene)).toBe(was);
    frame(scene, 120);
  });

  it("is handed the shipped arrow by the dispatcher, and its runs finish under it", () => {
    const scene = newScene();
    const d = new SkillLookDispatcher(scene);
    for (const id of BOW_SKILLS) {
      const a = arrow(scene, id);
      a.position.set(0.4, 1.2, 0.6);
      const meshes = scene.meshes.length;
      const e = { id: 7, kind: "projectile", x: 0.4, y: 0.6, skillId: id, team: 0 } as SnapshotEntity;
      d.projectile(e, a, 0, 1, true);
      frame(scene, 2);
      d.projectile(e, a, 0, 1, true);
      expect(scene.meshes.length, id).toBeGreaterThan(meshes);
      const was = emitted(scene);
      d.projectileGone(7, true);
      a.dispose();
      expect(emitted(scene), id).toBeGreaterThan(was);
    }
    expect(d.live).toBeGreaterThan(0);
    d.clear();
    expect(d.live).toBe(0);
    frame(scene, 120);
  });

  it("draws a lightning chain from the body it left (chainFrom) to the arrow", () => {
    const scene = newScene();
    const chain = arrow(scene, "skill.lightning_arrow.v1");
    chain.position.set(3.5, 1, 0);
    const { h, step } = fly(scene, "skill.lightning_arrow.v1", chain, { id: 4, x: 3, z: 0, node: null });
    step();
    chain.position.set(6, 1, 0);
    step(2);
    // The leap: one arc spanning from the struck body all the way to the flying arrow.
    const spans = scene.meshes.filter((m) => m.name === "stalker-arc-core" && m.isEnabled()).map((m) => {
      m.refreshBoundingInfo({});
      const b = m.getBoundingInfo().boundingBox;
      return [b.minimumWorld.x, b.maximumWorld.x];
    });
    expect(spans.some(([lo, hi]) => lo! < 3.3 && hi! > 5.5), JSON.stringify(spans)).toBe(true);
    h.dispose();
    chain.dispose();
    frame(scene, 120);
  });

  it("lays every chain arc across the floor from the body it left to the body it struck, never up into the air", () => {
    const scene = newScene();
    const id = "skill.lightning_arrow.v1";
    const extent = () => scene.meshes.filter((m) => (m.name === "stalker-arc-core" || m.name === "kit-bolt-core") && m.isEnabled()).map((m) => {
      m.refreshBoundingInfo({});
      const b = m.getBoundingInfo().boundingBox;
      return { x: [b.minimumWorld.x, b.maximumWorld.x], y: b.maximumWorld.y, z: [b.minimumWorld.z, b.maximumWorld.z] };
    });
    const joins = (e: ReturnType<typeof extent>[number], x0: number, z0: number, x1: number, z1: number) =>
      e.x[0]! <= Math.min(x0, x1) + 0.2 && e.x[1]! >= Math.max(x0, x1) - 0.2 && e.z[0]! <= Math.min(z0, z1) + 0.2 && e.z[1]! >= Math.max(z0, z1) - 0.2;
    // The first hit: nothing of its own climbs above the struck body.
    const first = arrow(scene, id);
    first.position.set(1, 1, 2);
    const one = fly(scene, id, first);
    one.step();
    one.h.impact?.(ctxOf(scene), { ...one.state(), spent: true });
    one.h.dispose();
    first.dispose();
    frame(scene);
    for (const e of extent()) expect(e.y, JSON.stringify(e)).toBeLessThan(1.6);
    frame(scene, 60);
    // A chain off that body, diagonally to the next one at (4, 6).
    const chain = arrow(scene, id);
    chain.position.set(1.6, 1, 2.8);
    const two = fly(scene, id, chain, { id: 4, x: 1, z: 2, node: null });
    two.step();
    chain.position.set(4, 1, 6);
    two.step();
    expect(extent().some((e) => joins(e, 1, 2, 4, 6)), JSON.stringify(extent())).toBe(true);
    two.h.impact?.(ctxOf(scene), { ...two.state(), spent: true });
    two.h.dispose();
    chain.dispose();
    frame(scene);
    // The leap held after it lands: still body to body, at chest height.
    const held = extent().filter((e) => joins(e, 1, 2, 4, 6));
    expect(held.length, JSON.stringify(extent())).toBeGreaterThan(0);
    for (const e of held) expect(e.y).toBeLessThan(1.6);
    frame(scene, 120);
  });

  it("runs every cast, travel, status and buff look and gives everything back", () => {
    const scene = newScene();
    const player = { node: new TransformNode("p", scene), x: 0, z: 0, yaw: 0 };
    const monster = new TransformNode("m", scene);
    const cycle = () => {
      const ctx = ctxOf(scene);
      for (const [id, look] of Object.entries(STALKER_LOOKS.skills)) {
        const cast = look.cast?.start?.(ctx, player, { skillId: id, dirX: 0, dirY: 1, windup: 0.3 });
        if (cast) runLasting(scene, cast, player);
        const t = { skillId: id, progress: 0.5, seconds: 0.3, dirX: 0, dirY: -1 };
        const travel = look.travel?.start?.(ctx, player, t);
        if (travel) runLasting(scene, travel, { body: player, travel: t });
        const land = look.travel?.land?.(ctx, player, t);
        if (land) while (land.update(ctx)) frame(scene);
        land?.dispose();
      }
      const body = { node: monster, x: 0, z: 0, yaw: 0 };
      for (const status of Object.values(STALKER_LOOKS.statuses)) {
        const st: AttachedState = { body, remaining: 0, visible: true };
        runLasting(scene, status.create(ctx, { ...st, radius: 0.6, boss: false }), st);
      }
      for (const buff of Object.values(STALKER_LOOKS.buffs)) {
        const st: AttachedState = { body: player, remaining: 0, visible: true };
        runLasting(scene, buff.create(ctx, { ...st, aura: true }), st);
      }
      frame(scene, 150);
    };
    cycle();
    const before = counts(scene);
    cycle();
    expect(counts(scene)).toEqual(before);
  });

  it("rains an arrow onto each landing, timed to its impact, with a shimmer under it", () => {
    const scene = newScene();
    const ctx = ctxOf(scene);
    const area = STALKER_LOOKS.skills["skill.rain_of_arrows.v1"]!.area!;
    const run = () => {
      const a: AreaState = { id: 5, skillId: "skill.rain_of_arrows.v1", x: 4, y: 2, radius: 1, shape: "disc", dirX: 0, dirY: 1, arc: 0, index: 0, impactIn: 0.6, team: 0 };
      const warn = area.warn!(ctx, a);
      const shimmer = scene.meshes.find((m) => m.name === "stalker-volley-warn" && m.isEnabled());
      expect(shimmer).toBeDefined();
      let arrowAt: Vector3 | null = null;
      for (let t = 0; t <= 18; t++) {
        warn.update?.(ctx, { ...a, impactIn: Math.max(0, 0.6 - t * DT) });
        frame(scene);
        const shaft = scene.meshes.find((m) => m.name === "stalker-volley-arrow" && m.isEnabled());
        if (shaft) arrowAt = shaft.position.clone();
      }
      warn.dispose();
      // On the floor at its landing when the impact comes.
      expect(arrowAt).not.toBeNull();
      expect(Math.hypot(arrowAt!.x - 4, arrowAt!.z - 2)).toBeLessThan(0.05);
      expect(arrowAt!.y).toBeLessThan(0.2);
      const burst = area.impact!(ctx, { ...a, impactIn: 0 });
      if (burst) {
        while (burst.update(ctx)) frame(scene);
        burst.dispose();
      }
      frame(scene, 150);
    };
    run();
    const before = counts(scene);
    run();
    expect(counts(scene)).toEqual(before);
  });
});
