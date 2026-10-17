// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { Effect, Light, NullEngine, ParticleSystem, PointLight, Scene, StandardMaterial, Texture, Vector3 } from "@babylonjs/core";
import { SKILLS } from "@exiled/content-runtime";
import { makeMesh, warmEntityLooks, warmProjectiles, WARM_LOOK_PREFIX } from "./meshes";
import { GROUND_LOOK_BASES } from "./ground-looks";
import { GROUND_LOOKS } from "./ground-fx";
import { createScene } from "./engine";
import { SPRAY_NAME } from "./hit-spray";
import {
  blinkBurst,
  BLINK_NAME,
  BLINK_STREAK_NAME,
  BLINK_ALPHA,
  BOLT_TRAIL_NAME,
  emberBurst,
  CINDER_GLOW,
  CINDER_RATE,
  type GroundEmbers,
  FLASH_NAME,
  warmSkillFx,
  FX_KEEPALIVE_NAME,
  fxProfile,
  FALLBACK_FX,
  SKILL_FX,
  meleeImpact,
  groundSlam,
  swingTrail,
  ARROW_LENGTH,
  PROJECTILE_ARROW_SCALE,
} from "./skill-fx";
import { FX_SHARDS_NAME, fxPools, SMOKE_EDGE_PLUGIN } from "./fx-pool";
import { SWING_ARC_NAME, swingArcs, swingStyle } from "./swing-arc";

let engine: NullEngine | undefined;
afterEach(() => {
  engine?.dispose();
  engine = undefined;
});

function newScene(): Scene {
  engine = new NullEngine();
  return new Scene(engine);
}

/** Whether a shipped lossless WebP (VP8L) carries alpha: bit 28 of the header word after the 0x2f signature. */
function webpHasAlpha(url: string | null): boolean {
  if (url === null) throw new Error("texture has no url");
  const b = readFileSync(new URL(`../../public${url}`, import.meta.url));
  expect(b.toString("ascii", 12, 16), url).toBe("VP8L");
  return ((b.readUInt32LE(21) >>> 28) & 1) === 1;
}

function systems(scene: Scene, name: string): ParticleSystem[] {
  return scene.particleSystems.filter((p) => p.name === name) as ParticleSystem[];
}

