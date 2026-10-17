import {
  Color3,
  Color4,
  DynamicTexture,
  MeshBuilder,
  ParticleSystem,
  Light,
  PointLight,
  Quaternion,
  StandardMaterial,
  Texture,
  TrailMesh,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { Mesh } from "@babylonjs/core";
import type { AbstractMesh, Scene } from "@babylonjs/core";
import { hitSpray } from "./hit-spray";
import { hitSparkle } from "./hit-sparkle";
import { fxPools } from "./fx-pool";
import { swingArcs, swingStyle } from "./swing-arc";

/**
 * Fire FX for the three starter skills. Kept out of `meshes.ts` because almost
 * none of this is geometry: the mesh is usually only the anchor.
 *
 * Look source: reference-screenshots/inside-map-battle.webp (PoE2). What makes
 * that frame read as expensive is that no effect is ONE thing — a hit is a
 * flipbook flame, a light on the floor and a spray of sparks arriving together;
 * how big it was is the struck body's own spray (`hit-spray.ts`). A single soft dot sprite, however well tuned, reads as a
 * placeholder. Everything here is additive, so intensity is the only knob and
 * one loud moment beats six quiet ones (docs/09-reward-psychology.md).
 */

/** 4x4 flipbook, 256px cells, one ember burning out over the 16 frames. */
const FIRE_SHEET = "/textures/fx/fire_sheet_v1.webp";
const CELL = 256;
const LAST_CELL = 15;
/** Glowing crack network for the cinder patch. Tiles, so it is scaled up rather
 *  than stretched across whatever radius the disc happens to have. */
const EMBER_CRACKS = "/textures/fx/ember_cracks_v1.webp";
/** Soft round blob, shared with the ambient haze. Arcane wisps want no shape of
 *  their own: the colour gradient is the whole effect. */
const WISP = "/textures/fx/haze.webp";
/** The same blob as RGBA, white with the blob as alpha, for normally blended smoke. */
const SMOKE_PUFF = "/textures/fx/smoke_puff.webp";

/**
 * The sheet is already orange, so the colour gradient is an ALPHA envelope and
 * nothing else: gradients multiply the texture, and a second fire ramp on top
 * of a fire texture only ever eats the white core.
 *
 * Colour gradients also override color1/color2/colorDead entirely, and a
 * particle starts AT its first stop, so the whole envelope has to live here.
 */
function fireColors(ps: ParticleSystem): void {
  ps.addColorGradient(0, new Color4(1, 1, 1, 0));
  ps.addColorGradient(0.12, new Color4(1, 1, 1, 1));
  ps.addColorGradient(0.75, new Color4(1, 0.94, 0.86, 0.9));
  ps.addColorGradient(1, new Color4(1, 0.7, 0.5, 0));
}

/**
 * Size gradients set the size ABSOLUTELY: the moment one exists, minSize and
 * maxSize stop being read at all and every particle is born the same size. The
 * per-particle variation has to come from the scale range instead, which is a
 * multiplier on top. Everything below relies on that pairing.
 */
function sizeOverLife(ps: ParticleSystem, from: number, to: number, spread = 0.45): void {
  ps.addSizeGradient(0, from);
  ps.addSizeGradient(1, to);
  ps.minScaleX = ps.minScaleY = 1 - spread;
  ps.maxScaleX = ps.maxScaleY = 1 + spread;
}

function fireSystem(scene: Scene, name: string, capacity: number): ParticleSystem {
  const ps = new ParticleSystem(name, capacity, scene);
  ps.particleTexture = new Texture(FIRE_SHEET, scene);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.applyFog = true; // distance has to cost brightness, same as the haze

  // Play the whole sheet across each particle's own lifetime. That is what
  // `spriteCellChangeSpeed = 0` means here, and it is the point of the sheet:
  // the flame is born, licks, breaks up and dies in step with its own fade,
  // which no amount of tuning on a static blob can imitate.
  ps.isAnimationSheetEnabled = true;
  ps.spriteCellWidth = CELL;
  ps.spriteCellHeight = CELL;
  ps.startSpriteCellID = 0;
  ps.endSpriteCellID = LAST_CELL;
  ps.spriteCellChangeSpeed = 0;

  fireColors(ps);
  return ps;
}

/**
 * Cool, soft, unlit particles for the skills that are not elemental.
 *
 * Blink deals no damage and has no element, so it must not borrow the ember
 * palette: reusing one look across every skill is exactly what makes a kit read
 * as placeholder. It also has to sit BELOW the damaging skills in brightness,
 * or the utility button is the loudest thing on screen.
 */
function wispSystem(scene: Scene, name: string, capacity: number): ParticleSystem {
  const ps = new ParticleSystem(name, capacity, scene);
  ps.particleTexture = new Texture(WISP, scene);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.applyFog = true;
  ps.addColorGradient(0, new Color4(0.5, 0.45, 1, 0));
  ps.addColorGradient(0.2, new Color4(0.55, 0.6, 1, 0.7));
  ps.addColorGradient(1, new Color4(0.28, 0.2, 0.65, 0));
  return ps;
}

/** A one-shot system: emits its whole count on the first frame, then deletes
 *  itself once the last particle has died. Never call `start()` twice on one. */
function burst(ps: ParticleSystem, count: number, maxLife: number): ParticleSystem {
  ps.manualEmitCount = count;
  ps.targetStopDuration = maxLife + 0.05;
  ps.disposeOnStop = true;
  ps.start();
  return ps;
}

/** Additive, unlit material for the one-shot geometry (streaks, ribbons). */
function glowMaterial(scene: Scene, name: string, color: Color3): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.emissiveColor = color;
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  m.disableLighting = true;
  m.alphaMode = 1; // ALPHA_ADD
  m.backFaceCulling = false;
  return m;
}

/**
 * Fade a mesh out over `seconds` while thinning it, WITHOUT moving either end.
 *
 * A uniform scale is right for a ring and wrong for
 * anything pinned between two points: a streak scaled to 0.15 pulls both of its
 * ends in toward its own centre, so the smear that was supposed to join where he
 * left to where he arrived visibly lets go of both while you watch. Here only the
 * radius moves, so the trail dissipates in place.
 */
