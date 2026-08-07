import {
  Color3,
  DynamicTexture,
  Effect,
  Mesh,
  MeshBuilder,
  ShaderMaterial,
  StandardMaterial,
  Texture,
  Vector3,
  VertexBuffer,
  type Scene,
} from "@babylonjs/core";
import { attachProp, type PropKind } from "./props";
import { attachCreature, type CreatureRig } from "./monsters";
import { attachBoltTrail, attachCinderFX, cinderGlow } from "./skill-fx";
import { attachRig, rigOf, type RigParts } from "./rig";
import { playSfx, worldSfxMix } from "../audio/sfx";

export type MeshKind = "player" | "monster" | "rare" | "boss" | "projectile" | "groundArea" | "telegraph" | "portal" | "mapDevice" | "stash" | "vendor" | "container" | "groundItem";

/**
 * Y-lift off the ground plane per kind (render only). The authored actors
 * (player/monster/rare) are built with their feet at local y=0, so they sit
 * flat on the floor with no lift.
 */
const Y_LIFT: Record<MeshKind, number> = {
  player: 0,
  monster: 0,
  rare: 0,
  boss: 0,
  // Chest height, not ankle height: a bolt that skims the floor reads as a ball
  // rolling, and its spark trail is cut in half by the ground plane.
  projectile: 0.8,
  groundArea: 0.05,
  telegraph: 0.06,
  // portal children self-position (inner disc at y=1.75 in local space); root sits on ground
  portal: 0,
  // map device cylinder base already starts at y=0 (children lift themselves)
  mapDevice: 0,
  stash: 0,
  vendor: 0,
  container: 0,
  // small floor-level beacon marker
  groundItem: 0.15,
};

export { Y_LIFT };

/**
 * Matte diffuse+emissive material, shared per key across every actor part.
 * With `texture`, the tiled skin drives both diffuse and emissive instead of
 * the flat colour, which stays as the headless fallback.
 */
function mat(
  scene: Scene,
  key: string,
  r: number,
  g: number,
  b: number,
  emiss = 0.22,
  texture?: string,
  tiles = 1,
): StandardMaterial {
  const name = `part-${key}`;
  const existing = scene.getMaterialByName(name);
  if (existing) return existing as StandardMaterial;
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = new Color3(r, g, b);
  m.emissiveColor = new Color3(r * emiss, g * emiss, b * emiss);
  m.specularColor = new Color3(0, 0, 0);
  if (texture) {
    try {
      // Texture load is async and non-fatal under NullEngine (no canvas), so
      // tests keep the flat colour set above.
      const skin = new Texture(texture, scene);
      skin.uScale = tiles;
      skin.vScale = tiles;
      m.diffuseTexture = skin;
      m.emissiveTexture = skin; // glow follows the bright pixels (lava, runes)
      m.diffuseColor = new Color3(1, 1, 1); // the texture carries the colour now
      m.emissiveColor = new Color3(emiss, emiss, emiss);
    } catch {
      /* keep the flat colour */
    }
  }
  return m;
}

/** Strongly self-lit material for fire / lava / eyes (glows regardless of scene light). */
function glow(scene: Scene, key: string, r: number, g: number, b: number): StandardMaterial {
  const name = `glow-${key}`;
  const existing = scene.getMaterialByName(name);
  if (existing) return existing as StandardMaterial;
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = new Color3(r, g, b);
  m.emissiveColor = new Color3(r, g, b);
  m.specularColor = new Color3(0, 0, 0);
  return m;
}

function attach(root: Mesh, part: Mesh, material: StandardMaterial): Mesh {
  part.parent = root;
  part.material = material;
  return part;
}

/**
 * What the walk cycle moves, stashed on the actor root at build time so the
 * render loop never has to look parts up by name.
 */
interface ActorParts {
  /** Limbs that swing back and forth, each with its own offset in the cycle. */
  limbs?: { mesh: Mesh; offset: number; amp: number }[];
  /** An authored creature: it runs clips instead, off its own skeleton. */
  creature?: CreatureRig;
  /** How far the body rises on each step. */
  bob: number;
  /** Rares only: the ground disc whose colour names their element. */
  auraMat?: StandardMaterial;
}

/** The authored creature on an actor root, if it has one. */
export function creatureOf(root: Mesh): CreatureRig | null {
  return (root.metadata as ActorParts | null)?.creature ?? null;
}

/**
 * Advance one actor's walk cycle. `phase` is driven by distance travelled, not
 * by wall time, so the legs always keep up with the feet and never skate.
 * Everything eases toward its target, which is what smooths the stop.
 */
export function animateActor(
  root: Mesh,
  phase: number,
  moving: boolean,
  speed = 0,
): void {
  // A skinned actor runs authored clips instead of a limb swing, and picks the
  // clip from its real ground speed rather than from the cycle phase.
  const rig = rigOf(root);
  if (rig) {
    rig.setLocomotion(speed);
    return;
  }

  const parts = root.metadata as ActorParts | null;
  // An authored creature is skinned too: its legs bend at the knee and its feet
  // plant, which no amount of swinging a rigid limb about one hip can do.
  if (parts?.creature) {
    parts.creature.setLocomotion(moving ? speed : 0);
    return;
  }
  // Not every mesh with metadata is an actor — telegraphs park their materials
  // there too, so check for limbs rather than for metadata.
  if (!parts?.limbs) return;
  for (const limb of parts.limbs) {
    const target = moving ? Math.sin(phase + limb.offset) * limb.amp : 0;
    limb.mesh.rotation.x += (target - limb.mesh.rotation.x) * 0.3;
  }
  // Two rises per stride (one per leg), and only ever upward off the floor.
  if (moving) root.position.y += Math.abs(Math.sin(phase)) * parts.bob;
}

/** Robed fire-mage: skirt + torso + hooded head, staff with a fire tip, offhand fireball. */
function buildCaster(scene: Scene, root: Mesh): void {
  const cloth = mat(scene, "robe", 0.13, 0.14, 0.17, 0.22, "/textures/robe_cloth.png");
  const teal = mat(scene, "trim", 0.08, 0.5, 0.45, 0.35);
  const skin = mat(scene, "skin", 0.72, 0.56, 0.43);
  const wood = mat(scene, "staff", 0.32, 0.22, 0.13);
  const fire = glow(scene, "fire", 1.0, 0.45, 0.1);

  const robe = MeshBuilder.CreateCylinder("robe", { diameterTop: 0.45, diameterBottom: 0.95, height: 1.15, tessellation: 14 }, scene);
  robe.position.y = 0.575;
  attach(root, robe, cloth);

  const sash = MeshBuilder.CreateTorus("sash", { diameter: 0.6, thickness: 0.1, tessellation: 14 }, scene);
  sash.position.y = 1.12;
  attach(root, sash, teal);

  const torso = MeshBuilder.CreateCylinder("torso", { diameterTop: 0.4, diameterBottom: 0.52, height: 0.55, tessellation: 12 }, scene);
  torso.position.y = 1.35;
  attach(root, torso, cloth);

  const head = MeshBuilder.CreateSphere("head", { diameter: 0.34, segments: 10 }, scene);
  head.position.y = 1.72;
  attach(root, head, skin);

  const hood = MeshBuilder.CreateCylinder("hood", { diameterTop: 0.06, diameterBottom: 0.46, height: 0.42, tessellation: 12 }, scene);
  hood.position.set(0, 1.78, -0.06);
  attach(root, hood, cloth);

  const limbs: ActorParts["limbs"] = [];
  for (const side of [-1, 1]) {
    const arm = MeshBuilder.CreateCapsule(`arm${side}`, { radius: 0.09, height: 0.7 }, scene);
    arm.position.set(side * 0.3, 1.25, 0);
    arm.rotation.z = side * 0.25;
    attach(root, arm, cloth);
    limbs.push({ mesh: arm, offset: side < 0 ? 0 : Math.PI, amp: 0.35 });
  }
  root.metadata = { limbs, bob: 0.05 } satisfies ActorParts;

  const staff = MeshBuilder.CreateCylinder("staff", { diameter: 0.06, height: 1.95, tessellation: 8 }, scene);
  staff.position.set(0.4, 0.98, 0.02);
  attach(root, staff, wood);
  const staffFire = MeshBuilder.CreateSphere("staffFire", { diameter: 0.24, segments: 10 }, scene);
  staffFire.position.set(0.4, 1.98, 0.02);
  attach(root, staffFire, fire);

  // Held out in front (+z): from a top-down camera this is the only bright
  // asymmetric bit, so it is what makes the caster's facing readable.
  const fireball = MeshBuilder.CreateSphere("fireball", { diameter: 0.24, segments: 10 }, scene);
  fireball.position.set(-0.22, 1.22, 0.38);
  attach(root, fireball, fire);
}

