// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { Effect, Light, NullEngine, ParticleSystem, PointLight, Scene, StandardMaterial, Texture, Vector3 } from "@babylonjs/core";
import { SKILLS } from "@exiled/content-runtime";
import { makeMesh, warmEntityLooks, warmProjectiles, WARM_LOOK_PREFIX } from "./meshes";
import { GROUND_LOOK_BASES } from "./ground-looks";
import { createScene } from "./engine";
import {
  blinkBurst,
  BLINK_NAME,
  BLINK_STREAK_NAME,
  BLINK_ALPHA,
  BOLT_BURST_NAME,
  BOLT_TRAIL_NAME,
  BOLT_SMOKE_NAME,
  BOLT_BLAST_NAME,
  emberBurst,
  CINDER_NAME,
  FLASH_NAME,
  RING_NAME,
  warmSkillFx,
  FX_KEEPALIVE_NAME,
  fxProfile,
  FALLBACK_FX,
  SKILL_FX,
  meleeImpact,
  MELEE_SPARKS_NAME,
  MELEE_DUST_NAME,
  swingTrail,
  SWING_TRAIL_NAME,
  ARROW_LENGTH,
  PROJECTILE_ARROW_SCALE,
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
    const light = scene.getLightByName(FLASH_NAME) as PointLight | null;
    expect(light).not.toBeNull();
    expect(light!.intensity).toBeGreaterThan(0);
    // Over the hit at lamp height, never at bolt height: PBR hides fall off with
    // the square of distance, and a light on the struck body's skin whites it out.
    expect(light!.position.x).toBeCloseTo(4);
    expect(light!.position.z).toBeCloseTo(-2);
    expect(light!.position.y).toBeGreaterThanOrEqual(1.5);
    // A pool around the hit, not the view: PBR ignores `range` unless the
    // falloff is glTF's, which fades to zero at it.
    expect(light!.falloffType).toBe(Light.FALLOFF_GLTF);
    expect(light!.range).toBeLessThanOrEqual(5);
  });

  it("gives the flame sheet an alpha channel, or fog tints the black around each flame into a square", () => {
    const scene = newScene();
    const url = (emberBurst(scene, Vector3.Zero()).particleTexture as Texture).url;
    const png = readFileSync(new URL(`../../public${url}`, import.meta.url));
    // IHDR colour type: 6 is RGBA. An opaque sheet is additive black that fog
    // turns into fog colour, and a burst stacks those quads into grey boxes.
    expect(png[25]).toBe(6);
  });

  it("leaves soft smoke over the hit that outlives the fire", () => {
    const scene = newScene();
    const fire = emberBurst(scene, new Vector3(4, 0.8, -2));
    const smoke = systems(scene, BOLT_SMOKE_NAME)[0]!;
    expect(smoke).toBeTruthy();
    // Normally blended, so it can darken and veil what is behind it; additive
    // "smoke" is only ever light.
    expect(smoke.blendMode).toBe(ParticleSystem.BLENDMODE_STANDARD);
    expect((smoke.emitter as Vector3).x).toBeCloseTo(4);
    expect((smoke.emitter as Vector3).z).toBeCloseTo(-2);
    expect(smoke.maxLifeTime).toBeGreaterThan(fire.maxLifeTime * 2);
    expect(smoke.disposeOnStop).toBe(true);
    // Its shape is the texture's alpha: an opaque sheet here IS a grey square.
    const url = (smoke.particleTexture as Texture).url;
    expect(readFileSync(new URL(`../../public${url}`, import.meta.url))[25]).toBe(6);
  });

  it("bursts as a small fireball that swells, and the smoke stays second to the fire", () => {
    const scene = newScene();
    const sparks = emberBurst(scene, new Vector3(4, 0.8, -2));
    const blast = systems(scene, BOLT_BLAST_NAME)[0]!;
    expect(blast).toBeTruthy();
    expect(blast.blendMode).toBe(ParticleSystem.BLENDMODE_ADD);
    const size = blast.getSizeGradients()!;
    expect(size[size.length - 1]!.factor1).toBeGreaterThan(size[0]!.factor1);
    expect(blast.disposeOnStop).toBe(true);
    // A starter skill: a few big flames, not a second spark shower.
    expect(blast.manualEmitCount).toBeLessThanOrEqual(8);
    const smoke = systems(scene, BOLT_SMOKE_NAME)[0]!;
    expect(smoke.manualEmitCount * 4).toBeLessThanOrEqual(sparks.manualEmitCount);
  });

  it("colours its head from its own skill, not whichever projectile spawned first", () => {
    const scene = newScene();
    const bolt = makeMesh(scene, "projectile", "entity-1", undefined, undefined, "skill.ember_bolt.v1");
    const spark = makeMesh(scene, "projectile", "entity-2", undefined, undefined, "skill.ember_spark.v1");
    const bolt2 = makeMesh(scene, "projectile", "entity-3", undefined, undefined, "skill.ember_bolt.v1");

    const boltMat = bolt.material as StandardMaterial;
    const sparkMat = spark.material as StandardMaterial;
    expect(boltMat.emissiveColor.equals(sparkMat.emissiveColor)).toBe(false);
    // Same skill reuses the same cached material, so the cache still caches.
    expect(bolt2.material).toBe(bolt.material);
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

describe("melee", () => {
  it("a landed blow throws sparks and dust, rings the floor and lights it", () => {
    const scene = newScene();
    meleeImpact(scene, new Vector3(1, 0.8, 0), 1, 0);
    expect(systems(scene, MELEE_SPARKS_NAME)).toHaveLength(1);
    expect(systems(scene, MELEE_DUST_NAME)).toHaveLength(1);
    expect(scene.getMeshByName(RING_NAME)).not.toBeNull();
    expect((scene.getLightByName(FLASH_NAME) as PointLight).intensity).toBeGreaterThan(0);
  });

  it("a swing ribbon follows its node and leaves nothing behind when cut", () => {
    const scene = newScene();
    const swing = () => {
      const trail = swingTrail(scene);
      trail.follow(new Vector3(0, 1, 0.5));
      expect(scene.getMeshByName(SWING_TRAIL_NAME)).not.toBeNull();
      trail.dispose();
      expect(scene.getMeshByName(SWING_TRAIL_NAME)).toBeNull();
    };
    // The first one also brings the scene's shared default material in.
    swing();
    const after = scene.materials.length;
    for (let i = 0; i < 4; i++) swing();
    expect(scene.materials.length).toBe(after);
    expect(scene.transformNodes.filter((n) => n.name.startsWith(SWING_TRAIL_NAME))).toHaveLength(0);
  });
});

describe("arrows", () => {
  const BOW_SKILLS = [...SKILLS.values()].filter((s) => s.bow).map((s) => s.id);

  it("every bow skill flies an arrow a shaft long, not a burning pip", () => {
    expect(BOW_SKILLS.length).toBeGreaterThan(0);
    for (const id of BOW_SKILLS) {
      const scene = newScene();
      const arrow = makeMesh(scene, "projectile", "entity-1", Vector3.Zero(), undefined, id);
      arrow.computeWorldMatrix(true);
      const { minimumWorld: min, maximumWorld: max } = arrow.getBoundingInfo().boundingBox;
      // Smaller in flight than on the string: at full bow size it read as a javelin.
      expect(max.z - min.z, id).toBeGreaterThan(ARROW_LENGTH * PROJECTILE_ARROW_SCALE);
      expect(max.z - min.z, id).toBeLessThan(ARROW_LENGTH);
      expect(max.x - min.x, id).toBeLessThan(0.2);
      expect(systems(scene, BOLT_TRAIL_NAME), id).toHaveLength(0);
    }
    const scene = newScene();
    const bolt = makeMesh(scene, "projectile", "entity-2", Vector3.Zero(), undefined, "skill.ember_bolt.v1");
    const { minimum: min, maximum: max } = bolt.getBoundingInfo().boundingBox;
    expect(max.z - min.z).toBeLessThan(0.2);
  });

  it("shares one merged material across arrows instead of leaking one per shot", () => {
    const scene = newScene();
    const count = () => scene.materials.length + scene.multiMaterials.length;
    makeMesh(scene, "projectile", "entity-1", Vector3.Zero(), undefined, "skill.snap_shot.v1").dispose();
    const after = count();
    for (let i = 2; i < 6; i++) makeMesh(scene, "projectile", `entity-${i}`, Vector3.Zero(), undefined, "skill.snap_shot.v1").dispose();
    expect(count()).toBe(after);
  });

  it("a struck arrow lands a hit, one that ran out of range just drops", () => {
    const scene = newScene();
    const spent = makeMesh(scene, "projectile", "entity-1", Vector3.Zero(), undefined, "skill.snap_shot.v1");
    const lapsed = makeMesh(scene, "projectile", "entity-2", Vector3.Zero(), undefined, "skill.snap_shot.v1");
    lapsed.dispose();
    expect(systems(scene, MELEE_SPARKS_NAME)).toHaveLength(0);
    spent.metadata = { struck: true };
    spent.dispose();
    expect(systems(scene, MELEE_SPARKS_NAME)).toHaveLength(1);
    expect(scene.getMeshByName(RING_NAME)).not.toBeNull();
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

  it("keeps a fire and a wisp system alive, so a burst never frees the shared shader and sheet", () => {
    const scene = newScene();
    warmSkillFx(scene);
    warmSkillFx(scene);
    const keep = systems(scene, FX_KEEPALIVE_NAME);
    expect(keep).toHaveLength(2);
    expect(keep.every((p) => !p.isStarted() && p.particleTexture !== null)).toBe(true);
  });

  it("is idempotent per area: a second warm leaves one flash light", () => {
    const scene = newScene();
    warmSkillFx(scene);
    warmSkillFx(scene);
    expect(scene.lights.filter((l) => l.name === FLASH_NAME)).toHaveLength(1);
  });
});

describe("game scene", () => {
  it("keeps compiled shaders when the last burst using one is gone, so the next cast links nothing", () => {
    engine = new NullEngine();
    createScene(engine);
    expect(Effect.PersistentMode).toBe(true);
  });
});

describe("warmProjectiles", () => {
  it("draws every projectile look once, arrow wake shortened, then lets it go", async () => {
    const scene = newScene();
    warmProjectiles(scene);
    const warm = scene.meshes.filter((m) => m.name.startsWith("warm-projectile-"));
    expect(warm).toHaveLength(Object.keys(SKILL_FX).length);
    // Culling must not skip them: an undrawn mesh compiles nothing.
    expect(warm.every((m) => m.alwaysSelectAsActiveMesh)).toBe(true);
    // A flying arrow's wake is cut short on one axis, which is its own shader variant.
    const arrow = warm.find((m) => m.name === "warm-projectile-skill.snap_shot.v1")!;
    expect(arrow.getChildMeshes(true).some((c) => c.scaling.y < 1)).toBe(true);
    await scene.whenReadyAsync();
    expect(scene.meshes.some((m) => m.name.startsWith("warm-projectile-"))).toBe(false);
  });
});

describe("warmEntityLooks", () => {
  it("draws every look the sim can spawn mid-run until released", async () => {
    const scene = newScene();
    const release = warmEntityLooks(scene);
    const warm = scene.meshes.filter((m) => m.name.startsWith(WARM_LOOK_PREFIX));
    const roots = warm.filter((m) => !m.parent);
    // Telegraph, ground area, portal, a heap and a jackpot heap, a monster, and every drop that
    // has a floor model, each once as built and once squashed.
    expect(roots.length).toBe(2 * (6 + GROUND_LOOK_BASES.length));
    expect(roots.filter((m) => m.scaling.y !== m.scaling.x)).toHaveLength(6 + GROUND_LOOK_BASES.length);
    expect(GROUND_LOOK_BASES).toContain("currency.wisdom");
    expect(warm.every((m) => m.alwaysSelectAsActiveMesh)).toBe(true);
    // Still drawn once ready: the fire pool's lights come on in the first frames after that.
    await scene.whenReadyAsync();
    expect(scene.meshes.some((m) => m.name.startsWith(WARM_LOOK_PREFIX))).toBe(true);
    release();
    expect(scene.meshes.some((m) => m.name.startsWith(WARM_LOOK_PREFIX))).toBe(false);
  });
});

describe("warmSkillFx swing trail", () => {
  it("draws a weapon's swing ribbon once, then lets it go", async () => {
    const scene = newScene();
    warmSkillFx(scene);
    const trail = scene.getMeshByName(SWING_TRAIL_NAME);
    expect(trail?.alwaysSelectAsActiveMesh).toBe(true);
    await scene.whenReadyAsync();
    expect(scene.getMeshByName(SWING_TRAIL_NAME)).toBeNull();
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

  it("separates the two fire projectiles by more than colour, since bloom can be off", () => {
    const bolt = SKILL_FX["skill.ember_bolt.v1"]!;
    const spark = SKILL_FX["skill.ember_spark.v1"]!;
    // A player with bloom off sees size and density, not glow.
    expect(spark.sizeStart).toBeLessThan(bolt.sizeStart);
    expect(spark.emitRate).toBeLessThan(bolt.emitRate);
    expect(spark.trailWidth).toBeLessThan(bolt.trailWidth);
    expect(spark.burstRadius).toBeLessThan(bolt.burstRadius);
  });
});
