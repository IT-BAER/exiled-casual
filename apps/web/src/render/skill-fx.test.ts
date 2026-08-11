// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { NullEngine, ParticleSystem, Scene, StandardMaterial, Texture, Vector3 } from "@babylonjs/core";
import { SKILLS } from "@exiled/content-runtime";
import { makeMesh } from "./meshes";
import {
  blinkBurst,
  BLINK_NAME,
  BLINK_STREAK_NAME,
  BLINK_ALPHA,
  BOLT_BURST_NAME,
  BOLT_TRAIL_NAME,
  CINDER_NAME,
  FLASH_NAME,
  RING_NAME,
  warmSkillFx,
  fxProfile,
  FALLBACK_FX,
  SKILL_FX,
} from "./skill-fx";

let engine: NullEngine | undefined;
afterEach(() => {
  engine?.dispose();
  engine = undefined;
});

function newScene(): Scene {
  engine = new NullEngine();
  return new Scene(engine);
}

function systems(scene: Scene, name: string): ParticleSystem[] {
  return scene.particleSystems.filter((p) => p.name === name) as ParticleSystem[];
}

describe("ember bolt", () => {
  it("flies with a spark trail emitted from the bolt itself", () => {
    const scene = newScene();
    const mesh = makeMesh(scene, "projectile", "entity-7");

    const [trail] = systems(scene, BOLT_TRAIL_NAME);
    expect(trail).toBeDefined();
    // The mesh, not a Vector3: the emit point has to follow the bolt, while the
    // particles it already dropped stay behind in world space.
    expect(trail!.emitter).toBe(mesh);
    expect(trail!.blendMode).toBe(ParticleSystem.BLENDMODE_ADD);
  });

  it("strings its ribbon at the bolt, never back to the world origin", () => {
    const scene = newScene();
    const at = new Vector3(12, 0.8, -9);
    makeMesh(scene, "projectile", "entity-7", at);

    const ribbon = scene.getMeshByName(`${BOLT_TRAIL_NAME}-ribbon`);
    expect(ribbon).not.toBeNull();
    // A trail seeds every section where its generator stands at build time, in
    // world space. One section left at (0,0,0) is a beam across the level.
    const pos = ribbon!.getVerticesData("position")!;
    let farthest = 0;
    for (let i = 0; i < pos.length; i += 3) {
      farthest = Math.max(farthest, Math.hypot(pos[i]! - at.x, pos[i + 2]! - at.z));
    }
    expect(farthest).toBeLessThan(1);
  });

  /**
   * Every bolt costs a per-frame observer for the rest of the session unless the
   * trail is STOPPED, not merely disposed.
   *
   * `TrailMesh.start()` registers an `onBeforeRenderObservable` observer and
   * only `stop()` removes it — Babylon's TrailMesh has no `dispose()` override
   * of its own (checked against 9.20.0), so `dispose()` leaves that observer
   * running `update()` over the vertex buffers of a mesh that is gone. Thirty
   * two bolts into a session that is thirty two dead loops a frame, measured
   * live, and it never recovers because leaving the area does not touch it.
   */
  it("takes its ribbon's per-frame observer with it when the bolt lands", async () => {
    const scene = newScene();
    const trailObservers = () =>
      scene.onBeforeRenderObservable.observers.filter((o) =>
        String(o.callback).includes("this.update()")).length;

    const mesh = makeMesh(scene, "projectile", "entity-7");
    expect(trailObservers()).toBe(1);

    mesh.dispose();
    // Observable.remove marks and splices on a setTimeout(0), so the count is
    // only honest on the next macrotask. Reading it synchronously says "still
    // registered" whether the removal happened or not.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(scene.getMeshByName(`${BOLT_TRAIL_NAME}-ribbon`)).toBeNull();
    expect(trailObservers()).toBe(0);
  });

  it("burns each spark through the flipbook over its own lifetime", () => {
    const scene = newScene();
    makeMesh(scene, "projectile", "entity-7");
    const trail = systems(scene, BOLT_TRAIL_NAME)[0]!;

    expect(trail.isAnimationSheetEnabled).toBe(true);
    expect(trail.startSpriteCellID).toBe(0);
    expect(trail.endSpriteCellID).toBeGreaterThan(0);
    // 0 does not mean "no animation": it means Babylon fits the whole sheet to
    // the particle's life, which is the only reason the flame dies in step with
    // its own fade.
    expect(trail.spriteCellChangeSpeed).toBe(0);
  });

  it("shrinks its sparks by size gradient, which is what actually sets the size", () => {
    const scene = newScene();
    makeMesh(scene, "projectile", "entity-7");
    const trail = systems(scene, BOLT_TRAIL_NAME)[0]!;

    // Once a size gradient exists Babylon stops reading minSize/maxSize at all,
    // so the curve is the only place the size can come from.
    const stops = trail.getSizeGradients() ?? [];
    expect(stops.length).toBeGreaterThan(1);
    expect(stops[stops.length - 1]!.factor1).toBeLessThan(stops[0]!.factor1);
    expect(trail.maxScaleX).toBeGreaterThan(trail.minScaleX);
  });

  it("bursts where it died, because the sim disposing the mesh IS the impact", () => {
    const scene = newScene();
    const mesh = makeMesh(scene, "projectile", "entity-7");
    mesh.position.set(4, 0.8, -2);
    mesh.computeWorldMatrix(true);

    expect(systems(scene, BOLT_BURST_NAME)).toHaveLength(0);
    mesh.dispose();

    const [impact] = systems(scene, BOLT_BURST_NAME);
    expect(impact).toBeDefined();
    expect(impact!.emitter).toBeInstanceOf(Vector3);
    expect((impact!.emitter as Vector3).x).toBeCloseTo(4);
    expect((impact!.emitter as Vector3).z).toBeCloseTo(-2);
    // One shot that cleans itself up, or every cast leaks a system.
    expect(impact!.manualEmitCount).toBeGreaterThan(0);
    expect(impact!.disposeOnStop).toBe(true);
    expect(impact!.targetStopDuration).toBeGreaterThan(0);

    // Babylon disposes any system emitting from the mesh along with it, so a
    // bolt that has landed leaves nothing behind but its burst.
    expect(systems(scene, BOLT_TRAIL_NAME)).toHaveLength(0);

    // Sparks alone read as a small hit. The ring says how big it was and the
    // light is what puts it on the floor.
    const ring = scene.getMeshByName(RING_NAME);
    expect(ring).not.toBeNull();
    expect(ring!.position.y).toBeLessThan(0.2); // on the floor, not at bolt height
    const light = scene.getLightByName(FLASH_NAME);
    expect(light).not.toBeNull();
    expect(light!.intensity).toBeGreaterThan(0);
  });

  it("reuses one flash light, so a second hit cannot push a material over 4", () => {
    const scene = newScene();
    for (const id of [1, 2]) {
      const bolt = makeMesh(scene, "projectile", `entity-${id}`);
      bolt.computeWorldMatrix(true);
      bolt.dispose();
    }
    expect(scene.lights.filter((l) => l.name === FLASH_NAME)).toHaveLength(1);
  });
});