function thinOut(
  scene: Scene, mesh: Mesh, seconds: number, alpha: number, from: number, to: number,
): void {
  const mat = mesh.material as StandardMaterial;
  // Set before the first tick, not inside it: a material born at alpha 1 is opaque
  // for however many frames pass before the observable first fires, and one
  // full-brightness frame of a five-unit additive bar is the flash being avoided.
  mat.alpha = alpha;
  mesh.scaling.set(from, 1, from);
  let t = 0;
  const tick = scene.onBeforeRenderObservable.add(() => {
    t += scene.getEngine().getDeltaTime() / 1000;
    const k = Math.min(1, t / seconds);
    const r = from + (to - from) * k;
    mesh.scaling.set(r, 1, r);
    mat.alpha = alpha * (1 - k) * (1 - k);
    if (k >= 1) {
      scene.onBeforeRenderObservable.remove(tick);
      mesh.dispose();
      mat.dispose();
    }
  });
}

export const FLASH_NAME = "fx-flash";
/** Bright enough to be seen against a 420-intensity torch, short enough not to
 *  be mistaken for a second lamp in the room. */
const FLASH_INTENSITY = 380;
/** Units it reaches: the ground around the hit, not the whole 19-unit view.
 *  Only honoured under glTF falloff; PBR's default falloff ignores range. */
const FLASH_RANGE = 4;
/** Hung over the hit at brazier height (`BRAZIER_FLAME_Y`), never at bolt height:
 *  PBR falls off with distance squared, and a light on the struck hide whites it out. */
const FLASH_Y = 1.8;
const FLASH_DECAY = 4.5; // per second, multiplicative

/**
 * ONE shared light for every impact, moved to wherever the last one happened.
 *
 * Not one per hit: StandardMaterial takes 4 lights and the scene already runs
 * three (fill, sun, torch), so a second simultaneous flash would silently push
 * the floor's shader over its budget and drop a real light for a frame. Reusing
 * one instance means two hits in the same tick share a flash, which is a far
 * cheaper lie than the torch blinking out.
 */
function flash(scene: Scene, at: Vector3, level = 1): void {
  let light = scene.getLightByName(FLASH_NAME) as PointLight | null;
  if (!light) {
    light = new PointLight(FLASH_NAME, at.clone(), scene);
    light.diffuse = new Color3(1, 0.62, 0.26);
    light.specular = Color3.Black();
    light.range = FLASH_RANGE;
    light.falloffType = Light.FALLOFF_GLTF;
    light.shadowEnabled = false;
    scene.onBeforeRenderObservable.add(() => {
      const l = light!;
      if (l.intensity <= 0.5) {
        l.intensity = 0;
        return;
      }
      l.intensity *= Math.max(0, 1 - (FLASH_DECAY * scene.getEngine().getDeltaTime()) / 1000);
    });
  }
  // Never dimmed by a smaller hit in the same moment: the bigger one owns the light.
  const want = FLASH_INTENSITY * Math.min(1, Math.max(0, level));
  if (want < light.intensity) return;
  light.position.set(at.x, FLASH_Y, at.z);
  light.intensity = want;
}

/**
 * What one skill looks and sounds like. Colour is never the only difference:
 * bloom is a graphics setting, so size, rate and speed have to carry it too.
 */
export interface FxProfile {
  core: Color3;
  wake: Color3;
  trailWidth: number;
  emitRate: number;
  sizeStart: number;
  sizeEnd: number;
  lifeMin: number;
  lifeMax: number;
  /** Impact light, 0..1 of FLASH_INTENSITY: a starter's chip must not light the room. */
  flash: number;
  flightCue: string | null;
  impactCue: string | null;
  /** Played when a player projectile appears: the loose, for a bow. */
  launchCue?: string;
  /** Drawn as an arrow with a bare streak and a melee-style hit, not a burning bolt. */
  arrow?: boolean;
  /** Arrow wake length in the arrow's frame, and its peak alpha. */
  streakLength?: number;
  streakAlpha?: number;
  /** Tracer motes an arrow sheds per unit flown. */
  motes?: number;
  /** How an arrow lands: a chip back off the face, a spray out the far side, or a few splinters. */
  arrowImpact?: "chip" | "pierce" | "splinter";
}

/** What a monster's bolt and any unmapped skill draw: today's ember bolt. */
export const FALLBACK_FX: FxProfile = {
  core: new Color3(1, 0.55, 0.2),
  wake: new Color3(1, 0.55, 0.2),
  trailWidth: 0.08,
  emitRate: 80,
  sizeStart: 0.5,
  sizeEnd: 0.1,
  lifeMin: 0.05,
  lifeMax: 0.1,
  flash: 0.5,
  flightCue: "skill-ember-bolt-flight",
  impactCue: "skill-ember-bolt-impact",
};

/** The bow's base: an arrow, no flight bed, a melee-style hit. */
const ARROW_FX: FxProfile = {
  ...FALLBACK_FX,
  arrow: true,
  launchCue: "skill-bow-release",
  impactCue: "skill-arrow-impact",
  flightCue: null,
  emitRate: 0,
};

