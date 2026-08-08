import {
  Color3,
  Color4,
  DynamicTexture,
  MeshBuilder,
  ParticleSystem,
  PointLight,
  Quaternion,
  StandardMaterial,
  Texture,
  TrailMesh,
  Vector3,
} from "@babylonjs/core";
import type { AbstractMesh, Mesh, Scene } from "@babylonjs/core";

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
const FLASH_INTENSITY = 500;
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
    light.range = 14;
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
  light.position.copyFrom(at);
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
export function attachBoltTrail(scene: Scene, mesh: AbstractMesh): ParticleSystem {
  const ps = fireSystem(scene, BOLT_TRAIL_NAME, 140);
  ps.emitter = mesh;
  ps.minEmitBox = new Vector3(-0.04, -0.04, -0.04);
  ps.maxEmitBox = new Vector3(0.04, 0.04, 0.04);

  // Far bigger than a spark would suggest. The flame occupies barely half of
  // its 256px cell and the rest is black, so the quad has to be oversized
  // before the fire is anything but a few pixels: at 0.6 the whole tail came
  // out as a dotted red line behind a white ball.
  sizeOverLife(ps, 0.5, 0.1);
  ps.minLifeTime = 0.05;
  ps.maxLifeTime = 0.1;
  ps.emitRate = 80;

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
  const ribbon = new TrailMesh(`${BOLT_TRAIL_NAME}-ribbon`, mesh, scene, 0.08, 10, true);
  ribbon.material = glowMaterial(scene, `${BOLT_TRAIL_NAME}-ribbon-mat`, new Color3(1, 0.55, 0.2));
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
    emberBurst(scene, mesh.getAbsolutePosition().clone());
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

export const BOLT_BURST_NAME = "fx-bolt-burst";

/** Impact: flame thrown outward, a ring across the floor and a real flash of
 *  light on it, all on the same frame. */
export function emberBurst(scene: Scene, at: Vector3): ParticleSystem {
  shockwave(scene, at, 2.2, new Color3(1, 0.55, 0.18));
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
  return burst(ps, 32, 0.4);
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