/** Quadruped cinder imp: humped body, horned head with glowing eyes, four legs, a tail. */
function buildImp(scene: Scene, root: Mesh, key: string, rock: [number, number, number], lava: number, eye: [number, number, number], texturePath?: string): void {
  const hide = mat(scene, `${key}-hide`, rock[0], rock[1], rock[2], lava, texturePath ?? `/textures/${key}_skin.png`, 2);
  const horn = mat(scene, `${key}-horn`, 0.09, 0.07, 0.07, 0.1);
  const eyes = glow(scene, `${key}-eye`, eye[0], eye[1], eye[2]);

  const body = MeshBuilder.CreateSphere("body", { diameter: 0.7, segments: 10 }, scene);
  body.scaling.set(1.1, 0.75, 1.35);
  body.position.y = 0.34;
  attach(root, body, hide);

  const head = MeshBuilder.CreateSphere("head", { diameter: 0.44, segments: 10 }, scene);
  head.position.set(0, 0.32, 0.52);
  attach(root, head, hide);

  for (const side of [-1, 1]) {
    const eyeMesh = MeshBuilder.CreateSphere(`eye${side}`, { diameter: 0.09, segments: 6 }, scene);
    eyeMesh.position.set(side * 0.1, 0.36, 0.72);
    attach(root, eyeMesh, eyes);

    const hornMesh = MeshBuilder.CreateCylinder(`horn${side}`, { diameterTop: 0, diameterBottom: 0.11, height: 0.26, tessellation: 8 }, scene);
    hornMesh.position.set(side * 0.13, 0.55, 0.42);
    hornMesh.rotation.set(-0.5, 0, side * 0.3);
    attach(root, hornMesh, horn);
  }

  const legPositions: [number, number][] = [[-0.22, 0.4], [0.22, 0.4], [-0.22, -0.28], [0.22, -0.28]];
  const limbs: ActorParts["limbs"] = [];
  legPositions.forEach(([x, z], i) => {
    const leg = MeshBuilder.CreateCylinder(`leg${i}`, { diameter: 0.13, height: 0.32, tessellation: 6 }, scene);
    leg.position.set(x, 0.16, z);
    attach(root, leg, hide);
    // Diagonal gait: front-left steps with back-right, as a real quadruped does.
    limbs.push({ mesh: leg, offset: i === 0 || i === 3 ? 0 : Math.PI, amp: 0.6 });
  });
  root.metadata = { limbs, bob: 0.045 } satisfies ActorParts;

  const tail = MeshBuilder.CreateCylinder("tail", { diameterTop: 0, diameterBottom: 0.14, height: 0.55, tessellation: 6 }, scene);
  tail.position.set(0, 0.36, -0.5);
  tail.rotation.x = 1.1;
  attach(root, tail, hide);
}

/**
 * A rare's elemental theme, as a lit disc under its feet.
 *
 * Every rare in this game converts its whole hit to one element and resists
 * that element, so the resistance a pack demands is fixed before it reaches
 * you — and until now nothing said which. It was the same orange imp whether it
 * was about to hit for fire or for chaos, which made the character sheet's four
 * resistances a guess. PoE rings its rares in the colour of what they do; this
 * is that, on the floor rather than in a shader, because a ground disc survives
 * an isometric camera and a body glow does not.
 *
 * The material is per-entity (keyed on the mesh name, not through the shared
 * `mat` cache) because two rares on screen must be able to disagree.
 */
function buildRareAura(scene: Scene, root: Mesh): void {
  const auraMat = new StandardMaterial(`${root.name}-aura`, scene);
  auraMat.diffuseColor = new Color3(0, 0, 0);
  auraMat.emissiveColor = new Color3(1, 0.55, 0.15).scale(AURA_EMISSIVE); // fire until told otherwise
  auraMat.specularColor = new Color3(0, 0, 0);
  auraMat.alpha = 0.85;
  auraMat.backFaceCulling = false;

  // A ring, not a filled disc: a disc that size washes the monster out from
  // above, and two of them overlapping blow straight to white. The torus is
  // already built flat in XZ, so no rotation is needed. Radii are in the root's
  // local space, which the rare scales by 1.7.
  const ring = MeshBuilder.CreateTorus("rare-aura", { diameter: 1.05, thickness: 0.09, tessellation: 24 }, scene);
  ring.position.y = 0.02; // just off the floor, or it z-fights the ground plane
  ring.parent = root;
  ring.material = auraMat;
  ring.isPickable = false;

  const parts = root.metadata as ActorParts | null;
  if (parts) root.metadata = { ...parts, auraMat } satisfies ActorParts;
}

/**
 * The scene runs a GlowLayer, and a ring emitting its colour at full strength
 * bloomed straight past its own hue: every element read as the same white band.
 * Held at 0.6 the bloom is still there and the colour survives it.
 */
const AURA_EMISSIVE = 0.6;

/** Element → aura colour. Matches the character sheet's resistance glyph tints. */
const ELEMENT_AURA: Record<string, [number, number, number]> = {
  fire: [1.0, 0.45, 0.12],
  cold: [0.56, 0.82, 0.94],
  lightning: [0.95, 0.84, 0.35],
  chaos: [0.79, 0.56, 0.87],
  physical: [0.72, 0.7, 0.66],
};

/** Tint a rare's aura to the element its whole hit converts to. */
export function updateRareElement(root: Mesh, element: string | undefined): void {
  const auraMat = (root.metadata as ActorParts | null)?.auraMat;
  if (!auraMat) return;
  const [r, g, b] = ELEMENT_AURA[element ?? "fire"] ?? ELEMENT_AURA["fire"]!;
  auraMat.emissiveColor.set(r * AURA_EMISSIVE, g * AURA_EMISSIVE, b * AURA_EMISSIVE);
}

/**
 * Whitewash a body for the moment it is struck. `t` runs 1 at the hit to 0 when
 * it is over; anything at or below 0 clears it.
 *
 * An overlay rather than a material change: monsters share cached materials by
 * species, so tinting one emissive would light up every imp on the screen. The
 * overlay is per mesh, costs no material, and survives a skinned mesh that has
 * its own shader — the two things that rule out every other way of doing this.
 *
 * Deliberately small (docs/09 rule 3: intensity beats density). A hit lands
 * several times a second all fight; anything that reads as a flash from across
 * the room becomes a strobe by the second pack.
 */
const HIT_TINT = new Color3(1, 0.93, 0.86);
const HIT_ALPHA = 0.3;

export function setHitFlash(root: Mesh, t: number): void {
  const on = t > 0;
  for (const m of [root, ...root.getChildMeshes(false)]) {
    if (!on) { m.renderOverlay = false; continue; }
    m.overlayColor = HIT_TINT;
    m.overlayAlpha = HIT_ALPHA * Math.min(1, t);
    m.renderOverlay = true;
  }
}

/**
 * Flat disc + bright rim ring for a boss telegraph.
 * Built at radius=1 so the renderer can scale it to any real radius.
 * Material refs stored in root.metadata so updateTelegraph can animate them
 * without re-allocating per frame.
 */
function buildTelegraph(scene: Scene, root: Mesh): void {
  // Per-entity materials (not cached by key) so multiple live telegraphs each
  // animate their own alpha/emissive independently.
  // Black diffuse on both: the danger zone must not be lit by the scene, or the
  // key light washes it into a pale spotlight. Emissive carries all the colour.
  const fillMat = new StandardMaterial(`${root.name}-tel-fill`, scene);
  fillMat.diffuseColor = new Color3(0, 0, 0);
  fillMat.emissiveColor = new Color3(0.55, 0.1, 0.02);
  fillMat.specularColor = new Color3(0, 0, 0);
  fillMat.alpha = 0.12;
  fillMat.backFaceCulling = false;

  const rimMat = new StandardMaterial(`${root.name}-tel-rim`, scene);
  rimMat.diffuseColor = new Color3(0, 0, 0);
  rimMat.emissiveColor = new Color3(1.0, 0.32, 0.06);
  rimMat.specularColor = new Color3(0, 0, 0);

  // diameter=2 → radius=1; renderer scales x/z to match entity.radius
  const fill = MeshBuilder.CreateCylinder("telegraph-fill", { diameter: 2, height: 0.02, tessellation: 32 }, scene);
  fill.parent = root;
  fill.material = fillMat;
  fill.receiveShadows = false;

  const rim = MeshBuilder.CreateTorus("telegraph-rim", { diameter: 2, thickness: 0.06, tessellation: 48 }, scene);
  rim.parent = root;
  rim.material = rimMat;
  rim.receiveShadows = false;

  root.metadata = { fill: fillMat, rim: rimMat };
}

/**
 * Animate a telegraph's fill as wind-up progresses.
 * progress 0 → dim deep-orange; progress 1 → bright near-white flash.
 * Mutates existing material properties — no allocations per call.
 */
export function updateTelegraph(root: Mesh, progress: number): void {
  const parts = root.metadata as
    | { fill: StandardMaterial; rim: StandardMaterial }
    | null;
  if (!parts?.fill) return;
  // The fill only ever deepens — it marks the ground, it must not light it.
  parts.fill.alpha = 0.12 + progress * 0.18;
  parts.fill.emissiveColor.set(0.55 + progress * 0.35, 0.1 + progress * 0.12, 0.02);
  // The rim carries the urgency, and only whitens in the last moment before
  // impact, so the flash reads as "now" instead of a slow fade to white.
  const flash = Math.max(0, (progress - 0.85) / 0.15);
  parts.rim.emissiveColor.set(1.0, 0.32 + flash * 0.6, 0.06 + flash * 0.7);
}

/**
 * The colour a tear in the world burns at.
 *
 * Cyan, not the blue-white it used to be. A white rim is a lamp in a frame; the
 * reference this is drawn from (`review/portal-ref.jpg`, a CC0 procedural portal
 * by Nicolai Prodromov) burns at the colour an arc does, and it is the one thing
 * that stops a glowing oval reading as decoration.
 */