export const SKILL_FX: Record<string, FxProfile> = {
  // The real cast: a white-hot core dragging a deep orange wake, heavy and slow.
  "skill.ember_bolt.v1": {
    ...FALLBACK_FX,
    core: new Color3(1, 0.92, 0.75),
    wake: new Color3(1, 0.45, 0.12),
    trailWidth: 0.11,
    emitRate: 110,
    sizeStart: 0.6,
    sizeEnd: 0.12,
    flash: 0.6,
  },
  // The free fallback, and it must read as one: a small pale mote, thin and dry.
  "skill.ember_spark.v1": {
    ...FALLBACK_FX,
    core: new Color3(1, 0.85, 0.45),
    wake: new Color3(0.95, 0.7, 0.25),
    trailWidth: 0.05,
    emitRate: 45,
    sizeStart: 0.28,
    sizeEnd: 0.06,
    lifeMin: 0.03,
    lifeMax: 0.07,
    flash: 0.3,
    // The fire bed is Ember Bolt's: a free mote carrying it would sound like the big spell.
    flightCue: null,
    impactCue: "skill-ember-spark-impact",
  },
  // Snap Shot: a quick pale dust streak and a chip off the face. The plain arrow.
  "skill.snap_shot.v1": {
    ...ARROW_FX,
    core: new Color3(0.85, 0.82, 0.72),
    wake: new Color3(0.6, 0.58, 0.52),
    trailWidth: 0.04,
    streakLength: 1.1,
    streakAlpha: 0.3,
    flash: 0.3,
    arrowImpact: "chip",
  },
  // Piercing Shot: a long white-blue tracer shedding motes, and a hit that sprays
  // out of the far side of the body because the arrow went through it.
  "skill.piercing_shot.v1": {
    ...ARROW_FX,
    launchCue: "skill-piercing-shot-release",
    impactCue: "skill-piercing-shot-impact",
    core: new Color3(0.9, 0.97, 1),
    wake: new Color3(0.7, 0.88, 1),
    trailWidth: 0.075,
    streakLength: 2.8,
    streakAlpha: 0.55,
    motes: 2,
    flash: 0.45,
    arrowImpact: "pierce",
  },
  // Split Arrow: a fan of short amber shards, each landing as a few splinters.
  "skill.split_arrow.v1": {
    ...ARROW_FX,
    launchCue: "skill-split-arrow-release",
    impactCue: "skill-split-arrow-impact",
    core: new Color3(1, 0.85, 0.55),
    wake: new Color3(1, 0.68, 0.3),
    trailWidth: 0.05,
    streakLength: 0.75,
    streakAlpha: 0.42,
    flash: 0.25,
    arrowImpact: "splinter",
  },
  "skill.strike.v1": FALLBACK_FX,
  "skill.heavy_strike.v1": FALLBACK_FX,
  "skill.ground_slam.v1": FALLBACK_FX,
  "skill.cinder_ground.v1": {
    ...FALLBACK_FX,
    core: new Color3(1, 0.42, 0.1),
    wake: new Color3(0.7, 0.2, 0.05),
    flash: 0.8,
  },
  "skill.blink.v1": FALLBACK_FX,
  "skill.town_portal.v1": FALLBACK_FX,
};

export function fxProfile(skillId: string | undefined): FxProfile {
  return (skillId === undefined ? undefined : SKILL_FX[skillId]) ?? FALLBACK_FX;
}

export const BOLT_TRAIL_NAME = "fx-bolt-trail";

/**
 * Ember bolt: the tail. The head stays a mesh (`meshes.ts` shrank it to a
 * white-hot pip) because the sim's projectile is a real position and the
 * GlowLayer needs something emissive to bloom.
 *
 * The emitter is the mesh but the particles are NOT parented to it: they are
 * spawned at wherever it was that frame and then left behind in world space,
 * which is what makes the tail a tail instead of a fur coat that flies along.
 */
export function attachBoltTrail(scene: Scene, mesh: AbstractMesh, fx: FxProfile = FALLBACK_FX): ParticleSystem {
  const ps = fireSystem(scene, BOLT_TRAIL_NAME, 140);
  ps.emitter = mesh;
  ps.minEmitBox = new Vector3(-0.04, -0.04, -0.04);
  ps.maxEmitBox = new Vector3(0.04, 0.04, 0.04);

  // Far bigger than a spark would suggest. The flame occupies barely half of
  // its 256px cell and the rest is black, so the quad has to be oversized
  // before the fire is anything but a few pixels: at 0.6 the whole tail came
  // out as a dotted red line behind a white ball.
  sizeOverLife(ps, fx.sizeStart, fx.sizeEnd);
  ps.minLifeTime = fx.lifeMin;
  ps.maxLifeTime = fx.lifeMax;
  ps.emitRate = fx.emitRate;

  // Sideways and slightly up, then gravity takes them down. Sparks that fall out
  // of the flight path are what sells it as burning matter and not a light.
  ps.direction1 = new Vector3(-0.3, -0.05, -0.3);
  ps.direction2 = new Vector3(0.3, 0.25, 0.3);
  ps.minEmitPower = 0.1;
  ps.maxEmitPower = 0.5;
  ps.gravity = new Vector3(0, -2.0, 0);
  ps.start();

  // The ribbon. Particles alone cannot draw a continuous streak — they are
  // discrete, so a fast bolt always breaks its own tail into a dotted line —
  // and a streak is the single thing that separates a fireball from a comet
  // sprite in the reference frame.
  const ribbon = new TrailMesh(`${BOLT_TRAIL_NAME}-ribbon`, mesh, scene, fx.trailWidth, 10, true);
  ribbon.material = glowMaterial(scene, `${BOLT_TRAIL_NAME}-ribbon-mat`, fx.wake);
  ribbon.material.alpha = 0.4;
  ribbon.isPickable = false;

  // The bolt mesh is disposed the tick the sim kills the projectile, i.e. on
  // impact, so its dispose IS the impact event.
  //
  // Nothing to clean up here: Babylon disposes every particle system whose
  // emitter is the mesh as part of `mesh.dispose()`, which also means the tail
  // is CUT at impact rather than left to fall. The burst goes off in the same
  // place on the same frame and covers it.
  mesh.onDisposeObservable.addOnce(() => {
    emberBurst(scene, mesh.getAbsolutePosition().clone(), fx);
    // The trail is NOT auto-disposed with its generator, and one left standing
    // keeps trying to sample a mesh that no longer exists.
    //
    // stop() BEFORE dispose(), and it is not a nicety: TrailMesh registers its
    // own onBeforeRenderObservable observer in start() and has no dispose()
    // override of its own (Babylon 9.20.0), so disposing it leaves that observer
    // running update() over the vertex buffers of a mesh that is gone — one dead
    // loop per frame, per bolt, for the rest of the session.
    ribbon.stop();
    ribbon.material?.dispose();
    ribbon.dispose();
  });
  return ps;
}

export const ARROW_NAME = "fx-arrow";

