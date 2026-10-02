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

/**
 * Fire FX for the three starter skills. Kept out of `meshes.ts` because almost
 * none of this is geometry: the mesh is usually only the anchor.
 *
 * Look source: reference-screenshots/inside-map-battle.webp (PoE2). What makes
 * that frame read as expensive is that no effect is ONE thing — a hit is a
 * flipbook flame, a shockwave ring, a light on the floor and a spray of sparks
 * arriving together. A single soft dot sprite, however well tuned, reads as a
 * placeholder. Everything here is additive, so intensity is the only knob and
 * one loud moment beats six quiet ones (docs/09-reward-psychology.md).
 */

/** 4x4 flipbook, 256px cells, one ember burning out over the 16 frames. */
const FIRE_SHEET = "/textures/fx/fire_sheet_v1.png";
const CELL = 256;
const LAST_CELL = 15;
/** Glowing crack network for the cinder patch. Tiles, so it is scaled up rather
 *  than stretched across whatever radius the disc happens to have. */
const EMBER_CRACKS = "/textures/fx/ember_cracks_v1.png";
/** Soft round blob, shared with the ambient haze. Arcane wisps want no shape of
 *  their own: the colour gradient is the whole effect. */
const WISP = "/textures/fx/haze.png";
/** The same blob as RGBA, white with the blob as alpha, for normally blended smoke. */
const SMOKE_PUFF = "/textures/fx/smoke_puff.png";

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

/** Additive, unlit material for the one-shot geometry (ring, streak). */
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
 * `playOnce` below scales uniformly, which is right for a ring and wrong for
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

/**
 * Drive a one-shot mesh: grow it and fade it out over `seconds`, then dispose
 * it and its material. Driven off the engine's delta time rather than a frame
 * count, so it lasts the same 0.25s at 60Hz and at 165Hz.
 */