describe("ember bolt", () => {
  it("sheds flame and embers from wherever the bolt flies, left behind in the world", () => {
    const scene = newScene();
    const mesh = makeMesh(scene, "projectile", "entity-7", Vector3.Zero(), undefined, "skill.ember_bolt.v1");
    const pools = fxPools(scene);
    for (let i = 1; i <= 8; i++) {
      mesh.position.set(i * 0.5, 0.8, 0);
      mesh.computeWorldMatrix(true);
      scene.onBeforeRenderObservable.notifyObservers(scene);
    }
    expect(pools.shards.emitted).toBeGreaterThan(0);
    expect(pools.glow.emitted).toBeGreaterThan(0);
    // Along the path it flew, not riding on the head.
    const xs = pools.glow.positions().map((p) => p.x);
    expect(Math.min(...xs)).toBeLessThan(3);
    expect(Math.max(...xs)).toBeLessThanOrEqual(4.01);
  });

  it("draws no fire with a particle system, a flipbook or a sprite sheet", () => {
    const scene = newScene();
    for (const id of ["skill.ember_bolt.v1", "skill.ember_spark.v1"]) {
      const mesh = makeMesh(scene, "projectile", `entity-${id}`, Vector3.Zero(), undefined, id);
      mesh.dispose();
    }
    makeMesh(scene, "groundArea", "entity-9");
    emberBurst(scene, Vector3.Zero());
    warmSkillFx(scene);
    for (const ps of scene.particleSystems as ParticleSystem[]) {
      expect(ps.isAnimationSheetEnabled, ps.name).toBe(false);
      expect((ps.particleTexture as Texture | null)?.url ?? "", ps.name).not.toContain("fire_sheet");
    }
    expect(scene.textures.some((t) => (t as Texture).url?.includes("fire_sheet"))).toBe(false);
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

  it("bursts where it died, because the sim disposing the mesh IS the impact", () => {
    const scene = newScene();
    const mesh = makeMesh(scene, "projectile", "entity-7");
    mesh.position.set(4, 0.8, -2);
    mesh.computeWorldMatrix(true);
    const pools = fxPools(scene);
    const before = pools.shards.emitted + pools.glow.emitted;
    mesh.dispose();
    expect(pools.shards.emitted + pools.glow.emitted).toBeGreaterThan(before);
    const near = pools.glow.positions().filter((p) => Math.hypot(p.x - 4, p.z + 2) < 0.5);
    expect(near.length).toBeGreaterThan(0);

    // No floor ring: how big a hit was is the struck body's spray, not a decal.
    expect(pools.ring.live).toBe(0);
    const light = scene.getLightByName(FLASH_NAME) as PointLight | null;
    expect(light).not.toBeNull();
    expect(light!.intensity).toBeGreaterThan(0);
    // Over the hit at lamp height, never at bolt height: PBR hides fall off with
    // the square of distance, and a light on the struck body's skin whites it out.
    expect(light!.position.x).toBeCloseTo(4);
    expect(light!.position.z).toBeCloseTo(-2);
    expect(light!.position.y).toBeGreaterThanOrEqual(1.5);
    expect(light!.falloffType).toBe(Light.FALLOFF_GLTF);
    expect(light!.range).toBeLessThanOrEqual(5);
  });

  it("stops shedding the moment it lands: no per-frame loop outlives the bolt", async () => {
    const scene = newScene();
    // The shared flash and pools stand once per scene; only per-bolt loops may not stay.
    warmSkillFx(scene);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const before = scene.onBeforeRenderObservable.observers.length;
    for (let i = 0; i < 4; i++) makeMesh(scene, "projectile", `entity-${i}`, Vector3.Zero(), undefined, "skill.ember_bolt.v1").dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scene.onBeforeRenderObservable.observers.length).toBe(before);
  });

  it("lands Ember Bolt as a fireball with smoke, and Ember Spark as a small dry pop", () => {
    const burstOf = (id: string) => {
      const scene = newScene();
      emberBurst(scene, new Vector3(4, 0.8, -2), SKILL_FX[id]);
      const p = fxPools(scene);
      const out = { shards: p.shards.emitted, glow: p.glow.emitted, smoke: p.smoke.emitted };
      engine?.dispose();
      return out;
    };
    const bolt = burstOf("skill.ember_bolt.v1");
    const spark = burstOf("skill.ember_spark.v1");
    expect(bolt.glow).toBeGreaterThan(spark.glow);
    expect(bolt.shards).toBeGreaterThan(spark.shards);
    expect(bolt.smoke).toBeGreaterThan(0);
    expect(spark.smoke).toBe(0);
    expect(SKILL_FX["skill.ember_bolt.v1"]!.blast!).toBeGreaterThan(SKILL_FX["skill.ember_spark.v1"]!.blast! * 2);
  });

  it("crackles Ember Spark sideways in flight, which Ember Bolt's heavy wake does not", () => {
    expect(SKILL_FX["skill.ember_spark.v1"]!.crackle!).toBeGreaterThan(0);
    expect(SKILL_FX["skill.ember_bolt.v1"]!.crackle ?? 0).toBe(0);
    expect(SKILL_FX["skill.ember_bolt.v1"]!.flames!).toBeGreaterThan(SKILL_FX["skill.ember_spark.v1"]!.flames ?? 0);
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
  const MELEE = ["skill.strike.v1", "skill.heavy_strike.v1", "skill.ground_slam.v1"];

  it("a landed blow throws pooled sparks and dust and lights the floor, with no ring", () => {
    const scene = newScene();
    meleeImpact(scene, new Vector3(1, 0.8, 0), 1, 0);
    const pools = fxPools(scene);
    expect(pools.shards.live).toBeGreaterThan(0);
    expect(pools.smoke.live).toBeGreaterThan(0);
    expect(pools.ring.live).toBe(0);
    expect(scene.particleSystems).toHaveLength(0);
    expect((scene.getLightByName(FLASH_NAME) as PointLight).intensity).toBeGreaterThan(0);
  });

  it("reuses its pools: twenty blows add no system, mesh or material", () => {
    const scene = newScene();
    meleeImpact(scene, new Vector3(1, 0.8, 0), 1, 0);
    const counts = () => [scene.particleSystems.length, scene.meshes.length, scene.materials.length, scene.textures.length];
    const before = counts();
    const emitted = fxPools(scene).shards.emitted;
    for (let i = 0; i < 20; i++) meleeImpact(scene, new Vector3(i, 0.8, 0), 1, 0, 1, MELEE[i % 3]);
    expect(counts()).toEqual(before);
    expect(fxPools(scene).shards.emitted).toBeGreaterThan(emitted);
  });

  it("lands a Heavy Strike harder than a Strike", () => {
    const thrown = (skillId: string) => {
      const scene = newScene();
      meleeImpact(scene, new Vector3(1, 0.8, 0), 1, 0, 1, skillId);
      const n = fxPools(scene).shards.emitted + fxPools(scene).glow.emitted;
      engine?.dispose();
      return n;
    };
    expect(thrown("skill.heavy_strike.v1")).toBeGreaterThan(thrown("skill.strike.v1"));
  });

  it("lights a chip dimmer than a heavy blow", () => {
    const scene = newScene();
    meleeImpact(scene, new Vector3(1, 0.8, 0), 1, 0, 0.35);
    const light = scene.getLightByName(FLASH_NAME) as PointLight;
    const chip = light.intensity;
    light.intensity = 0;
    meleeImpact(scene, new Vector3(1, 0.8, 0), 1, 0, 1);
    expect(chip).toBeLessThan(light.intensity * 0.5);
  });

  it("cuts each melee skill its own arc, widening and lingering with the weight", () => {
    const [strike, heavy, slam] = MELEE.map((id) => swingStyle(id));
    expect(strike!.width).toBeLessThan(heavy!.width);
    expect(heavy!.width).toBeLessThan(slam!.width);
    expect(strike!.seconds).toBeLessThan(heavy!.seconds);
    expect(strike!.colour.equals(heavy!.colour)).toBe(false);
    expect(heavy!.colour.equals(slam!.colour)).toBe(false);
  });

  it("draws the swing as a real crescent mesh from the tip in toward the chest", () => {
    const scene = newScene();
    const swing = swingTrail(scene, "skill.heavy_strike.v1");
    const centre = new Vector3(0, 1.1, 0);
    swing.follow(new Vector3(1.4, 1.2, 0), centre);
    swing.follow(new Vector3(0, 1.2, 1.4), centre);
    const lit = (m: { getVerticesData(k: string): ArrayLike<number> | null }) =>
      Array.from(m.getVerticesData("color") ?? []).some((v, i) => i % 4 === 3 && v > 0);
    const arc = scene.meshes.find((m) => m.name.startsWith(SWING_ARC_NAME) && lit(m))!;
    expect(arc).toBeDefined();
    const pos = arc.getVerticesData("position")!;
    let inward = 0;
    for (let i = 0; i < pos.length; i += 3) inward = Math.max(inward, 1.4 - Math.hypot(pos[i]!, pos[i + 2]!));
    // The inner side reaches toward the chest by about the style's width.
    expect(inward).toBeGreaterThan(swingStyle("skill.heavy_strike.v1").width * 0.6);
  });

  it("reuses its arc meshes and material across swings, and leaves no per-frame loop", async () => {
    const scene = newScene();
    const swing = () => {
      const trail = swingTrail(scene, "skill.strike.v1");
      trail.follow(new Vector3(0, 1, 0.5));
      trail.follow(new Vector3(0.5, 1, 0));
      trail.dispose();
    };
    swing();
    const counts = () => [scene.meshes.length, scene.materials.length, scene.transformNodes.length];
    const observers = scene.onBeforeRenderObservable.observers.length;
    const before = counts();
    for (let i = 0; i < 6; i++) swing();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(counts()).toEqual(before);
    expect(scene.onBeforeRenderObservable.observers.length).toBe(observers);
  });

  it("slams the floor: a shockwave ring, dust running out along the cone, and thrown grit", () => {
    const scene = newScene();
    groundSlam(scene, new Vector3(3, 0, 2), 0, 1);
    const pools = fxPools(scene);
    expect(pools.ring.live).toBeGreaterThan(0);
    expect(pools.smoke.live).toBeGreaterThan(3);
    // Dust lies ahead of him along the facing, out toward the slam's reach.
    const far = Math.max(...pools.smoke.positions().map((p) => p.z - 2));
    expect(far).toBeGreaterThan(2);
    expect(scene.particleSystems).toHaveLength(0);
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

  it("draws three different arrows: a quick streak, a long bright tracer, a fan of short shards", () => {
    const snap = SKILL_FX["skill.snap_shot.v1"]!;
    const pierce = SKILL_FX["skill.piercing_shot.v1"]!;
    const split = SKILL_FX["skill.split_arrow.v1"]!;
    expect(pierce.streakLength!).toBeGreaterThan(snap.streakLength! * 1.5);
    expect(split.streakLength!).toBeLessThan(snap.streakLength!);
    const wakes = [snap, pierce, split].map((f) => f.wake.toHexString());
    expect(new Set(wakes).size).toBe(3);
    expect(new Set([snap, pierce, split].map((f) => f.arrowImpact)).size).toBe(3);
  });

  it("a piercing shot sheds tracer motes in flight and lets go of them when it lands", async () => {
    const scene = newScene();
    const observers = () => scene.onBeforeRenderObservable.observers.length;
    fxPools(scene);
    const before = observers();
    const arrow = makeMesh(scene, "projectile", "entity-1", Vector3.Zero(), undefined, "skill.piercing_shot.v1");
    for (let i = 0; i < 10; i++) {
      arrow.position.z += 0.5;
      arrow.computeWorldMatrix(true);
      scene.onBeforeRenderObservable.notifyObservers(scene);
    }
    expect(fxPools(scene).shards.emitted).toBeGreaterThan(0);
    arrow.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(observers()).toBe(before);
  });

  it("a piercing shot punches through: its hit sprays forward, out the far side", () => {
    const scene = newScene();
    const arrow = makeMesh(scene, "projectile", "entity-1", new Vector3(0, 0.8, 0), undefined, "skill.piercing_shot.v1");
    arrow.rotation.y = 0; // flying down +z
    arrow.metadata = { struck: true };
    const pools = fxPools(scene);
    const start = pools.shards.emitted;
    arrow.dispose();
    expect(pools.shards.emitted).toBeGreaterThan(start);
    pools.shards.step(0.05);
    const zs = pools.shards.positions().map((p) => p.z);
    expect(zs.reduce((a, b) => a + b, 0) / zs.length).toBeGreaterThan(0.05);
  });

  it("a struck arrow lands a hit, one that ran out of range just drops", () => {
    const scene = newScene();
    const spent = makeMesh(scene, "projectile", "entity-1", Vector3.Zero(), undefined, "skill.snap_shot.v1");
    const lapsed = makeMesh(scene, "projectile", "entity-2", Vector3.Zero(), undefined, "skill.snap_shot.v1");
    lapsed.dispose();
    expect(fxPools(scene).shards.emitted).toBe(0);
    spent.metadata = { struck: true };
    spent.dispose();
    expect(fxPools(scene).shards.emitted).toBeGreaterThan(0);
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

    // The pools and the spray hosts are live, so their shaders compile behind
    // the loading plate instead of on the first hit.
    expect(scene.getMeshByName(FX_SHARDS_NAME)).not.toBeNull();
    expect(scene.getMeshByName(`${SPRAY_NAME}-blood`)).not.toBeNull();
    expect(scene.getMeshByName(`${SPRAY_NAME}-grit`)).not.toBeNull();
  });

  it("keeps a wisp system alive, so a blink never frees the shared shader and texture", () => {
    const scene = newScene();
    warmSkillFx(scene);
    warmSkillFx(scene);
    const keep = systems(scene, FX_KEEPALIVE_NAME);
    expect(keep).toHaveLength(1);
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
  it("stands the swing arcs and every fx pool up drawn, so the first swing compiles nothing", () => {
    const scene = newScene();
    warmSkillFx(scene);
    const arcs = scene.meshes.filter((m) => m.name.startsWith(SWING_ARC_NAME));
    expect(arcs.length).toBeGreaterThan(0);
    expect(arcs.every((m) => m.alwaysSelectAsActiveMesh)).toBe(true);
    for (const pool of Object.values(fxPools(scene))) expect(pool.mesh.alwaysSelectAsActiveMesh).toBe(true);
  });
});

describe("smoke pool edge", () => {
  it("fades smoke to nothing at its outline, so a puff has no hard rim, and leaves the additive pools alone", () => {
    const scene = newScene();
    const pools = fxPools(scene);
    const code = (m: { material: unknown }) =>
      (m.material as StandardMaterial).pluginManager?.getPlugin(SMOKE_EDGE_PLUGIN)?.getCustomCode("fragment") ?? null;
    const frag = code(pools.smoke.mesh)?.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR ?? "";
    expect(frag).toMatch(/color\.a \*= pow\(.*dot\(.*normalW.*viewDirectionW/);
    for (const pool of [pools.shards, pools.glow, pools.ring]) expect(code(pool.mesh)).toBeNull();
  });
});

describe("cinder ground", () => {
  type Embers = GroundEmbers & { step(dt: number): void; cracks: Float32Array };
  const embersOf = (mesh: { metadata: unknown }) => (mesh.metadata as { embers: Embers }).embers;

  it("throws embers only from its cracks, rising, at the patch's real radius", () => {
    const scene = newScene();
    const mesh = makeMesh(scene, "groundArea", "entity-9", new Vector3(5, 0.05, -3));
    mesh.scaling.set(2.5, 1, 2.5);
    mesh.computeWorldMatrix(true);
    const embers = embersOf(mesh);
    embers.step(1);
    const pools = fxPools(scene);
    const born = pools.shards.positions();
    expect(born.length).toBeGreaterThan(0);
    // Every ember sits on a crack segment (local, radius 1), give or take its first frame.
    const segs = embers.cracks;
    const onCrack = (p: Vector3) => {
      const x = (p.x - 5) / 2.5, z = (p.z + 3) / 2.5;
      for (let k = 0; k < segs.length; k += 4) {
        const ax = segs[k]!, az = segs[k + 1]!, bx = segs[k + 2]!, bz = segs[k + 3]!;
        const dx = bx - ax, dz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
        if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < 0.06) return true;
      }
      return false;
    };
    expect(born.every(onCrack)).toBe(true);
    const y0 = born.map((p) => p.y);
    pools.shards.step(0.2);
    const y1 = pools.shards.positions().map((p) => p.y);
    expect(y1.reduce((a, b) => a + b, 0) / y1.length).toBeGreaterThan(y0.reduce((a, b) => a + b, 0) / y0.length);
  });

  it("burns about half as loud as it did: glow, bloom gain and ember rate all cut", () => {
    const scene = newScene();
    const mesh = makeMesh(scene, "groundArea", "entity-9");
    const mat = mesh.material as StandardMaterial;
    expect(mat.alpha).toBeLessThanOrEqual(0.45);
    expect(CINDER_GLOW).toBeLessThanOrEqual(0.5);
    expect(mat.emissiveColor.r).toBeLessThanOrEqual(0.55);
    expect(GROUND_LOOKS.fire.gain).toBeLessThanOrEqual(1.5);
    expect(CINDER_RATE).toBeLessThanOrEqual(26);
  });

  it("lies on a dark scorch base, and keeps a readable rim at its true radius", () => {
    const scene = newScene();
    const mesh = makeMesh(scene, "groundArea", "entity-9");
    const scorch = mesh.getChildMeshes(true).find((m) => m.name.endsWith("-scorch"))!;
    expect(scorch).toBeDefined();
    const sm = scorch.material as StandardMaterial;
    // Normally blended, so it darkens the floor; additive could only lighten it.
    expect(sm.alphaMode).not.toBe(1);
    expect(sm.diffuseColor.r + sm.emissiveColor.r).toBeLessThan(0.15);
    expect(scorch.position.y).toBeLessThan(0);
    const rim = mesh.getChildMeshes(true).find((m) => m.name.endsWith("-rim"))!;
    expect(rim).toBeDefined();
    rim.computeWorldMatrix(true);
    const { minimum: min, maximum: max } = rim.getBoundingInfo().boundingBox;
    expect((max.x - min.x) / 2).toBeCloseTo(1, 1);
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
  });

  it("lights a starter's impact softer than the real cast's", () => {
    const bolt = SKILL_FX["skill.ember_bolt.v1"]!;
    const spark = SKILL_FX["skill.ember_spark.v1"]!;
    expect(spark.flash).toBeLessThan(bolt.flash);
    for (const fx of Object.values(SKILL_FX)) expect(fx.flash).toBeLessThanOrEqual(1);
  });
});