/**
 * A touch longer than a real arrow: at the game camera a 0.7 shaft is a few
 * pixels, and the arrow is the one thing the player watches leave the bow. At
 * 0.9 it read as a spear.
 */
export const ARROW_LENGTH = 0.75;
/** The loosed arrow against the nocked one: at full bow size it read as a javelin in flight. */
export const PROJECTILE_ARROW_SCALE = 0.6;

function arrowMaterial(scene: Scene, part: string, colour: Color3, glow: number): StandardMaterial {
  const name = `${ARROW_NAME}-${part}-mat`;
  const cached = scene.getMaterialByName(name) as StandardMaterial | null;
  if (cached) return cached;
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = colour;
  m.specularColor = new Color3(0.1, 0.1, 0.1);
  // A dark dungeon floor swallows an unlit brown stick; a little self-light keeps
  // the silhouette without making it a glowing bolt.
  m.emissiveColor = colour.scale(glow);
  return m;
}

/** Shaft, steel head and three fletching fins, pointing down +z like every mover. */
export function buildArrow(scene: Scene, name: string): Mesh {
  const shaft = MeshBuilder.CreateCylinder(`${name}-shaft`, { height: ARROW_LENGTH, diameter: 0.025, tessellation: 6 }, scene);
  shaft.rotation.x = Math.PI / 2;
  shaft.material = arrowMaterial(scene, "shaft", new Color3(0.5, 0.33, 0.17), 0.2);
  const head = MeshBuilder.CreateCylinder(`${name}-head`, { height: 0.125, diameterTop: 0, diameterBottom: 0.067, tessellation: 4 }, scene);
  head.rotation.x = Math.PI / 2;
  head.position.z = ARROW_LENGTH / 2 + 0.0625;
  head.material = arrowMaterial(scene, "head", new Color3(0.62, 0.64, 0.7), 0.2);
  const parts: Mesh[] = [shaft, head];
  for (let i = 0; i < 3; i++) {
    const a = (i * 2 * Math.PI) / 3;
    const fin = MeshBuilder.CreateBox(`${name}-fin${i}`, { width: 0.005, height: 0.05, depth: 0.14 }, scene);
    fin.position.set(Math.sin(a) * 0.03, Math.cos(a) * 0.03, -ARROW_LENGTH / 2 + 0.09);
    fin.rotation.z = -a;
    fin.material = arrowMaterial(scene, "fletch", new Color3(0.86, 0.8, 0.7), 0.15);
    parts.push(fin);
  }
  const arrow = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
  arrow.name = name;
  // The merge makes a fresh MultiMaterial per call and mesh.dispose() leaves it
  // behind; the parts are always in this order, so one shared instance fits all.
  const merged = `${ARROW_NAME}-merged-mat`;
  // getMaterialByName does not search multiMaterials.
  const shared = scene.multiMaterials.find((m) => m.name === merged);
  if (shared) {
    arrow.material?.dispose(false, false);
    arrow.material = shared;
  } else if (arrow.material) {
    arrow.material.name = merged;
  }
  arrow.isPickable = false;
  return arrow;
}

/** Behind the fletching, fading to a point. Fixed, unlike a TrailMesh, whose
 *  length is a frame count: 4 units at 27 fps, a stub at 144. */
const STREAK_LENGTH = 1.3;

/**
 * An arrow's wake: a faint additive cone riding behind the shaft, so it is the
 * same streak at any frame rate and never comes adrift of the arrow. A hit
 * (`metadata.struck`, set by the renderer on the spent tick) lands the melee hit
 * through the body; an arrow that ran out of range just drops.
 */
export function attachArrowStreak(scene: Scene, mesh: Mesh, fx: FxProfile): Mesh {
  const full = fx.streakLength ?? STREAK_LENGTH;
  const streak = MeshBuilder.CreateCylinder(`${ARROW_NAME}-streak`, {
    height: full, diameterTop: fx.trailWidth, diameterBottom: 0, tessellation: 8,
  }, scene);
  streak.rotation.x = Math.PI / 2;
  streak.position.z = -ARROW_LENGTH / 2 - full / 2 + 0.1;
  streak.parent = mesh;
  streak.isPickable = false;
  streak.metadata = { full };
  const name = `${ARROW_NAME}-streak-mat-${fx.wake.toHexString()}`;
  let mat = scene.getMaterialByName(name) as StandardMaterial | null;
  if (!mat) {
    // Half the wake colour: the GlowLayer blooms emissive, and at full it
    // outshone the arrow it trails.
    mat = glowMaterial(scene, name, fx.wake.scale(0.5));
    mat.alpha = fx.streakAlpha ?? 0.3;
    mat.alphaMode = 1; // ALPHA_ADD
  }
  streak.material = mat;
  const motes = fx.motes ?? 0;
  let shed = 0;
  let last: Vector3 | null = null;
  const tick = motes > 0
    ? scene.onBeforeRenderObservable.add(() => {
      const now = mesh.getAbsolutePosition();
      if (last) {
        shed += motes * Math.min(3, Vector3.Distance(last, now));
        for (; shed >= 1; shed--) {
          const k = Math.random();
          fxPools(scene).shards.emit({
            x: last.x + (now.x - last.x) * k, y: last.y + (now.y - last.y) * k, z: last.z + (now.z - last.z) * k,
            vx: rand(-0.3, 0.3), vy: rand(0, 0.4), vz: rand(-0.3, 0.3), drag: 2,
            life: rand(0.15, 0.35), size: 0.05, thick: 0.015,
            r: fx.core.r, g: fx.core.g, b: fx.core.b, a: 0.8, r1: fx.wake.r * 0.5, g1: fx.wake.g * 0.5, b1: fx.wake.b * 0.6,
          });
        }
      }
      last = now.clone();
    })
    : null;
  mesh.onDisposeObservable.addOnce(() => {
    if (tick) scene.onBeforeRenderObservable.remove(tick);
    if ((mesh.metadata as { struck?: boolean } | null)?.struck) {
      const yaw = mesh.rotation.y;
      arrowImpact(scene, mesh.getAbsolutePosition().clone(), Math.sin(yaw), Math.cos(yaw), fx);
    }
  });
  return streak;
}