const PORTAL_CYAN = new Color3(0.34, 0.93, 1.0);

/**
 * The portal, as the thing it is copied from actually is.
 *
 * The reference (`review/portal-ref.jpg`, Nicolai Prodromov's CC0 "procedural
 * portal" on BlenderKit) is not a model: inspected in Blender it is FOUR
 * VERTICES and a node shader. Its whole look — the ragged plasma rim, the
 * starred void, the branching filaments — is procedural texture on one quad,
 * which is why every attempt to rebuild it out of tori and merged tetrahedra
 * came back as rings and gravel. Its Cycles node graph cannot cross glTF, so
 * this is that graph re-said in GLSL: same parts, same layering, one quad.
 *
 * Layers, back to front, all in the fragment shader:
 *  - a void that goes to black at the centre and holds a faint blue at the rim;
 *  - a star field of specks that twinkle on their own phases;
 *  - thin filaments — ridges of a noise field — clinging inside the edge;
 *  - the rim: a white-hot core arc over a cyan body, wobbled around the ellipse
 *    by sines that share no period, crawling slowly so the tear is alive;
 *  - a plasma feather bleeding outward, flickering against the same noise.
 */
const PORTAL_SHADER = "ecPortal";

/** One look for the tear: arc colour, depth colour, and how it burns. */
export interface PortalStyle {
  /** Which DESIGN the shader draws: 0 vortex, 1 torn void, 2 storm ring,
   *  3 nebula window, 4 runic gate. Different geometry of light, not a hue. */
  variant: number;
  /** Colour of the rim, filaments and feather. */
  rim: [number, number, number];
  /** Colour of the glow inside the void. */
  deep: [number, number, number];
  /** How hard ridged noise bites notches out of the edge. 0 is a smooth oval. */
  jag: number;
  /** Width of the white-hot core line. */
  coreW: number;
  /** Width of the coloured band under it. */
  bodyW: number;
  /** How far the plasma feathers off the rim. */
  featherLen: number;
}

/**
 * The candidate looks, side by side. `PORTAL_STYLE` picks the shipped one; the
 * rest stay because they are data, not code, and re-auditioning them costs a
 * string.
 */
export const PORTAL_STYLES: Record<string, PortalStyle> = {
  /** A whirlpool: spiral arms twisting into a bright eye. The D2 read. */
  vortex: { variant: 0, rim: [0.18, 0.55, 1.0], deep: [0.03, 0.10, 0.34], jag: 0, coreW: 0.04, bodyW: 0.09, featherLen: 0.10 },
  /** The blenderkit reference: ragged rim, cracked starred dark. */
  torn: { variant: 1, rim: [0.12, 0.50, 1.0], deep: [0.01, 0.10, 0.36], jag: 0.5, coreW: 0.04, bodyW: 0.09, featherLen: 0.12 },
  /** A ring of discrete lightning arcs round a near-black hole. */
  storm: { variant: 2, rim: [0.45, 0.70, 1.0], deep: [0.02, 0.08, 0.28], jag: 0, coreW: 0.04, bodyW: 0.08, featherLen: 0.12 },
  /** Barely a rim; the hole is a window onto nebula clouds and stars. */
  nebula: { variant: 3, rim: [0.30, 0.45, 1.0], deep: [0.10, 0.08, 0.40], jag: 0, coreW: 0.035, bodyW: 0.07, featherLen: 0.08 },
  /** A built gate: counter-rotating dashed glyph rings over a still depth. */
  gate: { variant: 4, rim: [0.25, 0.60, 1.0], deep: [0.02, 0.06, 0.26], jag: 0, coreW: 0.03, bodyW: 0.06, featherLen: 0.08 },
};

/** The look the game ships with. His pick, 2026-07-31. */
export const PORTAL_STYLE = "nebula";

/** Write one style into a portal's material. Exposed so a probe can audition. */
export function setPortalStyle(mat: ShaderMaterial, s: PortalStyle): void {
  mat.setFloat("uVariant", s.variant);
  mat.setVector3("uRim", new Vector3(...s.rim));
  mat.setVector3("uDeep", new Vector3(...s.deep));
  mat.setFloat("uJag", s.jag);
  mat.setFloat("uCoreW", s.coreW);
  mat.setFloat("uBodyW", s.bodyW);
  mat.setFloat("uFeatherLen", s.featherLen);
}

function registerPortalShader(): void {
  if (Effect.ShadersStore[`${PORTAL_SHADER}VertexShader`]) return;
  Effect.ShadersStore[`${PORTAL_SHADER}VertexShader`] = `
    precision highp float;
    attribute vec3 position;
    attribute vec2 uv;
    uniform mat4 worldViewProjection;
    uniform mat4 world;
    uniform vec3 uCam;
    varying vec2 vUV;
    varying vec2 vPar;
    void main(void) {
      vUV = uv;
      vec4 wp = world * vec4(position, 1.0);
      // The view direction, expressed in the quad's own XY. Multiplying the
      // row vector by mat3(world) is R^T * v for a rotation, which is exactly
      // "into local space" — and it is what lets the fragment shader slide the
      // void's layers against each other as the camera moves. That parallax is
      // the whole difference between a hole and a sticker.
      vec3 vd = normalize(wp.xyz - uCam) * mat3(world);
      vPar = vd.xy;
      gl_Position = worldViewProjection * vec4(position, 1.0);
    }`;
  Effect.ShadersStore[`${PORTAL_SHADER}FragmentShader`] = `
    precision highp float;
    varying vec2 vUV;
    varying vec2 vPar;
    uniform float uTime;
    uniform float uHover;
    // The tear's look, as data: colour of the arc, colour of the deep glow,
    // how jagged the edge tears, how wide core and body burn, how far the
    // plasma feathers. One shader, every variant.
    uniform vec3 uRim;
    uniform vec3 uDeep;
    uniform float uJag;
    uniform float uCoreW;
    uniform float uBodyW;
    uniform float uFeatherLen;
    // Which DESIGN this portal is, not merely which palette: 0 vortex,
    // 1 torn void, 2 storm ring, 3 nebula window, 4 runic gate.
    uniform float uVariant;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
                 mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) {
      return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03) + 0.125 * vnoise(p * 4.11);
    }

    // Stars: one speck per grid cell, twinkling on the cell's own phase.
    float stars(vec2 q, float t) {
      vec2 cell = floor(q * 9.0);
      vec2 cuv = fract(q * 9.0) - 0.5;
      vec2 off = vec2(hash(cell), hash(cell + 19.7)) - 0.5;
      return exp(-dot(cuv - off * 0.6, cuv - off * 0.6) * 260.0)
           * step(hash(cell + 7.3), 0.55)
           * (0.5 + 0.5 * sin(t * (2.0 + 4.0 * hash(cell + 3.1)) + hash(cell) * 6.28));
    }

    void main(void) {
      // -1..1 across the quad; the quad itself is stretched to the ellipse, so
      // this space is circular and the maths never needs the aspect.
      vec2 p = vUV * 2.0 - 1.0;
      float ang = atan(p.y, p.x);
      float t = uTime;
      int v = int(uVariant + 0.5);
      float boost = 1.0 + 0.6 * uHover;

      // The void's layers slide against each other with the camera (vPar), each
      // at its own depth. A quad whose interior does not move is a sticker; one
      // whose stars sit deeper than its cracks is a hole.
      vec2 pMid = p + vPar * 0.10;
      vec2 pStar = p + vPar * 0.26;
      vec2 pGlow = p + vPar * 0.40;

      // ---- The edge. Each design draws a different KIND of boundary. ----
      // Calm by default: a portal's edge drifts, it does not jiggle. The two
      // base sines are a few percent of radius and crawl slowly.
      float wob = 0.014 * sin(ang * 3.0 + t * 0.4)
                + 0.010 * sin(ang * 7.0 - t * 0.55);
      if (v == 1) {
        // Torn: ridged noise bites notches inward, slowly.
        wob -= uJag * pow(fbm(vec2(ang * 3.0, 3.7 + t * 0.10)), 2.0) * 0.16;
      }
      if (v == 2) {
        // Storm: a finer live jitter, still gentle at the silhouette.
        wob += (fbm(vec2(ang * 8.0, t * 1.6)) - 0.5) * 0.05;
      }
      if (v == 4) wob = 0.0; // a built gate is machined, not torn
      float r = length(p) / (0.80 + wob);
      float inside = 1.0 - smoothstep(0.96, 1.02, r);
      float cling = exp(-max(1.0 - r, 0.0) / 0.22);
      float flick = 0.85 + 0.45 * fbm(vec2(ang * 2.2, t * 0.55));

      float core = exp(-pow((r - 1.0) / uCoreW, 2.0)) * flick;
      float body = exp(-pow((r - 1.0) / uBodyW, 2.0)) * flick;
      float feather = exp(-max(r - 1.0, 0.0) / uFeatherLen)
                    * step(r, 1.6) * (0.35 + 0.65 * fbm(vec2(ang * 3.1 + 7.0, t * 0.4)));

      vec3 col = vec3(0.0);
      float alpha = clamp(inside * 0.96 + body + feather * 0.7, 0.0, 1.0);

      if (v == 0) {
        // ---- Vortex: the void is a whirlpool. Spiral arms twist harder ----
        // toward the centre and pour over the lip, the D2 town-portal read.
        float tw = ang + (1.0 - r) * 5.5 - t * 1.4;
        float arm = fbm(vec2(tw * 1.6, r * 3.0 - t * 0.35));
        float spiral = pow(arm, 2.2) * inside;
        float eye = exp(-r * r * 6.0);
        col = uDeep * inside * (0.25 + 0.5 * cling)
            + uRim * spiral * 2.2
            + vec3(0.9, 0.97, 1.0) * eye * 1.4
            + uRim * body * 1.8 * boost
            + vec3(0.85, 0.99, 1.0) * core * 2.4 * boost
            + uRim * feather * 0.6 * boost;
      } else if (v == 2) {
        // ---- Storm ring: no soft band at all. The boundary is discrete ----
        // lightning segments racing round a nearly black hole.
        float b = fbm(vec2(ang * 6.0 + sin(t) * 0.5, t * 1.9));
        float seg = smoothstep(0.52, 0.62, b);
        float arc = seg * exp(-pow((r - 1.0) / 0.05, 2.0));
        float halo = seg * exp(-abs(r - 1.0) / 0.18) * 0.7;
        float sparkNear = stars(p * 1.6 + vec2(0.0, t * 0.4), t * 3.0)
                        * smoothstep(0.55, 0.95, r) * inside;
        col = uDeep * inside * 0.35 * cling
            + vec3(1.0) * arc * 3.4 * boost
            + uRim * halo * 1.6 * boost
            + vec3(0.9, 0.97, 1.0) * sparkNear * 2.0;
        alpha = clamp(inside * 0.97 + arc + halo * 0.6, 0.0, 1.0);
      } else if (v == 3) {
        // ---- Nebula window: barely any rim. The event is what you see ----
        // THROUGH the hole: parallax clouds lit from within, and stars.
        float n1 = fbm(pGlow * 2.2 + vec2(t * 0.04, -t * 0.03));
        float n2 = fbm(pMid * 3.6 + vec2(-t * 0.02, t * 0.05) + 11.0);
        vec3 cloud = uDeep * n1 * 1.6 + uRim * pow(n2, 2.4) * 1.5;
        float star = stars(pStar, t);
        col = cloud * inside
            + vec3(0.85, 0.95, 1.0) * star * 2.0 * inside
            + uRim * body * 0.9 * boost
            + vec3(0.9, 0.99, 1.0) * core * 1.2 * boost;
      } else if (v == 4) {
        // ---- Runic gate: a MADE thing. Two counter-rotating dashed ----
        // rings of glyph light frame a still black depth that ripples.
        float dash1 = step(0.45, fract(ang / 6.2832 * 18.0 + t * 0.06));
        float dash2 = step(0.40, fract(-ang / 6.2832 * 12.0 + t * 0.045));
        float ring1 = dash1 * exp(-pow((r - 0.97) / 0.035, 2.0));
        float ring2 = dash2 * exp(-pow((r - 0.78) / 0.028, 2.0));
        float ripple = exp(-r * 2.2) * (0.5 + 0.5 * sin(r * 16.0 - t * 2.2)) * inside;
        col = uDeep * inside * (0.2 + 0.4 * cling)
            + uRim * ring1 * 2.6 * boost
            + uRim * ring2 * 1.7 * boost
            + uDeep * ripple * 1.4
            + vec3(0.9, 0.99, 1.0) * core * 0.8 * boost;
        alpha = clamp(inside * 0.96 + ring1 + feather * 0.3, 0.0, 1.0);
      } else {
        // ---- Torn void (the reference): ragged blazing rim, cracked ----
        // starred dark behind it.
        float f = fbm(pMid * 2.6 + vec2(0.0, t * 0.05));
        float ridge = pow(1.0 - abs(2.0 * fract(f * 3.0) - 1.0), 24.0);
        float crack = ridge * inside * (0.06 + 0.94 * cling * cling);
        float star = stars(pStar, t) * inside;
        float depthGlow = fbm(pGlow * 1.8 + vec2(t * 0.03, -t * 0.02)) * inside;
        col = uDeep * cling * inside * 0.7
            + uDeep * depthGlow * 0.55
            + uRim * crack * 1.6
            + vec3(0.75, 0.95, 1.0) * star * 1.6
            + uRim * body * 2.3 * boost
            + vec3(0.85, 0.99, 1.0) * core * 3.2 * boost
            + uRim * feather * 0.8 * boost;
      }

      if (alpha < 0.01) discard;
      gl_FragColor = vec4(col, alpha);
    }`;
}