describe("warmSkillFx", () => {
  it("stands the whole impact vocabulary up dark, so the first real hit compiles nothing", () => {
    const scene = newScene();
    warmSkillFx(scene);

    // The flash light EXISTS (its arrival is what recompiles every material
    // for a fourth light) but at zero intensity: the warm-up must be invisible.
    const light = scene.getLightByName(FLASH_NAME);
    expect(light).not.toBeNull();
    expect(light!.intensity).toBe(0);

    // The burst and ring are live, so the particle and glow shaders compile
    // behind the loading plate instead of on the first cast.
    expect(systems(scene, BOLT_BURST_NAME)).toHaveLength(1);
    expect(scene.getMeshByName(RING_NAME)).not.toBeNull();
  });

  it("is idempotent per area: a second warm leaves one flash light", () => {
    const scene = newScene();
    warmSkillFx(scene);
    warmSkillFx(scene);
    expect(scene.lights.filter((l) => l.name === FLASH_NAME)).toHaveLength(1);
  });
});

describe("cinder ground", () => {
  it("emits its embers from the disc, so they cover the entity's real radius", () => {
    const scene = newScene();
    const mesh = makeMesh(scene, "groundArea", "entity-9");

    const [cinders] = systems(scene, CINDER_NAME);
    expect(cinders).toBeDefined();
    // The renderer scales the disc x/z to the radius; only a mesh emitter picks
    // that up, since Babylon pushes emitted points through its world matrix.
    expect(cinders!.emitter).toBe(mesh);
    // Rising, not falling: these are cinders off a hot patch.
    expect(cinders!.gravity.y).toBeGreaterThan(0);
  });

  it("fades the disc out at its rim instead of ending on a hard edge", () => {
    const scene = newScene();
    const mesh = makeMesh(scene, "groundArea", "entity-9");
    const mat = mesh.material as StandardMaterial;

    // The falloff texture itself cannot be painted under NullEngine (no 2D
    // canvas), so what is pinned here is the additive, unlit setup it rides on.
    expect(mat.alphaMode).toBe(1); // ALPHA_ADD
    expect(mat.disableLighting).toBe(true);
    expect(mat.alpha).toBeLessThan(1);
    // Cracks, tiled rather than stretched, so their size does not depend on how
    // big the patch happens to be.
    expect(mat.emissiveTexture).not.toBeNull();
    expect((mat.emissiveTexture as Texture).uScale).toBeGreaterThan(1);
  });
});