/** Splinters a Split Arrow throws, and the spray Piercing Shot drives out of the far side. */
const SPLINTERS = 4;
const PIERCE_SPRAY = 14;
const PIERCE_SPEED = 8;

/** An arrow landing, in its skill's own way; `dirX/dirZ` is the way it was flying. */
function arrowImpact(scene: Scene, at: Vector3, dirX: number, dirZ: number, fx: FxProfile): void {
  if (fx.arrowImpact === "pierce") {
    flash(scene, at, fx.flash);
    const base = Math.atan2(dirX, dirZ);
    for (let i = 0; i < PIERCE_SPRAY; i++) {
      const yaw = base + rand(-0.35, 0.35);
      const speed = PIERCE_SPEED * rand(0.6, 1.3);
      fxPools(scene).shards.emit({
        x: at.x, y: at.y, z: at.z,
        vx: Math.sin(yaw) * speed, vy: rand(-0.5, 1.5), vz: Math.cos(yaw) * speed,
        gravity: -6, drag: 2, life: rand(0.12, 0.28), size: 0.2, thick: 0.018, stretch: 0.03,
        r: fx.core.r, g: fx.core.g, b: fx.core.b, a: 1, r1: fx.wake.r * 0.4, g1: fx.wake.g * 0.5, b1: fx.wake.b * 0.7,
      });
    }
    fxPools(scene).glow.emit({ x: at.x, y: at.y, z: at.z, life: 0.08, size: 0.15, sizeEnd: 0.4, r: 0.85, g: 0.95, b: 1, a: 0.7 });
    return;
  }
  if (fx.arrowImpact === "splinter") {
    flash(scene, at, fx.flash);
    for (let i = 0; i < SPLINTERS; i++) {
      const yaw = Math.atan2(-dirX, -dirZ) + rand(-1.2, 1.2);
      const speed = rand(2, 4);
      fxPools(scene).shards.emit({
        x: at.x, y: at.y, z: at.z, vx: Math.sin(yaw) * speed, vy: rand(1, 3), vz: Math.cos(yaw) * speed,
        gravity: -12, life: rand(0.15, 0.3), size: 0.1, thick: 0.02,
        r: fx.core.r, g: fx.core.g, b: fx.core.b, a: 1, r1: 0.6, g1: 0.3, b1: 0.1,
      });
    }
    return;
  }
  meleeImpact(scene, at, dirX, dirZ, fx.flash);
}

/** Cut the wake to `flown` units: a fresh arrow's full wake pokes out behind the archer's back. */
export function setStreakLength(arrow: Mesh, flown: number): void {
  const streak = arrow.getChildMeshes(true).find((m) => m.name === `${ARROW_NAME}-streak`);
  if (!streak) return;
  const full = (streak.metadata as { full?: number } | null)?.full ?? STREAK_LENGTH;
  // `flown` is world units; the streak lives in the arrow's scaled frame.
  const length = Math.max(0.001, Math.min(full, flown / (arrow.scaling.z || 1)));
  streak.scaling.y = length / full;
  streak.position.z = -ARROW_LENGTH / 2 - length / 2 + 0.1;
}

export const BOLT_BURST_NAME = "fx-bolt-burst";

/** Impact: flame thrown outward and a flash of light on the floor, on the same frame. */
export function emberBurst(scene: Scene, at: Vector3, fx: FxProfile = FALLBACK_FX): ParticleSystem {
  flash(scene, at, fx.flash);

  const ps = fireSystem(scene, BOLT_BURST_NAME, 40);
  ps.emitter = at;
  ps.createSphereEmitter(0.1, 1);
  sizeOverLife(ps, 0.9, 0.18);
  ps.minLifeTime = 0.15;
  ps.maxLifeTime = 0.4;
  ps.minEmitPower = 2;
  ps.maxEmitPower = 5;
  ps.gravity = new Vector3(0, -7, 0);
  blast(scene, at);
  smoke(scene, at);
  return burst(ps, 32, 0.4);
}

/** How one melee skill's blow lands on a body. Every count is per landed hit. */
export interface MeleeImpactStyle {
  sparks: number;
  sparkSpeed: number;
  sparkLength: number;
  sparkColour: Color3;
  /** Swelling core at the contact, diameter 0 for none. */
  core: number;
  dust: number;
}

/** Strike: a small bright chip, a few fast white sparks. */
export const STRIKE_IMPACT: MeleeImpactStyle = {
  sparks: 7, sparkSpeed: 7, sparkLength: 0.16, sparkColour: new Color3(1, 0.92, 0.75), core: 0, dust: 1,
};
/** Heavy Strike: a crunch, a hot core and a thick fan of heavy sparks. */
export const HEAVY_STRIKE_IMPACT: MeleeImpactStyle = {
  sparks: 16, sparkSpeed: 6, sparkLength: 0.26, sparkColour: new Color3(1, 0.72, 0.35), core: 0.55, dust: 3,
};
/** Ground Slam on a body: the floor's shockwave carries the size, so the hit stays mid. */
export const GROUND_SLAM_IMPACT: MeleeImpactStyle = {
  sparks: 10, sparkSpeed: 5, sparkLength: 0.22, sparkColour: new Color3(1, 0.6, 0.28), core: 0.35, dust: 4,
};
const MELEE_IMPACT: Record<string, MeleeImpactStyle> = {
  "skill.strike.v1": STRIKE_IMPACT,
  "skill.heavy_strike.v1": HEAVY_STRIKE_IMPACT,
  "skill.ground_slam.v1": GROUND_SLAM_IMPACT,
};

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** Warm floor dust, alpha-blended so it veils rather than glows. */
function dustPuff(scene: Scene, x: number, z: number, size: number, delay = 0, drift = 0.8): void {
  const a = Math.random() * Math.PI * 2;
  fxPools(scene).smoke.emit({
    x: x + Math.cos(a) * 0.15, y: 0.12, z: z + Math.sin(a) * 0.15,
    vx: Math.cos(a) * drift, vy: 0.35, vz: Math.sin(a) * drift, drag: 2.5,
    life: rand(0.45, 0.8), delay, size: size * 0.5, sizeEnd: size * 1.5,
    r: 0.46, g: 0.4, b: 0.32, a: 0.32, r1: 0.36, g1: 0.33, b1: 0.3,
  });
}