/**
 * Standing elliptical portal — one upright quad wearing the portal shader, and
 * a faint pool of the same light on the floor. entity.yaw is applied by the
 * renderer post-syncMesh, so the quad only has to stand up in local space.
 */
function buildPortal(scene: Scene, root: Mesh): void {
  registerPortalShader();

  // The whole portal. Wider than the tear itself by the feather's reach: the
  // shader draws the tear at 80% of the quad and bleeds plasma over the rest,
  // and a quad cut at the rim clips the bleed into a straight edge. The UV
  // space stays circular; the QUAD's aspect is what makes the tear an oval —
  // 1.2 x 2.16 of actual tear, the standing-doorway proportion he asked for,
  // and six portals on the hideout arc (~3.7u apart) still clear each other.
  const face = MeshBuilder.CreatePlane(`${root.name}-pi`, { width: 1.5, height: 2.7 }, scene);
  face.position.y = 1.12;
  face.parent = root;
  const mat = new ShaderMaterial(`${root.name}-portal`, scene, PORTAL_SHADER, {
    attributes: ["position", "uv"],
    uniforms: [
      "worldViewProjection", "world", "uCam", "uTime", "uHover",
      "uRim", "uDeep", "uJag", "uCoreW", "uBodyW", "uFeatherLen", "uVariant",
    ],
    needAlphaBlending: true,
  });
  mat.backFaceCulling = false; // a window into void is a window from both sides
  // The void must hide what is behind it, so this is ordinary alpha blend, not
  // additive — but it must not write depth, or the feather's invisible corners
  // occlude the next portal along the arc.
  mat.disableDepthWrite = true;
  mat.setFloat("uTime", 0);
  mat.setFloat("uHover", 0);
  mat.setVector3("uCam", scene.activeCamera?.position ?? new Vector3(0, 8, -8));
  setPortalStyle(mat, PORTAL_STYLES[PORTAL_STYLE]!);
  face.material = mat;
  face.receiveShadows = false;

  // Tight warm-blue ground pool — soft and transparent so the stone reads through.
  const bloomMat = new StandardMaterial(`${root.name}-portal-bloom`, scene);
  bloomMat.diffuseColor = new Color3(0, 0, 0);
  bloomMat.emissiveColor = PORTAL_CYAN.scale(0.30); // the same arc, spilled on the floor
  bloomMat.specularColor = new Color3(0, 0, 0);
  bloomMat.alpha = 0.18; // subtle — readable stone beneath; standard alpha-blend is the default
  const bloom = MeshBuilder.CreateCylinder(`${root.name}-pb`, { diameter: 1.4, height: 0.02, tessellation: 24 }, scene);
  bloom.position.y = 0.01;
  bloom.parent = root;
  bloom.material = bloomMat;
  bloom.receiveShadows = false;

  // interactKind lets bindings.ts identify a picked portal child without the snapshot
  root.metadata = { portalMat: mat, interactKind: "portal" };
}

/**
 * World height of the loot beam, in the same units as the actors (~1.8 tall).
 *
 * Shorter than the 7 it was, and shorter again than the 4.2 that replaced it.
 * The camera shows 9.5 units of height and looks DOWN, so a vertical shaft is
 * raked hard across the screen by the projection and runs a lot further than its
 * height: at 4.2 it still left the top of the frame. A beam with no visible END
 * reads as a column holding up the sky rather than as a marker standing on a
 * drop, and the fade cannot be seen at all if it happens off screen. At 2.9 the
 * top of every beam is in the frame, which is the whole point of having one.
 */
const BEAM_H = 2.9;
/**
 * Screen-space lean of the shaft, in radians. Zero, and it stays zero.
 *
 * PoE's loot columns look raked in a screenshot (`docs/todo/image-2.png`) and
 * they are not: they are plumb, and a perspective camera that is not overhead
 * splays every vertical in the frame away from its centre. Authoring a lean ON
 * TOP of that gives a floor of beams that all lean the SAME way, which is the
 * one thing a perspective camera can never produce, and reads instantly as
 * broken rather than as depth.
 */
const BEAM_TILT = 0;

/**
 * Where a tilted beam cylinder has to sit for its FOOT to stay on the drop.
 * Babylon rotates a mesh about its own centre, so a raked shaft otherwise plants
 * its base half a beam-height away from the item it marks.
 */
export function beamTransform(): { x: number; y: number; rz: number } {
  return {
    x: -Math.sin(BEAM_TILT) * (BEAM_H / 2),
    y: Math.cos(BEAM_TILT) * (BEAM_H / 2),
    rz: BEAM_TILT,
  };
}

/**
 * Vertical falloff for the loot beam: solid where it meets the floor, gone at the
 * top. One texture shared by every beam — a cylinder UV runs v=0 at the bottom,
 * which is the bottom row of the image.
 */