describe("blink", () => {
  it("marks both ends, and collapses inward at the one the player left", () => {
    const scene = newScene();
    blinkBurst(scene, new Vector3(0, 0.9, 0), new Vector3(5, 0.9, 0));

    // Without something joining the two ends, a teleport reads as a desync.
    const streak = scene.getMeshByName(BLINK_STREAK_NAME);
    expect(streak).not.toBeNull();
    expect(streak!.position.x).toBeCloseTo(2.5); // midway
    expect(streak!.rotationQuaternion).not.toBeNull();

    const puffs = systems(scene, BLINK_NAME);
    expect(puffs).toHaveLength(2);
    for (const p of puffs) {
      expect(p.manualEmitCount).toBeGreaterThan(0);
      expect(p.disposeOnStop).toBe(true);
    }
    // Negative emit power on a sphere emitter walks the particles inward, which
    // is the only thing separating an implosion from the arrival burst.
    expect(puffs.some((p) => p.maxEmitPower < 0)).toBe(true);
    expect(puffs.some((p) => p.minEmitPower > 0)).toBe(true);
  });

  it("does not borrow the fire look, because a teleport has no element", () => {
    const scene = newScene();
    blinkBurst(scene, new Vector3(0, 0.9, 0), new Vector3(5, 0.9, 0));

    for (const p of systems(scene, BLINK_NAME)) {
      // The flipbook is the ember palette. Reusing it here is what made all
      // three starter skills read as one recoloured effect.
      expect(p.isAnimationSheetEnabled).toBe(false);
      expect((p.particleTexture as Texture).url).not.toContain("fire");
    }
    // And no impact flash: nothing landed, and that light floods the floor.
    expect(scene.getLightByName(FLASH_NAME)).toBeNull();
  });

  /**
   * Both halves of what made this read as a lightsaber. The alpha the code
   * documented was overwritten on the streak's first frame by playOnce, so what
   * shipped was a near-opaque additive bar five units long that clipped to white;
   * and the uniform scale-down dragged both ends toward the middle, so the one
   * thing joining where he left to where he arrived let go of both while fading.
   */
  it("the streak stays violet rather than clipping to white", () => {
    const scene = newScene();
    blinkBurst(scene, new Vector3(0, 0.9, 0), new Vector3(5, 0.9, 0));
    const streak = scene.getMeshByName(BLINK_STREAK_NAME)!;
    const mat = streak.material as StandardMaterial;
    expect(mat.alpha).toBeLessThanOrEqual(BLINK_ALPHA);
    expect(BLINK_ALPHA).toBeLessThan(0.5);
    // Additive, so the colour only survives if the alpha leaves room for it.
    expect(mat.emissiveColor.b).toBeGreaterThan(mat.emissiveColor.r);
  });

  it("fades without letting go of either end", () => {
    const scene = newScene();
    blinkBurst(scene, new Vector3(0, 0.9, 0), new Vector3(5, 0.9, 0));
    const streak = scene.getMeshByName(BLINK_STREAK_NAME)!;
    const at = streak.position.clone();
    // Drive the fade directly: a NullEngine scene has no camera to render with,
    // and the observable is what the one-shot animations actually hang off.
    for (let i = 0; i < 40; i++) scene.onBeforeRenderObservable.notifyObservers(scene);
    // Either still standing at full length, or gone. Never a short bar hanging
    // between the two points it was supposed to be touching.
    const still = scene.getMeshByName(BLINK_STREAK_NAME);
    if (still) {
      expect(still.scaling.y).toBe(1);
      expect(still.position.equals(at)).toBe(true);
    }
  });
});

describe("fx profiles", () => {
  it("gives every authored skill its own profile", () => {
    const missing = [...SKILLS.keys()].filter((id) => SKILL_FX[id] === undefined);
    expect(missing, `skills with no FX profile: ${missing.join(", ")}`).toEqual([]);
  });

  it("falls back rather than throwing on an id it does not know", () => {
    expect(fxProfile("skill.not_a_skill.v9")).toBe(FALLBACK_FX);
    expect(fxProfile(undefined)).toBe(FALLBACK_FX);
  });
});