/**
 * A weapon landing on a body: sparks thrown off the contact AWAY from the
 * swinger, dust kicked off the floor under it and the shared flash at
 * `flashLevel`. Every piece comes from the scene's pools; nothing is built.
 */
export function meleeImpact(
  scene: Scene, at: Vector3, awayX: number, awayZ: number, flashLevel = 1, skillId?: string,
): void {
  flash(scene, at, flashLevel);
  const style = (skillId === undefined ? undefined : MELEE_IMPACT[skillId]) ?? STRIKE_IMPACT;
  const pools = fxPools(scene);
  const len = Math.hypot(awayX, awayZ) || 1;
  const base = Math.atan2(awayX / len, awayZ / len);
  const c = style.sparkColour;
  for (let i = 0; i < style.sparks; i++) {
    // A fan out of the far side of the body and up: the blow carries through it.
    const yaw = base + ((i + Math.random()) / style.sparks * 2 - 1) * 0.9;
    const speed = style.sparkSpeed * rand(0.6, 1.3);
    pools.shards.emit({
      x: at.x, y: at.y, z: at.z,
      vx: Math.sin(yaw) * speed, vy: speed * rand(0.15, 0.6), vz: Math.cos(yaw) * speed,
      gravity: -12, drag: 1.5, life: rand(0.12, 0.3),
      size: style.sparkLength, thick: 0.02, stretch: 0.03,
      r: c.r, g: c.g, b: c.b, a: 1, r1: 1, g1: 0.35, b1: 0.1,
    });
  }
  if (style.core > 0) {
    pools.glow.emit({
      x: at.x, y: at.y, z: at.z, life: 0.12, size: style.core * 0.4, sizeEnd: style.core,
      r: 1, g: 0.9, b: 0.7, a: 0.7, r1: 1, g1: 0.5, b1: 0.2,
    });
  }
  for (let i = 0; i < style.dust; i++) dustPuff(scene, at.x, at.z, 0.7);
}

/** Ground Slam's reach (skills.ts `reachFixed` 3.5) and how fast its wave runs out to it. */
export const SLAM_REACH = 3.5;
export const SLAM_WAVE_SPEED = 12;
/** Half-angle of the cone the dust runs along, wider than the 70° hit cone so it reads. */
const SLAM_CONE = 0.75;
const SLAM_DUST_ROWS = 5;
const SLAM_DUST_PER_ROW = 3;
const SLAM_GRIT = 22;
const SLAM_RING_COLOUR = new Color3(1, 0.72, 0.4);

/**
 * Ground Slam landing: a ring of light racing out across the floor from the
 * weapon, dust bursting up row by row along the cone as the wave reaches it,
 * and grit thrown off the crater.
 */
export function groundSlam(scene: Scene, at: Vector3, facingX: number, facingZ: number): void {
  const pools = fxPools(scene);
  const len = Math.hypot(facingX, facingZ) || 1;
  const fx = facingX / len, fz = facingZ / len;
  const ringLife = SLAM_REACH / SLAM_WAVE_SPEED * 1.6;
  for (const [k, delay] of [[1, 0], [0.7, 0.06]] as const) {
    pools.ring.emit({
      x: at.x, y: 0.06, z: at.z, life: ringLife, delay,
      size: 0.4, sizeEnd: SLAM_REACH * 2 * k,
      r: SLAM_RING_COLOUR.r, g: SLAM_RING_COLOUR.g, b: SLAM_RING_COLOUR.b, a: 0.9 * k, r1: 0.6, g1: 0.25, b1: 0.08,
    });
  }
  pools.glow.emit({ x: at.x, y: 0.15, z: at.z, life: 0.18, size: 0.5, sizeEnd: 1.4, r: 1, g: 0.75, b: 0.45, a: 0.55 });
  for (let row = 1; row <= SLAM_DUST_ROWS; row++) {
    const d = (row / SLAM_DUST_ROWS) * SLAM_REACH;
    for (let i = 0; i < SLAM_DUST_PER_ROW; i++) {
      const yaw = Math.atan2(fx, fz) + ((i + 0.5) / SLAM_DUST_PER_ROW * 2 - 1) * SLAM_CONE;
      dustPuff(scene, at.x + Math.sin(yaw) * d, at.z + Math.cos(yaw) * d, 0.8 + 0.25 * row, d / SLAM_WAVE_SPEED, 1.2);
    }
  }
  for (let i = 0; i < SLAM_GRIT; i++) {
    const yaw = Math.atan2(fx, fz) + rand(-1, 1) * SLAM_CONE * 1.4;
    const speed = rand(2, 6);
    pools.shards.emit({
      x: at.x, y: 0.1, z: at.z,
      vx: Math.sin(yaw) * speed, vy: rand(3, 7), vz: Math.cos(yaw) * speed,
      gravity: -16, life: rand(0.35, 0.6), size: 0.07, thick: 0.05,
      r: 1, g: 0.6, b: 0.3, a: 0.8, r1: 0.35, g1: 0.18, b1: 0.08,
    });
  }
  hitSpray(scene).emit(new Vector3(at.x, 0.2, at.z), fx, fz, 1, "grit");
}

/**
 * The swing's crescent for the fast part of a strike, in the skill's own style.
 * The caller moves it each frame; `dispose` only lets go, the arc fades on its own.
 */
export function swingTrail(scene: Scene, skillId?: string): { follow(at: Vector3, centre?: Vector3): void; dispose(): void } {
  const swing = swingArcs(scene).begin(swingStyle(skillId));
  let done = false;
  return {
    follow(at: Vector3, centre?: Vector3): void {
      if (!done) swing.follow(at, centre);
    },
    dispose(): void {
      done = true;
    },
  };
}

export const BOLT_BLAST_NAME = "fx-bolt-blast";