function beamGradient(scene: Scene): DynamicTexture {
  const existing = scene.getTextureByName("loot-beam-falloff");
  if (existing) return existing as DynamicTexture;
  const tex = new DynamicTexture("loot-beam-falloff", { width: 4, height: 64 }, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const grad = ctx.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, "#000"); // top of the image = top of the beam
  // A long taper rather than a short one that stops. The shaft still has to run
  // out inside the frame, but "runs out" has to be something the eye can watch
  // happen: gone by half way reads as a beam someone cut, which is the same
  // complaint as a beam with no end at all.
  grad.addColorStop(0.22, "#0d0d0d");
  grad.addColorStop(0.58, "#5a5a5a");
  grad.addColorStop(0.86, "#c8c8c8");
  grad.addColorStop(1, "#fff"); // floor end stays bright
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 64);
  tex.update();
  tex.getAlphaFromRGB = true;
  return tex;
}

/** Beacon colour per rarity, matched to the tooltip palette in hud/ItemTooltip.tsx. */
const GROUND_ITEM_COLOR: Record<string, [number, number, number]> = {
  normal: [0.78, 0.78, 0.78],
  magic: [0.56, 0.59, 1.0],
  rare: [0.9, 0.84, 0.29],
  unique: [0.69, 0.38, 0.15],
};

/** Tint a ground-item beacon by rarity, so a drop reads before its plate is. */
export function updateGroundItem(mesh: Mesh, rarity: string | undefined): void {
  const mat = mesh.material as StandardMaterial | null;
  if (!mat) return;
  const [r, g, b] = GROUND_ITEM_COLOR[rarity ?? "normal"] ?? GROUND_ITEM_COLOR["normal"]!;
  mat.diffuseColor = new Color3(r * 0.35, g * 0.35, b * 0.35);
  mat.emissiveColor = new Color3(r, g, b);
  const beamMat = mesh.getChildMeshes()[0]?.material as StandardMaterial | null;
  if (beamMat) {
    // Junk barely glows, a unique is visible across the room. Same idea as a
    // NeverSink filter turning the beam up with the tier.
    const lit = BEAM_ALPHA[rarity ?? "normal"] ?? BEAM_ALPHA["normal"]!;
    // ...and it breathes, shallowly, on a phase of its own.
    //
    // A shaft of light that does not move is a prop. Fifteen percent at about
    // two thirds of a hertz is under what reads as flashing and over what reads
    // as static, and the phase comes off the mesh's own id so a floor covered in
    // drops never pulses in unison, which is the thing that WOULD be
    // distracting.
    const t = Date.now() / 1000;
    const phase = (mesh.uniqueId ?? 0) * 1.7;
    const k = lit * (0.86 + 0.14 * Math.sin(t * 4.2 + phase));
    // Through the EMISSIVE, not through the alpha, and that is the whole reason
    // every beam used to be the same blazing white column whatever it stood on.
    //
    // The scene has a GlowLayer, and its shader reads a material's emissive
    // colour, its opacity TEXTURE and its vertex alpha — never `material.alpha`.
    // So the tier scaling and the breathing were applied in the lit pass and
    // thrown away in the bloom pass, which then drew all four tiers at full
    // energy and blurred that over the top of the ramp: a junk shaft and a
    // unique one differed by nothing, and the fade at the top was buried under
    // its own halo. Driving brightness through the emissive makes both passes
    // agree, and leaves the opacity ramp alone to do the one job it CAN do in
    // both, which is the shape.
    beamMat.emissiveColor.set(r * k, g * k, b * k);
    beamMat.alpha = 1;
  }
}

// Intensity, not density (docs/09-reward-psychology.md 3): the gap between a junk
// shaft and a unique one is what makes the unique an event, so the tiers spread
// rather than sitting evenly.
const BEAM_ALPHA: Record<string, number> = {
  normal: 0.09,
  magic: 0.24,
  rare: 0.45,
  unique: 0.7,
};

/**
 * How long after the portal before it a portal opens. His number: six doorways
 * arriving on one tick is a pop, and the same six a quarter-second apart is the
 * device working through them.
 */
export const PORTAL_STAGGER_MS = 250;
/** How long one portal takes to iris open, and to close again. */
const PORTAL_OPEN_MS = 320;
const PORTAL_CLOSE_MS = 220;

/**
 * Drive a portal's root scale from 0 to 1 (or back), then hand off.
 *
 * Scaling the ROOT and not the parts is what makes it grow out of the floor: the
 * void, the rim and the ground bloom are all positioned in local space, so the
 * whole doorway rises and widens together instead of a full-size ellipse fading in
 * where there was nothing.
 *
 * Guarded on `isDisposed` every tick: a scene torn down mid-animation (leaving an
 * area is exactly when portals are closing) disposes the mesh underneath us.
 */
function scalePortal(
  scene: Scene, root: Mesh, ms: number, from: number, to: number, onDone?: () => void,
): void {
  root.scaling.setAll(from);
  let t = 0;
  const tick = scene.onBeforeRenderObservable.add(() => {
    if (root.isDisposed()) { scene.onBeforeRenderObservable.remove(tick); return; }
    t += scene.getEngine().getDeltaTime();
    const k = Math.min(1, t / ms);
    // easeOutBack: overshoots a little and settles, which is a door being pushed
    // rather than a value being lerped. Opening only — a close that overshot would
    // grow before it went.
    const e = to > from ? 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2) : k;
    root.scaling.setAll(from + (to - from) * e);
    if (k >= 1) {
      scene.onBeforeRenderObservable.remove(tick);
      root.scaling.setAll(to);
      onDone?.();
    }
  });
}

/**
 * A portal opening: hidden for `delayMs`, then irised open.
 *
 * The sound lives here rather than in the soundscape because the renderer owns the
 * six-portal sequence. Only its first portal gets `withCue`; the rest keep their
 * visual stagger without stacking six copies of the same opening sound.
 */
export function portalAppear(scene: Scene, root: Mesh, delayMs: number, withCue: boolean): void {
  root.setEnabled(false);
  root.scaling.setAll(0.001);
  if (delayMs <= 0) {
    root.setEnabled(true);
    if (withCue) playPortalSfx(scene, root, "portal-open");
    scalePortal(scene, root, PORTAL_OPEN_MS, 0.001, 1);
    return;
  }
  let t = 0;
  const wait = scene.onBeforeRenderObservable.add(() => {
    if (root.isDisposed()) { scene.onBeforeRenderObservable.remove(wait); return; }
    t += scene.getEngine().getDeltaTime();
    if (t < delayMs) return;
    scene.onBeforeRenderObservable.remove(wait);
    root.setEnabled(true);
    if (withCue) playPortalSfx(scene, root, "portal-open");
    scalePortal(scene, root, PORTAL_OPEN_MS, 0.001, 1);
  });
}

/**
 * A portal closing: collapses, then disposes itself.
 *
 * The caller has already forgotten this mesh, so nothing else will ever dispose
 * it — which is exactly why the animation owns that.
 */
export function portalVanish(scene: Scene, root: Mesh): void {
  playPortalSfx(scene, root, "portal-close");
  scalePortal(scene, root, PORTAL_CLOSE_MS, root.scaling.x, 0.001, () => {
    if (!root.isDisposed()) root.dispose();
  });
}

/** Portals live in the world, unlike menu cues. The camera target follows the
 * player, so it is the listener position already available at this render seam. */
function playPortalSfx(scene: Scene, root: Mesh, name: "portal-open" | "portal-close"): void {
  const target = (scene.activeCamera as { target?: Vector3 } | null)?.target;
  if (!target) { playSfx(name); return; }
  const source = root.getAbsolutePosition();
  playSfx(name, ...worldSfxMix(source.x - target.x, source.z - target.z));
}

/** Is this root a portal? Read off the metadata the builder already stamps. */
export function isPortalMesh(root: Mesh): boolean {
  return (root.metadata as { interactKind?: string } | null)?.interactKind === "portal";
}

/**
 * Drive the portal shader's clock and the inRange affordance.
 * Called every apply() so the animation is driven off real time without needing
 * a render-timestamp parameter. Everything that MOVES lives in the fragment
 * shader; this only hands it the time and how hard to burn.
 */
export function updatePortal(root: Mesh, hovered: boolean): void {
  const parts = root.metadata as { portalMat?: ShaderMaterial } | null;
  if (!parts?.portalMat) return;
  // ponytail: Date.now() as animation clock — cheap and always available; upgrade
  // to a passed render-time argument if sub-frame precision ever matters.
  parts.portalMat.setFloat("uTime", (Date.now() % 3600000) / 1000);
  parts.portalMat.setFloat("uHover", hovered ? 1 : 0);
  // The camera, for the void's parallax. Zoom moves it every frame, so this is
  // per-frame data like the clock, not build-time data like the style.
  const cam = parts.portalMat.getScene().activeCamera;
  if (cam) parts.portalMat.setVector3("uCam", cam.position);
}

/**
 * Low brass/gold ceremonial basin — cylindrical pedestal with a wider decorative rim.
 * Warm metallic gold with specular so it catches key light; faint emissive stays
 * readable in dark scenes. inRange pulses the emissive for the interact affordance.
 *
 * This is the greybox now: `props.glb` carries the turned, textured device, and
 * the primitives below stand in only when it has not loaded. Both hand the hover
 * code the same two materials under the same names, so nothing downstream cares
 * which one it got.
 */