function playOnce(scene: Scene, mesh: Mesh, seconds: number, from: number, to: number, alpha: number): void {
  const mat = mesh.material as StandardMaterial;
  let t = 0;
  const tick = scene.onBeforeRenderObservable.add(() => {
    t += scene.getEngine().getDeltaTime() / 1000;
    const k = Math.min(1, t / seconds);
    mesh.scaling.setAll(from + (to - from) * k);
    // Squared, so the ring is bright for the first third of its life and then
    // gets out of the way instead of dimming evenly across the whole thing.
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
function flash(scene: Scene, at: Vector3): void {
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
  light.position.set(at.x, FLASH_Y, at.z);
  light.intensity = FLASH_INTENSITY;
}

export const RING_NAME = "fx-shockwave";

/** Expanding ring on the floor. The one part of an impact that says how big the
 *  hit was, and the reason a burst of sparks alone always reads as small. */
function shockwave(scene: Scene, at: Vector3, to: number, color: Color3): void {
  const ring = MeshBuilder.CreateTorus(RING_NAME, { diameter: 1, thickness: 0.13, tessellation: 40 }, scene);
  ring.position.set(at.x, 0.09, at.z); // on the floor, not at the hit height
  ring.material = glowMaterial(scene, `${RING_NAME}-mat`, color);
  ring.isPickable = false;
  playOnce(scene, ring, 0.32, 0.35, to, 0.9);
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
  burstColour: Color3;
  burstRadius: number;
  flightCue: string | null;
  impactCue: string | null;
  /** Played when a player projectile appears: the loose, for a bow. */
  launchCue?: string;
  /** Drawn as an arrow with a bare streak and a melee-style hit, not a burning bolt. */
  arrow?: boolean;
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
  burstColour: new Color3(1, 0.55, 0.18),
  burstRadius: 2.2,
  flightCue: "skill-ember-bolt-flight",
  impactCue: "skill-ember-bolt-impact",
};

/** Snap Shot's arrow drawn harder: a longer, brighter streak and a bigger spray. */
const DRAWN_ARROW_FX: FxProfile = {
  ...FALLBACK_FX,
  arrow: true,
  launchCue: "skill-bow-release",
  impactCue: "skill-arrow-impact",
  core: new Color3(0.95, 0.92, 0.82),
  wake: new Color3(0.66, 0.63, 0.56),
  trailWidth: 0.06,
  emitRate: 40,
  sizeStart: 0.26,
  sizeEnd: 0.05,
  lifeMin: 0.04,
  lifeMax: 0.08,
  burstColour: new Color3(0.85, 0.82, 0.72),
  burstRadius: 1.3,
  flightCue: null,
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
    burstColour: new Color3(1, 0.5, 0.14),
    burstRadius: 2.6,
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
    burstColour: new Color3(1, 0.75, 0.3),
    burstRadius: 1.2,
  },
  // Not fire at all: an arrow, so the wake is dust off the shaft, not flame.
  "skill.snap_shot.v1": {
    ...FALLBACK_FX,
    arrow: true,
    launchCue: "skill-bow-release",
    impactCue: "skill-arrow-impact",
    core: new Color3(0.85, 0.82, 0.72),
    wake: new Color3(0.6, 0.58, 0.52),
    trailWidth: 0.04,
    emitRate: 25,
    sizeStart: 0.2,
    sizeEnd: 0.05,
    lifeMin: 0.03,
    lifeMax: 0.06,
    burstColour: new Color3(0.8, 0.78, 0.7),
    burstRadius: 0.9,
    flightCue: null,
  },
  "skill.piercing_shot.v1": DRAWN_ARROW_FX,
  "skill.split_arrow.v1": DRAWN_ARROW_FX,
  "skill.strike.v1": FALLBACK_FX,
  "skill.heavy_strike.v1": FALLBACK_FX,
  "skill.ground_slam.v1": FALLBACK_FX,
  "skill.cinder_ground.v1": {
    ...FALLBACK_FX,
    core: new Color3(1, 0.42, 0.1),
    wake: new Color3(0.7, 0.2, 0.05),
    burstColour: new Color3(1, 0.42, 0.1),
    burstRadius: 3.2,
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
  const streak = MeshBuilder.CreateCylinder(`${ARROW_NAME}-streak`, {
    height: STREAK_LENGTH, diameterTop: fx.trailWidth, diameterBottom: 0, tessellation: 8,
  }, scene);
  streak.rotation.x = Math.PI / 2;
  streak.position.z = -ARROW_LENGTH / 2 - STREAK_LENGTH / 2 + 0.1;
  streak.parent = mesh;
  streak.isPickable = false;
  const name = `${ARROW_NAME}-streak-mat-${fx.wake.toHexString()}`;
  let mat = scene.getMaterialByName(name) as StandardMaterial | null;
  if (!mat) {
    // Half the wake colour: the GlowLayer blooms emissive, and at full it
    // outshone the arrow it trails.
    mat = glowMaterial(scene, name, fx.wake.scale(0.5));
    mat.alpha = 0.3;
    mat.alphaMode = 1; // ALPHA_ADD
  }
  streak.material = mat;
  mesh.onDisposeObservable.addOnce(() => {
    if ((mesh.metadata as { struck?: boolean } | null)?.struck) {
      const yaw = mesh.rotation.y;
      meleeImpact(scene, mesh.getAbsolutePosition().clone(), Math.sin(yaw), Math.cos(yaw), fx.burstRadius, fx.burstColour);
    }
  });
  return streak;
}

/** Cut the wake to `flown` units: a fresh arrow's full wake pokes out behind the archer's back. */
export function setStreakLength(arrow: Mesh, flown: number): void {
  const streak = arrow.getChildMeshes(true).find((m) => m.name === `${ARROW_NAME}-streak`);
  if (!streak) return;
  // `flown` is world units; the streak lives in the arrow's scaled frame.
  const length = Math.max(0.001, Math.min(STREAK_LENGTH, flown / (arrow.scaling.z || 1)));
  streak.scaling.y = length / STREAK_LENGTH;
  streak.position.z = -ARROW_LENGTH / 2 - length / 2 + 0.1;
}

export const BOLT_BURST_NAME = "fx-bolt-burst";

/** Impact: flame thrown outward, a ring across the floor and a real flash of
 *  light on it, all on the same frame. */
export function emberBurst(scene: Scene, at: Vector3, fx: FxProfile = FALLBACK_FX): ParticleSystem {
  shockwave(scene, at, fx.burstRadius, fx.burstColour);
  flash(scene, at);

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

export const MELEE_SPARKS_NAME = "fx-melee-sparks";
export const MELEE_DUST_NAME = "fx-melee-dust";
/** Steel on hide, not fire: a pale warm ring, tighter than a bolt's. */
const MELEE_RING = new Color3(1, 0.86, 0.62);
const MELEE_RING_RADIUS = 1.5;

/**
 * A weapon landing on a body: sparks thrown off the contact AWAY from the
 * swinger, dust kicked off the floor under it, a tight ring and the shared flash.
 */
export function meleeImpact(
  scene: Scene, at: Vector3, awayX: number, awayZ: number, ringRadius = MELEE_RING_RADIUS, ringColour = MELEE_RING,
): void {
  shockwave(scene, at, ringRadius, ringColour);
  flash(scene, at);

  const len = Math.hypot(awayX, awayZ) || 1;
  const ax = awayX / len;
  const az = awayZ / len;
  const sparks = fireSystem(scene, MELEE_SPARKS_NAME, 24);
  sparks.emitter = at.clone();
  // A fan out of the far side of the body and up: the blow carries through it.
  sparks.createPointEmitter(
    new Vector3(ax - az * 0.9, 0.3, az + ax * 0.9),
    new Vector3(ax + az * 0.9, 1.1, az - ax * 0.9),
  );
  sizeOverLife(sparks, 0.3, 0.04, 0.5);
  sparks.minLifeTime = 0.12;
  sparks.maxLifeTime = 0.3;
  sparks.minEmitPower = 4;
  sparks.maxEmitPower = 8;
  sparks.gravity = new Vector3(0, -12, 0);
  burst(sparks, 20, 0.3);

  const dust = new ParticleSystem(MELEE_DUST_NAME, 8, scene);
  dust.particleTexture = new Texture(SMOKE_PUFF, scene);
  dust.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  dust.applyFog = true;
  dust.emitter = new Vector3(at.x, 0.12, at.z);
  dust.createSphereEmitter(0.35, 1);
  dust.addColorGradient(0, new Color4(0.46, 0.4, 0.32, 0));
  dust.addColorGradient(0.12, new Color4(0.44, 0.38, 0.3, 0.3));
  dust.addColorGradient(1, new Color4(0.38, 0.34, 0.3, 0));
  sizeOverLife(dust, 0.5, 1.4, 0.3);
  dust.minLifeTime = 0.35;
  dust.maxLifeTime = 0.7;
  dust.minEmitPower = 0.8;
  dust.maxEmitPower = 1.6;
  dust.gravity = new Vector3(0, 0.3, 0);
  dust.minInitialRotation = 0;
  dust.maxInitialRotation = Math.PI * 2;
  burst(dust, 6, 0.7);
}

export const SWING_TRAIL_NAME = "fx-swing-trail";
/** Pale steel, dimmer than a bolt's wake: the swing is the arm, not a spell. */
const SWING_TRAIL_COLOUR = new Color3(0.95, 0.9, 0.78);
const SWING_TRAIL_WIDTH = 0.09;
/** Frames of history (TrailMesh counts frames, not seconds). */
const SWING_TRAIL_FRAMES = 7;

/** A ribbon off the weapon tip for the fast part of a swing. The caller moves it. */
export function swingTrail(scene: Scene): { follow(at: Vector3): void; dispose(): void } {
  const node = new TransformNode(`${SWING_TRAIL_NAME}-tip`, scene);
  let ribbon: TrailMesh | null = null;
  return {
    follow(at: Vector3): void {
      node.position.copyFrom(at);
      if (ribbon) return;
      // Built on the first point, so its history starts at the tip, not the origin.
      ribbon = new TrailMesh(SWING_TRAIL_NAME, node, scene, SWING_TRAIL_WIDTH, SWING_TRAIL_FRAMES, true);
      ribbon.material = glowMaterial(scene, `${SWING_TRAIL_NAME}-mat`, SWING_TRAIL_COLOUR);
      ribbon.material.alpha = 0.45;
      ribbon.isPickable = false;
    },
    dispose(): void {
      ribbon?.material?.dispose();
      ribbon?.dispose();
      node.dispose();
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
  ps.emitRate = 52;
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
 * the particle shader (fire sheet + fog variant), the ring's glow material, and
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
    // BLINK_ALPHA and not the 0.85 this used to hand playOnce. The note beside the
    // old `mat.alpha = 0.3` was right about the wash and never took effect, because
    // playOnce overwrites the material's alpha on its first frame: what actually
    // shipped was a near-opaque additive bar five units long, and at peak it
    // clipped to white and lost the violet that says which skill it was.
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