/** The fireball: a handful of big flames swelling out of the hit point. Small on
 *  purpose, this is the starter skill; the sparks carry the spray. */
function blast(scene: Scene, at: Vector3): ParticleSystem {
  const ps = fireSystem(scene, BOLT_BLAST_NAME, 8);
  ps.emitter = at.clone();
  ps.createSphereEmitter(0.15, 1);
  sizeOverLife(ps, 0.55, 1.35, 0.25);
  ps.minLifeTime = 0.22;
  ps.maxLifeTime = 0.38;
  ps.minEmitPower = 0.4;
  ps.maxEmitPower = 1.1;
  ps.gravity = new Vector3(0, 1.5, 0);
  ps.minInitialRotation = 0;
  ps.maxInitialRotation = Math.PI * 2;
  return burst(ps, 6, 0.38);
}

export const BOLT_SMOKE_NAME = "fx-bolt-smoke";

/** Warm grey smoke that swells and climbs off the hit after the fire is gone:
 *  the fire says "now", the smoke says "something burned here". */
function smoke(scene: Scene, at: Vector3): ParticleSystem {
  const ps = new ParticleSystem(BOLT_SMOKE_NAME, 6, scene);
  ps.particleTexture = new Texture(SMOKE_PUFF, scene);
  ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  ps.applyFog = true;
  ps.emitter = at.clone();
  ps.createSphereEmitter(0.25, 1);
  ps.addColorGradient(0, new Color4(0.5, 0.45, 0.4, 0));
  ps.addColorGradient(0.15, new Color4(0.45, 0.41, 0.36, 0.22));
  ps.addColorGradient(1, new Color4(0.36, 0.34, 0.32, 0));
  sizeOverLife(ps, 0.45, 1.2, 0.3);
  ps.minLifeTime = 0.5;
  ps.maxLifeTime = 0.9;
  ps.minEmitPower = 0.3;
  ps.maxEmitPower = 0.9;
  ps.gravity = new Vector3(0, 0.6, 0);
  ps.minInitialRotation = 0;
  ps.maxInitialRotation = Math.PI * 2;
  ps.minAngularSpeed = -0.6;
  ps.maxAngularSpeed = 0.6;
  return burst(ps, 5, 0.9);
}

export const CINDER_NAME = "fx-cinder";

/** Embers a second off a burning patch at rest. */
export const CINDER_RATE = 52;

/**
 * Cinder ground: embers rising off the whole disc.
 *
 * The emitter is the disc mesh, so the cylinder emitter below is authored at
 * radius 1 and comes out at the entity's real radius — the renderer scales the
 * mesh x/z and Babylon pushes emitted positions through that world matrix.
 */
export function attachCinderFX(scene: Scene, mesh: AbstractMesh): ParticleSystem {
  const ps = fireSystem(scene, CINDER_NAME, 220);
  ps.emitter = mesh;
  ps.createCylinderEmitter(1, 0.05, 1, 0);

  sizeOverLife(ps, 0.78, 0.12);
  // Long enough to climb clear of the disc and be seen against the dark.
  ps.minLifeTime = 0.5;
  ps.maxLifeTime = 1.1;
  // Additive overlap goes as rate x lifetime, so a patch this wide saturates to
  // a flat white disc long before it looks dense. Fewer, smaller, shorter
  // flames read as separate tongues, which is what fire on the floor looks like.
  ps.emitRate = CINDER_RATE;
  ps.direction1 = new Vector3(-0.25, 1, -0.25);
  ps.direction2 = new Vector3(0.25, 1, 0.25);
  ps.minEmitPower = 0.5;
  ps.maxEmitPower = 1.9;
  // Up, not down: these are cinders carried by the heat of the patch they sit
  // on. Falling embers would read as debris landing from something overhead.
  ps.gravity = new Vector3(0, 0.5, 0);
  ps.minAngularSpeed = -2;
  ps.maxAngularSpeed = 2;
  ps.start();
  // Disposed with the disc by Babylon, since the disc is its emitter.
  return ps;
}

/**
 * Dress the cinder disc's material: a crack network that crawls and pulses,
 * masked by a radial falloff.
 *
 * The crawl is the whole point. A patch of fire that holds still is a decal no
 * matter how good the texture is, and it is the cheapest possible way to buy
 * motion: two UV offsets moving at different speeds read as burning.
 *
 * Shared material, so this is registered ONCE, when `meshes.ts` first builds it.
 */
export function cinderGlow(scene: Scene, mat: StandardMaterial): void {
  const cracks = new Texture(EMBER_CRACKS, scene);
  cracks.uScale = cracks.vScale = 2.2; // tile, so the crack size stops depending on the radius
  mat.emissiveTexture = cracks;
  // Ember-tinted, NOT white. The disc is additive under a glow layer, so a
  // white emissive clips all three channels together in the middle and the
  // patch reads as a hole in the floor. Holding green and blue down means the
  // brightest part of the fire is still orange.
  mat.emissiveColor = new Color3(1, 0.5, 0.18);
  const falloff = cinderFalloff(scene);
  if (falloff) mat.opacityTexture = falloff;

  let t = 0;
  scene.onBeforeRenderObservable.add(() => {
    t += scene.getEngine().getDeltaTime() / 1000;
    cracks.vOffset = t * 0.045;
    cracks.uOffset = Math.sin(t * 0.35) * 0.05;
    // Breathing, not blinking: two beats a second at a tenth of the range is
    // enough for the eye to call it alive.
    const pulse = 0.9 + 0.1 * Math.sin(t * 4.2);
    mat.emissiveColor.set(pulse, pulse * 0.5, pulse * 0.18);
  });
}

/** Radial falloff for the cinder disc, so the patch bleeds off at its edge
 *  instead of ending on the hard rim a flat translucent cylinder draws. Cached
 *  on the scene by name, the same way the loot beam's gradient is. */
export const CINDER_FALLOFF_NAME = "cinder-falloff";