function buildMapDevice(scene: Scene, root: Mesh): void {
  standGroundBlob(scene, root, 0.95);
  const asset = attachProp(scene, root, "mapDevice");
  if (asset) {
    root.metadata = {
      brassBody: asset["brass_side"],
      brassRim: asset["brass_top"],
      interactKind: "mapDevice",
    };
    return;
  }

  // Dark antique brass — lower diffuse, high specular so the directional key light
  // creates a visible metallic catch rather than flat painted-yellow plastic.
  const brassBody = new StandardMaterial(`${root.name}-md-body`, scene);
  brassBody.diffuseColor = new Color3(0.40, 0.26, 0.08); // dark warm brass
  brassBody.emissiveColor = new Color3(0.06, 0.04, 0.01); // stays readable in dark
  brassBody.specularColor = new Color3(0.95, 0.78, 0.42); // strong metallic highlight
  brassBody.specularPower = 96;

  // Slightly warmer rim material with more emissive for the decorative band.
  const brassRim = new StandardMaterial(`${root.name}-md-rim`, scene);
  brassRim.diffuseColor = new Color3(0.50, 0.34, 0.10);
  brassRim.emissiveColor = new Color3(0.10, 0.07, 0.02);
  brassRim.specularColor = new Color3(0.9, 0.72, 0.38);
  brassRim.specularPower = 128;

  // Stepped base ring — wide, low slab that anchors it to the ground.
  const baseRing = MeshBuilder.CreateCylinder(`${root.name}-md-br`, { diameter: 1.6, height: 0.14, tessellation: 16 }, scene);
  baseRing.position.y = 0.07;
  baseRing.parent = root;
  baseRing.material = brassBody;

  // Narrower column rising from the base.
  const column = MeshBuilder.CreateCylinder(`${root.name}-md-col`, { diameterTop: 0.75, diameterBottom: 0.85, height: 0.55, tessellation: 16 }, scene);
  column.position.y = 0.14 + 0.275; // sits on top of baseRing
  column.parent = root;
  column.material = brassBody;

  // Wide ornate rim — the decorative basin lip at the top of the column.
  const decorRim = MeshBuilder.CreateTorus(`${root.name}-md-dr`, { diameter: 1.4, thickness: 0.14, tessellation: 28 }, scene);
  decorRim.position.y = 0.69; // flush with column top
  decorRim.parent = root;
  decorRim.material = brassRim;

  // Shallow recessed centre bowl — the "basin" the reference shows as a dark inset.
  const bowl = MeshBuilder.CreateCylinder(`${root.name}-md-bwl`, { diameter: 0.68, height: 0.08, tessellation: 16 }, scene);
  bowl.position.y = 0.73;
  bowl.parent = root;
  bowl.material = brassBody;

  root.metadata = { brassBody, brassRim, interactKind: "mapDevice" };
}

/**
 * Iron-banded wooden chest on a low stone step, the way PoE2's camp stash sits at
 * the edge of the firelight (reference-screenshots/closeup-hideout-zoom.jpg): dark
 * timber, cold iron straps, a domed lid. Hover warms the iron so it reads clickable.
 */
function buildStash(scene: Scene, root: Mesh): void {
  standGroundBlob(scene, root, 0.75, 0.6);
  const asset = attachProp(scene, root, "stash");
  if (asset) {
    // The chest is one material now; the whole thing warms on hover.
    root.metadata = { iron: asset["stash_chest"] ?? asset["iron"], interactKind: "stash" };
    return;
  }

  const wood = new StandardMaterial(`${root.name}-st-wood`, scene);
  wood.diffuseColor = new Color3(0.20, 0.13, 0.07);
  wood.emissiveColor = new Color3(0.03, 0.02, 0.01);
  wood.specularColor = new Color3(0.18, 0.14, 0.09);
  wood.specularPower = 32;

  const iron = new StandardMaterial(`${root.name}-st-iron`, scene);
  iron.diffuseColor = new Color3(0.16, 0.15, 0.15);
  iron.emissiveColor = new Color3(0.03, 0.03, 0.03);
  iron.specularColor = new Color3(0.7, 0.68, 0.6);
  iron.specularPower = 96;

  const stone = new StandardMaterial(`${root.name}-st-stone`, scene);
  stone.diffuseColor = new Color3(0.17, 0.16, 0.15);
  stone.specularColor = new Color3(0.1, 0.1, 0.1);

  // Stone step it stands on, so the chest does not read as floating on the dirt.
  const step = MeshBuilder.CreateBox(`${root.name}-st-step`, { width: 1.6, depth: 1.15, height: 0.12 }, scene);
  step.position.y = 0.06;
  step.parent = root;
  step.material = stone;

  const body = MeshBuilder.CreateBox(`${root.name}-st-body`, { width: 1.35, depth: 0.85, height: 0.62 }, scene);
  body.position.y = 0.12 + 0.31;
  body.parent = root;
  body.material = wood;

  // Domed lid: a half cylinder lying along the chest's width.
  const lid = MeshBuilder.CreateCylinder(`${root.name}-st-lid`, { diameter: 0.85, height: 1.35, tessellation: 16, arc: 0.5 }, scene);
  lid.rotation.z = Math.PI / 2;
  lid.position.y = 0.74;
  lid.parent = root;
  lid.material = wood;

  // Two vertical iron straps over body and lid, plus the lock plate between them.
  for (const dx of [-0.42, 0.42]) {
    const strap = MeshBuilder.CreateBox(`${root.name}-st-strap`, { width: 0.09, depth: 0.9, height: 0.66 }, scene);
    strap.position.set(dx, 0.43, 0);
    strap.parent = root;
    strap.material = iron;
  }
  const lock = MeshBuilder.CreateBox(`${root.name}-st-lock`, { width: 0.2, depth: 0.08, height: 0.24 }, scene);
  lock.position.set(0, 0.6, -0.44);
  lock.parent = root;
  lock.material = iron;

  root.metadata = { iron, interactKind: "stash" };
}

/**
 * A reward container standing on a map's reward anchor: a chest, a barrel or a
 * crate, primitives in the same timber-and-iron language as the stash so the
 * three read as one family of furniture. The chest's lid hangs on a hinge node
 * so opening it is a rotation, not a re-build.
 */
/**
 * The contact shadow the sun cannot give a prop. The directional shadow falls
 * away from the base, so everything standing on the floor read as floating a
 * finger above it; this soft dark pool pins it down. One shared radial-gradient
 * texture per scene, one cheap unlit quad per prop, excluded from both shadow
 * generators by its name (engine.ts).
 */
const BLOB_MATERIALS = new WeakMap<Scene, Partial<Record<BlobKind, StandardMaterial>>>();

/** Who is standing there. Furniture and a body do not touch a floor alike. */
export type BlobKind = "prop" | "actor";

/**
 * The gradient each kind gets: where the solid core stops (in texture pixels of
 * a 128 map, so 64 is the full radius) and the alpha ramp out from it.
 *
 * A prop is heavy and its base is a hard edge, so its pool has a defined core
 * and does most of its fading in the outer third. An actor is a body on two
 * feet under a moving light, and a crisp disc travelling with him reads as a
 * decal stuck to the floor — his starts falling off almost immediately and
 * never gets as dark.
 */
const BLOB_LOOK: Record<BlobKind, { inner: number; stops: readonly [number, number][] }> = {
  prop: { inner: 26, stops: [[0, 0.34], [0.55, 0.24], [0.8, 0.08], [1, 0]] },
  actor: { inner: 4, stops: [[0, 0.22], [0.45, 0.14], [0.75, 0.05], [1, 0]] },
};

/**
 * One material per kind per scene, not one per object.
 *
 * Since the sun stopped casting this is what grounds a MONSTER too, and a swarm
 * would otherwise be a StandardMaterial each — every one its own state change at
 * draw time for a difference no pixel can show.
 */