export function cinderFalloff(scene: Scene): DynamicTexture | null {
  const existing = scene.getTextureByName(CINDER_FALLOFF_NAME);
  if (existing) return existing as DynamicTexture;
  // Null under NullEngine: painting one needs a real 2D canvas, which node has
  // no OffscreenCanvas for and jsdom hands back without a context. Same reason
  // props.ts falls back to primitives — the headless tests still have to run.
  try {
    const size = 128;
    const tex = new DynamicTexture(CINDER_FALLOFF_NAME, { width: size, height: size }, scene, false);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D | null;
    if (!ctx) {
      tex.dispose();
      return null;
    }
    const r = size / 2;
    const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
    // Hot centre, most of the radius spent dimming, nothing at all at the rim.
    grad.addColorStop(0, "#fff");
    grad.addColorStop(0.45, "#b4b4b4");
    grad.addColorStop(0.85, "#2a2a2a");
    grad.addColorStop(1, "#000");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    tex.update();
    tex.getAlphaFromRGB = true;
    return tex;
  } catch {
    return null;
  }
}

export const BLINK_NAME = "fx-blink";
export const BLINK_STREAK_NAME = "fx-blink-streak";

/**
 * Peak alpha of the streak. Additive over a lit floor, five units long and wider
 * than the character: anything near opaque washes the room out and reads brighter
 * than the fire skills that actually hurt. Exported so the test can hold it.
 */
export const BLINK_ALPHA = 0.48;

/**
 * Blink: a streak along the path travelled, a collapsing puff where the
 * character left and an expanding one where it arrived.
 *
 * The streak is what makes it a teleport with a direction rather than two
 * unrelated puffs: the eye needs something connecting the ends or the arrival
 * reads as a rubber-band desync.
 *
 * The implosion is the same sphere emitter run at NEGATIVE power: direction is
 * the surface normal, so a negative multiplier walks every particle inward.
 */
/**
 * Fire the whole impact vocabulary once, dark, behind the loading plate.
 *
 * The first REAL hit used to pay three one-off compiles on the main thread —
 * the particle shader (fire sheet + fog variant), the spray's droplet materials, and
 * worst the FLASH light's arrival, which recompiles every material in the scene
 * for a fourth light — and that is the stutter on the first Ember Bolt of a
 * fresh map. Every burst here self-disposes, and the flash is zeroed AFTER
 * emberBurst raised it, so the warm-up draws nothing the player can see.
 */
export const FX_KEEPALIVE_NAME = "fx-keepalive";

export function warmSkillFx(scene: Scene): void {
  // Never started, never drawn: they hold the particle effect and the sheet, which
  // Babylon frees with the last system using them and every next cast re-linked.
  if (!scene.particleSystems.some((p) => p.name === FX_KEEPALIVE_NAME)) {
    for (const ps of [fireSystem(scene, FX_KEEPALIVE_NAME, 1), wispSystem(scene, FX_KEEPALIVE_NAME, 1)]) ps.isReady();
  }
  emberBurst(scene, Vector3.Zero());
  meleeImpact(scene, Vector3.Zero(), 1, 0);
  hitSpray(scene);
  hitSparkle(scene);
  // Pools and arcs are drawn from birth (alwaysSelectAsActiveMesh, empty slots
  // at zero scale), so standing them up here compiles them behind the plate.
  fxPools(scene);
  swingArcs(scene);
  const light = scene.getLightByName(FLASH_NAME) as PointLight | null;
  if (light) light.intensity = 0;
}

export function blinkBurst(scene: Scene, from: Vector3, to: Vector3): void {
  const delta = to.subtract(from);
  const len = delta.length();
  if (len > 0.01) {
    // Tapered, not a bar: local +Y is turned onto the travel direction below, so
    // the wide end sits where the character left and the thin end where it
    // arrived, which is what makes the smear point somewhere. A constant
    // diameter at full brightness is a laser beam, not a teleport.
    const streak = MeshBuilder.CreateCylinder(
      BLINK_STREAK_NAME,
      { height: len, diameterBottom: 0.52, diameterTop: 0.1, tessellation: 12 },
      scene,
    );
    streak.position.copyFrom(from.add(to).scale(0.5));
    // A cylinder is authored along +Y, so turn that axis onto the travel
    // direction: one rotation about their common perpendicular.
    const dir = delta.scale(1 / len);
    const axis = Vector3.Cross(Vector3.Up(), dir);
    if (axis.lengthSquared() > 1e-6) {
      streak.rotationQuaternion = Quaternion.RotationAxis(axis.normalize(), Math.acos(Vector3.Dot(Vector3.Up(), dir)));
    }
    const mat = glowMaterial(scene, `${BLINK_STREAK_NAME}-mat`, new Color3(0.34, 0.3, 0.78));
    streak.material = mat;
    streak.isPickable = false;
    // Thins in place rather than shrinking: a uniform scale drags both ends to the
    // middle, and the streak's whole job is to still be touching them.
    //
    // BLINK_ALPHA, low: a near-opaque additive bar five units long clips to white
    // at peak and loses the violet that says which skill it was.
    thinOut(scene, streak, 0.35, BLINK_ALPHA, 1, 0.25);
  }
  // No impact flash. A teleport lands nothing, and the shared 900-intensity
  // white light lit the whole floor for a skill that does no damage.

  const out = wispSystem(scene, BLINK_NAME, 60);
  out.emitter = to;
  out.createSphereEmitter(0.3, 1);
  sizeOverLife(out, 1.1, 0.2);
  out.minLifeTime = 0.2;
  out.maxLifeTime = 0.5;
  out.minEmitPower = 2.5;
  out.maxEmitPower = 6;
  out.gravity = new Vector3(0, 0.6, 0);
  burst(out, 52, 0.5);

  const collapse = wispSystem(scene, BLINK_NAME, 48);
  collapse.emitter = from;
  collapse.createSphereEmitter(1.0, 1);
  sizeOverLife(collapse, 0.9, 0.2);
  collapse.minLifeTime = 0.18;
  collapse.maxLifeTime = 0.35;
  collapse.minEmitPower = -6;
  collapse.maxEmitPower = -3;
  collapse.gravity = Vector3.Zero();
  burst(collapse, 44, 0.35);
}