function blobMaterial(scene: Scene, kind: BlobKind): StandardMaterial | null {
  const byKind = BLOB_MATERIALS.get(scene) ?? {};
  const cached = byKind[kind];
  if (cached) return cached;
  // A DynamicTexture wants a canvas, and there is none under NullEngine — the
  // same headless hole the shadow generators and the GlowLayer sit behind. Every
  // actor goes through here now, so an unguarded throw takes the whole renderer
  // down in tests rather than costing one soft quad.
  let tex: DynamicTexture;
  try {
    tex = new DynamicTexture(`groundblob-tex-${kind}`, 128, scene, false);
  } catch {
    return null;
  }
  const look = BLOB_LOOK[kind];
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(64, 64, look.inner, 64, 64, 64);
  for (const [at, alpha] of look.stops) g.addColorStop(at, `rgba(0,0,0,${alpha})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  tex.update();
  tex.hasAlpha = true;
  const mat = new StandardMaterial(`groundblob-mat-${kind}`, scene);
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.emissiveColor = Color3.Black();
  mat.opacityTexture = tex;
  mat.disableLighting = true;
  byKind[kind] = mat;
  BLOB_MATERIALS.set(scene, byKind);
  return mat;
}

/**
 * How far the pool spreads past the footprint it was given.
 *
 * Callers pass the half-extents of the THING, and a shadow the exact size of the
 * thing is a shadow nobody can see: a crate, a barrel and a pillar on its plinth
 * all sit flush on the floor and swallow their own contact shadow whole. The
 * brazier was the only prop that ever visibly had one, and only because it
 * stands on three legs with daylight between them. So the quad is always wider
 * than what it grounds, and the gradient's soft outer half is what shows.
 */
const BLOB_SPREAD = 1.2;

export function standGroundBlob(
  scene: Scene,
  root: Mesh,
  rx: number,
  rz = rx,
  kind: BlobKind = "prop",
): void {
  const mat = blobMaterial(scene, kind);
  if (!mat) return;
  // An actor's pool spreads further than a prop's on top of being fainter: the
  // gradient alone would only make him paler, and what a body needs is a wider,
  // vaguer patch than the hard-edged block of furniture beside him.
  const spread = kind === "actor" ? BLOB_SPREAD * 1.35 : BLOB_SPREAD;
  const quad = MeshBuilder.CreateGround(
    `groundblob-${root.name}`,
    { width: rx * 2 * spread, height: rz * 2 * spread },
    scene,
  );
  // Above the floor decals (rug sits at 0.012) but under everything solid.
  quad.position.y = 0.015;
  quad.isPickable = false;
  quad.parent = root;
  quad.material = mat;
}

/** Downloaded mesh, and the material key it ships, for each container look. */
const CONTAINER_ASSET: Record<string, { kind: PropKind; mat: string }> = {
  chest: { kind: "lootChest", mat: "loot_chest" },
  barrel: { kind: "barrel", mat: "barrel_wood" },
  crate: { kind: "crate", mat: "crate_wood" },
};

function buildContainer(scene: Scene, root: Mesh, look: string): void {
  standGroundBlob(scene, root, look === "barrel" ? 0.36 : 0.5, look === "chest" ? 0.38 : undefined);
  const asset = CONTAINER_ASSET[look];
  if (asset) {
    const mats = attachProp(scene, root, asset.kind);
    if (mats) {
      const mat = mats[asset.mat];
      // The chest opens by sliding its lid back off the box rather than tipping
      // it up on a hinge: a lid thrown open to 110 degrees at this camera is a
      // plank standing between the player and the loot he just won.
      const lid = root.getChildMeshes(false).find((m) => m.name === "lootChest_lid") ?? null;
      if (lid) lid.rotationQuaternion = null;
      root.metadata = { wood: mat, iron: mat, lid, lidRest: lid?.position.clone(), interactKind: "container" };
      return;
    }
  }

  const wood = new StandardMaterial(`${root.name}-ct-wood`, scene);
  wood.diffuseColor = new Color3(0.22, 0.14, 0.08);
  wood.emissiveColor = new Color3(0.03, 0.02, 0.01);
  wood.specularColor = new Color3(0.15, 0.12, 0.08);
  wood.specularPower = 32;

  const iron = new StandardMaterial(`${root.name}-ct-iron`, scene);
  iron.diffuseColor = new Color3(0.15, 0.14, 0.14);
  iron.emissiveColor = new Color3(0.03, 0.03, 0.03);
  iron.specularColor = new Color3(0.6, 0.58, 0.5);
  iron.specularPower = 96;

  let lid: Mesh | null = null;
  if (look === "barrel") {
    const body = MeshBuilder.CreateCylinder(`${root.name}-ct-body`, { diameter: 0.78, height: 0.95, tessellation: 14 }, scene);
    body.position.y = 0.475;
    body.parent = root;
    body.material = wood;
    for (const y of [0.2, 0.75]) {
      const hoop = MeshBuilder.CreateTorus(`${root.name}-ct-hoop`, { diameter: 0.78, thickness: 0.05, tessellation: 14 }, scene);
      hoop.position.y = y;
      hoop.parent = root;
      hoop.material = iron;
    }
  } else if (look === "crate") {
    const body = MeshBuilder.CreateBox(`${root.name}-ct-body`, { width: 0.9, depth: 0.9, height: 0.8 }, scene);
    body.position.y = 0.4;
    body.parent = root;
    body.material = wood;
    // Diagonal brace plank on the front face, the one mark that says "crate".
    const brace = MeshBuilder.CreateBox(`${root.name}-ct-brace`, { width: 1.1, depth: 0.05, height: 0.12 }, scene);
    brace.position.set(0, 0.4, -0.46);
    brace.rotation.z = 0.72;
    brace.parent = root;
    brace.material = iron;
  } else {
    const body = MeshBuilder.CreateBox(`${root.name}-ct-body`, { width: 1.05, depth: 0.7, height: 0.5 }, scene);
    body.position.y = 0.25;
    body.parent = root;
    body.material = wood;
    // The greybox lid answers the same contract as the authored one: a node the
    // caller slides along z, rather than a hinge node it rotates.
    lid = MeshBuilder.CreateCylinder(`${root.name}-ct-lid`, { diameter: 0.7, height: 1.05, tessellation: 12, arc: 0.5 }, scene);
    lid.rotation.z = Math.PI / 2;
    lid.position.set(0, 0.5, 0);
    lid.parent = root;
    lid.material = wood;
    const lock = MeshBuilder.CreateBox(`${root.name}-ct-lock`, { width: 0.16, depth: 0.06, height: 0.18 }, scene);
    lock.position.set(0, 0.46, -0.36);
    lock.parent = root;
    lock.material = iron;
    root.metadata = { wood, iron, lid, lidRest: lid.position.clone(), interactKind: "container" };
    return;
  }
  root.metadata = { wood, iron, interactKind: "container" };
}

/**
 * Hover warms the ironwork like every other clickable; opened slides the
 * chest's lid back and lets the whole thing go cold — an emptied container
 * must stop advertising itself or every room keeps promising twice.
 *
 * The lid travels over its own hinge edge, which is the side its geometry does
 * NOT extend to: the mesh is authored with its origin on that line, so the sign
 * of the bounding centre says which way "back" is without this code having to
 * know how many axis conversions stand between Blender and here.
 */
const LID_SLIDE = 0.44;

export function updateContainer(root: Mesh, hovered: boolean, opened: boolean): void {
  const parts = root.metadata as {
    wood?: StandardMaterial; iron?: StandardMaterial; lid?: Mesh | null; lidRest?: Vector3;
  } | null;
  if (!parts?.iron || !parts.wood) return;
  const e = !opened && hovered ? 0.26 : 0.03;
  parts.iron.emissiveColor.set(e, e * 0.72, e * 0.3);
  const w = opened ? 0 : 0.03;
  parts.wood.emissiveColor.set(w, w * 0.7, w * 0.35);
  const { lid, lidRest } = parts;
  if (lid && lidRest) {
    const box = lid.getBoundingInfo().boundingBox;
    const back = box.center.z >= 0 ? -1 : 1;
    lid.position.z = lidRest.z + (opened ? back * box.extendSize.z * 2 * LID_SLIDE : 0);
  }
}

/** Warm the chest's ironwork on hover, the same affordance the map device uses. */
export function updateStash(root: Mesh, hovered: boolean): void {
  const parts = root.metadata as { iron: StandardMaterial } | null;
  if (!parts?.iron) return;
  const e = hovered ? 0.26 : 0.03;
  parts.iron.emissiveColor.set(e, e * 0.72, e * 0.3);
}

/**
 * The disenchanter: a hooded figure standing over a brazier, not a bench.
 *
 * PoE2 gives every hideout service a person to talk to, and a service you walk
 * up to and *ask* is worth more than furniture you rummage in — the shards are
 * the same either way, but someone handing them over is an event. The NPC is the
 * same wardrobe rig the player wears, dressed as a hooded commoner so he reads
 * as a townsman rather than a second adventurer.
 *
 * The brazier stays, and carries all the hover feedback. It has to: the rig's
 * materials come from the shared glTF and are common to every instance, so
 * warming them on hover would light the player up too.
 */
function buildVendor(scene: Scene, root: Mesh): void {
  // He is a man standing on a floor before he is a thing to click, and the mark
  // below is a hover cue, not a shadow. While the sun cast, that read fine; with
  // it gone the ring was the only thing under him and it looked like a contact
  // shadow that had come out wrong.
  standGroundBlob(scene, root, 0.42, 0.42, "actor");
  // A ring worn into the floor where he stands, and the whole hover cue.
  //
  // It is the ring and not the man because the man is the PLAYER's rig: his
  // materials come out of the same wardrobe containers, so tinting him to say
  // "clickable" would tint the character too. It is also what a headless build or
  // a failed fetch is left with — something at his position that can still be
  // picked, which is the difference between a hideout with no disenchanter and a
  // hideout where the disenchanter cannot be reached.
  const markMat = new StandardMaterial(`${root.name}-vn-mark`, scene);
  markMat.diffuseColor = new Color3(0, 0, 0);
  markMat.emissiveColor = new Color3(0.18, 0.12, 0.05);
  markMat.specularColor = new Color3(0, 0, 0);
  markMat.alpha = 0.5;

  const mark = MeshBuilder.CreateTorus(
    `${root.name}-vn-mark`, { diameter: 1.35, thickness: 0.055, tessellation: 32 }, scene,
  );
  mark.position.y = 0.02;
  mark.parent = root;
  mark.material = markMat;
  mark.receiveShadows = false;

  // The man himself. Null when the models have not loaded (headless tests, a
  // failed fetch), which leaves the ring standing on its own.
  const rig = attachRig(scene, root);
  if (rig) {
    // Empty-handed on purpose: he is a disenchanter behind a counter, and a
    // shopkeeper holding a wand reads as another adventurer.
    rig.setLooks({
      weapon1: null, weapon2: null,
      helmet: "hood", body: "commoner", gloves: null, boots: "commoner", belt: null,
    });
    rig.setLocomotion(0); // stand and breathe; he never goes anywhere
  }

  root.metadata = { markMat, interactKind: "vendor", ...(rig ? { rig } : {}) };
}

/** Warm the ring at his feet when the cursor is on him. */
export function updateVendor(root: Mesh, hovered: boolean): void {
  const parts = root.metadata as { markMat?: StandardMaterial } | null;
  if (!parts?.markMat) return;
  const e = hovered ? 0.85 : 0.18;
  parts.markMat.emissiveColor.set(e, e * 0.68, e * 0.28);
  parts.markMat.alpha = hovered ? 0.85 : 0.5;
}

/** Brighten the device emissive on mouse hover so it reads as interactive. */
export function updateMapDevice(root: Mesh, hovered: boolean): void {
  const parts = root.metadata as { brassBody: StandardMaterial; brassRim: StandardMaterial } | null;
  if (!parts?.brassBody) return;
  // Idle: faint warm glow so it reads in a dark scene. Hovered: push enough
  // emissive that the GlowLayer produces a visible warm halo.
  const e = hovered ? 0.28 : 0.06;
  parts.brassBody.emissiveColor.set(e, e * 0.67, e * 0.17);
  parts.brassRim.emissiveColor.set(e * 1.4, e, e * 0.25);
}

/**
 * Both of these are fire, so both are emissive and neither is lit. The colour
 * here is only the part of the effect that has geometry: the bolt's head is
 * white-hot and everything orange about it lives in its particle tail
 * (`skill-fx.ts`), and the disc is the hit area first and a glow second.
 */
const FIRE_COLOR: Record<"projectile" | "groundArea", [number, number, number]> = {
  // Small and amber, not white: at 0.16 across with full emissive the GlowLayer
  // blew it into a white ball that beat its own flame tail.
  projectile: [1.0, 0.72, 0.34],
  groundArea: [1.0, 0.42, 0.12], // ember — cinder ground disc
};

/**
 * `at` is where the entity is being born, and it is not a convenience: a trail
 * seeds every one of its sections at wherever its generator stands when it is
 * built, so a bolt whose mesh is still at the origin gets a ribbon strung from
 * the origin to the caster's hand that then peels away over the next ~30 frames.
 * Position first, attach the effects second.
 */
/**
 * A rare is the same species standing a head taller. It used to be a different
 * creature entirely — the generic imp at 1.7 — which quietly told the player
 * that the elite in a swamp was a fire imp.
 */
const RARE_SCALE = 1.3;

export function makeMesh(
  scene: Scene,
  kind: MeshKind,
  name: string,
  at?: Vector3,
  species?: string,
): Mesh {
  // ponytail: each actor is assembled from ~10 primitive parts per instance
  // (shared materials, but geometry is not GPU-instanced). Fine for a lab-sized
  // fight; if a large imp swarm tanks FPS, build one template per kind and
  // clone/thin-instance it instead.
  if (kind === "player" || kind === "monster" || kind === "rare" || kind === "boss") {
    const root = new Mesh(name, scene); // empty container; renderer positions this
    // What stands an actor ON the floor, now that the sun casts nothing. Built
    // FIRST, before the `rare`/`boss` scaling below, so it grows with the body
    // it belongs to instead of needing a size of its own per kind. Every actor
    // sits at Y_LIFT 0, so the quad's own 0.015 clears the floor decals.
    standGroundBlob(scene, root, 0.42, 0.42, "actor");
    if (kind === "player") {
      // Skinned humanoid when its assets loaded; the primitive caster is the
      // fallback for headless tests and for a failed model fetch.
      const rig = attachRig(scene, root);
      if (rig) root.metadata = { rig } satisfies RigParts;
      else buildCaster(scene, root);
      return root;
    }

    // The authored creature when `monsters.glb` has it and has loaded. It is
    // skinned and carries its own walk and idle, so nothing here bobs it: the
    // clip already does, against feet that stay on the floor.
    const creature = species ? attachCreature(scene, root, species) : null;
    if (creature) {
      root.metadata = { creature, bob: 0 } satisfies ActorParts;
      if (kind === "rare") {
        root.scaling.setAll(RARE_SCALE);
        buildRareAura(scene, root);
      }
      return root;
    }

    if (kind === "boss") {
      // Darker charcoal rock, hotter lava glow, bright near-white eye.
      // Reuses rare_skin.png (boss_skin.png does not exist in public/textures/).
      // Low emissive on purpose: the reference look is a dark silhouette with hot
      // accents. At 0.85 the whole hide self-lit and the boss read as an orange blob.
      buildImp(scene, root, "boss", [0.18, 0.13, 0.11], 0.3, [1.0, 0.95, 0.8], "/textures/rare_skin.png");
      root.scaling.setAll(2.0);
    } else if (kind === "rare") {
      buildImp(scene, root, "rare", [0.42, 0.19, 0.06], 0.7, [1.0, 0.55, 0.15]);
      root.scaling.setAll(1.7); // elite: bigger than the common imp
      buildRareAura(scene, root);
    } else {
      buildImp(scene, root, "imp", [0.36, 0.11, 0.07], 0.5, [1.0, 0.85, 0.2]);
    }
    return root;
  }

  if (kind === "telegraph") {
    const root = new Mesh(name, scene);
    buildTelegraph(scene, root);
    return root;
  }

  if (kind === "portal") {
    const root = new Mesh(name, scene);
    buildPortal(scene, root);
    return root;
  }

  if (kind === "mapDevice") {
    const root = new Mesh(name, scene);
    buildMapDevice(scene, root);
    return root;
  }

  if (kind === "stash") {
    const root = new Mesh(name, scene);
    buildStash(scene, root);
    return root;
  }

  if (kind === "vendor") {
    const root = new Mesh(name, scene);
    buildVendor(scene, root);
    return root;
  }

  if (kind === "container") {
    const root = new Mesh(name, scene);
    // `species` is the shared string channel on makeMesh; for containers it
    // carries the look ("chest" | "barrel" | "crate").
    buildContainer(scene, root, species ?? "chest");
    return root;
  }

  if (kind === "groundItem") {
    // Beacon marker; the name plate over it is DOM (hud/LootLabels.tsx).
    const m = MeshBuilder.CreateCylinder(name, { diameter: 0.5, height: 0.3, tessellation: 6 }, scene);
    const itemMat = new StandardMaterial(`${name}-mat`, scene);
    itemMat.specularColor = new Color3(0, 0, 0);
    m.material = itemMat;
    // Light beam standing on the drop, the way PoE marks loot from across a room.
    // Additive so it glows over the floor instead of masking it, and unlit so it
    // keeps its rarity colour in a dark map.
    const beam = MeshBuilder.CreateCylinder(`${name}-beam`, { diameter: 0.12, height: BEAM_H, tessellation: 10 }, scene);
    beam.parent = m;
    const at = beamTransform();
    beam.position.set(at.x, at.y, 0);
    beam.rotation.z = at.rz;
    beam.isPickable = false;
    const beamMat = new StandardMaterial(`${name}-beam-mat`, scene);
    beamMat.diffuseColor = new Color3(0, 0, 0);
    beamMat.specularColor = new Color3(0, 0, 0);
    // The ramp texture carries the whole shape and `updateGroundItem` carries
    // the brightness in the emissive; the flat alpha stays out of both.
    beamMat.alpha = 1;
    beamMat.alphaMode = 1; // ALPHA_ADD
    beamMat.disableLighting = true;
    beamMat.backFaceCulling = false;
    beamMat.opacityTexture = beamGradient(scene); // bright at the floor, gone at the top
    beam.material = beamMat;
    updateGroundItem(m, "normal");
    return m;
  }

  const matName = `mat-${kind}`;
  let m = scene.getMaterialByName(matName) as StandardMaterial | null;
  if (!m) {
    const [r, g, b] = FIRE_COLOR[kind];
    m = new StandardMaterial(matName, scene);
    m.diffuseColor = new Color3(r, g, b);
    m.specularColor = new Color3(0, 0, 0);
    m.disableLighting = true;
    if (kind === "projectile") {
      // Full emissive so the GlowLayer blooms the head instead of tinting it.
      m.emissiveColor = new Color3(r, g, b);
    } else {
      // Additive, radially masked, and crawling: the patch reads as ground
      // burning rather than as a translucent decal ending on a hard rim. The
      // dim diffuse under it is the hit area, which has to stay readable
      // between the cracks — it is gameplay information first.
      m.diffuseColor = new Color3(r * 0.22, g * 0.22, b * 0.22);
      m.alpha = 0.9;
      m.alphaMode = 1; // ALPHA_ADD
      cinderGlow(scene, m);
    }
  }
  // groundArea built at diameter=2 (radius=1); renderer scales x/z to entity.radius.
  const mesh =
    kind === "projectile"
      ? MeshBuilder.CreateSphere(name, { diameter: 0.1, segments: 8 }, scene)
      : // Flat enough that the additive side wall never shows: with a falloff on
        // the cap, a visible rim is the one thing that gives the decal away.
        MeshBuilder.CreateCylinder(name, { diameter: 2, height: 0.04, tessellation: 24 }, scene);
  mesh.material = m;
  mesh.isPickable = false;
  if (at) {
    mesh.position.copyFrom(at);
    mesh.computeWorldMatrix(true); // the trail reads the bounding box, not the position
  }
  if (kind === "projectile") attachBoltTrail(scene, mesh);
  else attachCinderFX(scene, mesh);
  return mesh;
}
