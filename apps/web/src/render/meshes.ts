import {
  Color3,
  DynamicTexture,
  Effect,
  type GlowLayer,
  Mesh,
  MeshBuilder,
  ShaderMaterial,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
  type Scene,
} from "@babylonjs/core";
import { attachProp, type PropKind } from "./props";
import { attachCreature, creatureSpecies, type CreatureRig } from "./monsters";
import { attachArrowStreak, attachBoltTrail, attachCinderFX, buildArrow, CINDER_DISC_ALPHA, cinderGlow, fxProfile, PROJECTILE_ARROW_SCALE, setStreakLength, SKILL_FX } from "./skill-fx";
import { attachRig, isBody, rigOf, type Looks, type RigParts } from "./rig";
import { looksForEquipment } from "./gear-looks";
import { attachGroundModel, GROUND_LOOK_BASES } from "./ground-looks";
import { groundMaterial } from "./ground-fx";
import { hasRim, HIT_TINT, HIT_ALPHA, type Tier } from "./rim";
import { BROOD_ABILITY } from "./boss-tells";
import { playSfxAt } from "../audio/sfx";
import type { SnapshotEntity } from "@exiled/protocol";

export type MeshKind = "player" | "monster" | "rare" | "boss" | "projectile" | "groundArea" | "telegraph" | "telegraphLane" | "telegraphRing" | "broodMark" | "chargePath" | "portal" | "mapDevice" | "stash" | "vendor" | "container" | "groundItem" | "gold";

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
  telegraphLane: 0.06,
  telegraphRing: 0.06,
  broodMark: 0.06,
  chargePath: 0.06,
  // portal children self-position (inner disc at y=1.75 in local space); root sits on ground
  portal: 0,
  // map device cylinder base already starts at y=0 (children lift themselves)
  mapDevice: 0,
  stash: 0,
  vendor: 0,
  container: 0,
  // small floor-level beacon marker
  groundItem: 0.15,
  // the coins lift themselves off the floor
  gold: 0,
};

export { Y_LIFT };

/** The round decals: scaled on x/z alone to their world radius (a ring's is its outer edge). */
export const RADIUS_SCALED: ReadonlySet<MeshKind> = new Set<MeshKind>(["telegraph", "telegraphRing", "broodMark", "groundArea"]);

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
  auraMat.alpha = 0.55;
  auraMat.backFaceCulling = false;

  // A ring, not a filled disc: a disc that size washes the monster out from
  // above, and two of them overlapping blow straight to white. The torus is
  // already built flat in XZ, so no rotation is needed. Radii are in the root's
  // local space, which the rare scales by 1.7.
  const ring = MeshBuilder.CreateTorus("rare-aura", { diameter: 1.05, thickness: 0.045, tessellation: 24 }, scene);
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
 * Materials carrying the rim plugin get the flash through it (a per-mesh
 * `hitFlash` in metadata, read at bind time): Babylon's `renderOverlay` pass
 * mis-renders on those skinned PBR materials — a data texture drawn as colour,
 * green hatch rows on every hit tick. The material stays shared per species
 * either way; tinting one emissive would light up every imp on the screen.
 * Meshes without the plugin (greybox fallback) keep the overlay.
 */
export function setHitFlash(root: Mesh, t: number): void {
  const on = t > 0;
  for (const m of [root, ...root.getChildMeshes(false)]) {
    // Under the root but not the body: a white contact shadow reads as a square.
    if (m.name.startsWith("groundblob-") || m.name === "rare-aura") continue;
    if (hasRim(m.material)) {
      m.renderOverlay = false;
      // Mutate, never replace: ActorParts and glTF loader data live here too.
      const meta = (m.metadata ??= {}) as { hitFlash?: number };
      meta.hitFlash = on ? Math.min(1, t) : 0;
      continue;
    }
    if (!on) { m.renderOverlay = false; continue; }
    m.overlayColor = HIT_TINT;
    m.overlayAlpha = HIT_ALPHA * Math.min(1, t);
    m.renderOverlay = true;
  }
}

/** Give a creature its rarity shimmer (rim.ts), body meshes only; null clears it. */
export function setTier(root: Mesh, tier: Tier | null): void {
  for (const m of [root, ...root.getChildMeshes(false)]) {
    if (m.name.startsWith("groundblob-") || m.name === "rare-aura" || !hasRim(m.material)) continue;
    const meta = (m.metadata ??= {}) as { tier?: Tier };
    if (tier) meta.tier = tier;
    else delete meta.tier;
  }
}

/** Give the hovered monster its red outline (rim.ts), body meshes only; false clears it. */
export function setHovered(root: Mesh, on: boolean): void {
  for (const m of [root, ...root.getChildMeshes(false)]) {
    if (m.name.startsWith("groundblob-") || m.name === "rare-aura" || !hasRim(m.material)) continue;
    const meta = (m.metadata ??= {}) as { hovered?: boolean };
    if (on) meta.hovered = true;
    else delete meta.hovered;
  }
}

/** Glow a winding-up boss red (rim.ts), body meshes only; `t` at or below 0 clears it. */
export function setDangerGlow(root: Mesh, t: number): void {
  for (const m of [root, ...root.getChildMeshes(false)]) {
    if (m.name.startsWith("groundblob-") || m.name === "rare-aura" || !hasRim(m.material)) continue;
    const meta = (m.metadata ??= {}) as { dangerGlow?: number };
    if (t > 0) meta.dangerGlow = Math.min(1, t);
    else delete meta.dangerGlow;
  }
}

/**
 * Flat disc + bright rim ring for a boss telegraph.
 * Built at radius=1 so the renderer can scale it to any real radius.
 * Material refs stored in root.metadata so updateTelegraph can animate them
 * without re-allocating per frame.
 */
function buildTelegraph(scene: Scene, root: Mesh): void {
  const fillMat = dangerFill(scene, root);
  const rimMat = dangerRim(scene, root);

  // diameter=2 → radius=1; renderer scales x/z to match entity.radius
  const fill = MeshBuilder.CreateCylinder("telegraph-fill", { diameter: 2, height: 0.02, tessellation: 32 }, scene);
  fill.parent = root;
  fill.material = fillMat;
  fill.receiveShadows = false;

  // The tube scales with the radius, so a 3.5-unit slam at 0.06 drew a 0.2-unit band.
  const rim = MeshBuilder.CreateTorus("telegraph-rim", { diameter: 2, thickness: 0.012, tessellation: 48 }, scene);
  rim.parent = root;
  rim.material = rimMat;
  rim.receiveShadows = false;

  // The fill says where; this says when: a bright edge grows from the centre and
  // meets the rim on the impact tick.
  const front = MeshBuilder.CreateTorus("telegraph-front", { diameter: 2, thickness: 0.012, tessellation: 48 }, scene);
  front.parent = root;
  front.material = dangerFront(scene, root);
  front.receiveShadows = false;

  root.metadata = { fill: fillMat, rim: rimMat, front };
}

// The danger palette, shared by every hostile decal so red always means "get out".
// Per-entity materials (not cached by key) so multiple live telegraphs each
// animate their own alpha/emissive independently.
// Black diffuse on each: the danger zone must not be lit by the scene, or the
// key light washes it into a pale spotlight. Emissive carries all the colour.
function dangerFill(scene: Scene, root: Mesh): StandardMaterial {
  const m = new StandardMaterial(`${root.name}-tel-fill`, scene);
  m.diffuseColor = new Color3(0, 0, 0);
  m.emissiveColor = new Color3(0.55, 0.1, 0.02);
  m.specularColor = new Color3(0, 0, 0);
  m.alpha = 0.12;
  m.backFaceCulling = false;
  return m;
}

function dangerRim(scene: Scene, root: Mesh): StandardMaterial {
  const m = new StandardMaterial(`${root.name}-tel-rim`, scene);
  m.diffuseColor = new Color3(0, 0, 0);
  m.emissiveColor = new Color3(0.55, 0.16, 0.03);
  m.specularColor = new Color3(0, 0, 0);
  m.alpha = 0.5;
  // Additive: a dark red blended over the floor drew a near-black outline.
  m.alphaMode = 1; // ALPHA_ADD
  return m;
}

/** The closing front's additive line, brighter than the rim so it reads against it. */
function dangerFront(scene: Scene, root: Mesh): StandardMaterial {
  const m = new StandardMaterial(`${root.name}-tel-front`, scene);
  m.diffuseColor = new Color3(0, 0, 0);
  m.emissiveColor = new Color3(0.95, 0.42, 0.1);
  m.specularColor = new Color3(0, 0, 0);
  m.alpha = 0.75;
  m.alphaMode = 1; // ALPHA_ADD
  return m;
}

/**
 * Animate a telegraph's fill as wind-up progresses.
 * progress 0 → dim deep-orange; progress 1 → bright near-white flash.
 * Mutates existing material properties — no allocations per call.
 */
export function updateTelegraph(root: Mesh, progress: number): void {
  const parts = root.metadata as
    | { fill: StandardMaterial; rim: StandardMaterial; front: Mesh }
    | null;
  if (!parts?.fill) return;
  const at = Math.max(0.02, progress);
  parts.front.scaling.set(at, 1, at);
  paintDanger(parts.fill, parts.rim, progress);
}

function paintDanger(fill: StandardMaterial, rim: StandardMaterial, progress: number): void {
  // The fill only ever deepens — it marks the ground, it must not light it.
  fill.alpha = 0.12 + progress * 0.18;
  fill.emissiveColor.set(0.55 + progress * 0.35, 0.1 + progress * 0.12, 0.02);
  // The rim carries the urgency, and only whitens in the last moment before
  // impact, so the flash reads as "now" instead of a slow fade to white.
  const flash = Math.max(0, (progress - 0.85) / 0.15);
  rim.emissiveColor.set(0.55 + flash * 0.45, 0.16 + flash * 0.76, 0.03 + flash * 0.73);
  rim.alpha = 0.5 + flash * 0.5;
}

/** Segments round a lane's far end. */
const LANE_ARC = 16;
/** A lane's outline, in world units: about a 4-unit disc's rim. */
const LANE_RIM_WIDTH = 0.05;
/** How deep a lane's front bar is, along the lane. */
const LANE_FRONT_DEPTH = 0.1;

/** A lane's edge as [x, z], flat across the boss's end (z = 0) and round past `length`; clockwise seen from above. */
function laneEdge(length: number, half: number): [number, number][] {
  const edge: [number, number][] = [[half, 0], [-half, 0], [-half, length]];
  for (let i = 1; i < LANE_ARC; i++) {
    const a = Math.PI * (1 - i / LANE_ARC);
    edge.push([Math.cos(a) * half, length + Math.sin(a) * half]);
  }
  edge.push([half, length]);
  return edge;
}

/** A flat, updatable floor mesh. The caller winds `indices` to face up: Babylon culls by winding. */
function floorMesh(scene: Scene, name: string, parent: TransformNode, vertices: number, indices: number[], material: StandardMaterial): Mesh {
  const mesh = new Mesh(name, scene);
  const normals = new Array<number>(vertices * 3).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0));
  Object.assign(new VertexData(), { positions: new Array<number>(vertices * 3).fill(0), normals, indices }).applyToMesh(mesh, true);
  mesh.parent = parent;
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  return mesh;
}

interface LaneParts {
  lane: TransformNode;
  fill: StandardMaterial;
  rim: StandardMaterial;
  fillMesh: Mesh;
  rimMesh: Mesh;
  front: Mesh;
  /** The size the meshes were last shaped to. */
  length: number;
  half: number;
}

/**
 * A boss's lane (Magma Rift, Sunlance, Bramble Charge): the sim's line telegraph
 * drawn as it hits, flat at the boss and round at the far end, in the disc's
 * danger palette. Shaped to a default size here so the warm-up draws a real one.
 */
function buildTelegraphLane(scene: Scene, root: Mesh): void {
  const lane = new TransformNode(`${root.name}-lane`, scene);
  lane.parent = root;
  const n = LANE_ARC + 3;
  const fan: number[] = [];
  for (let i = 0; i < n; i++) fan.push(0, 1 + ((i + 1) % n), 1 + i);
  const ribbon: number[] = [];
  for (let k = 0; k < n * 4; k += 4) ribbon.push(k, k + 3, k + 2, k, k + 2, k + 1);
  const fill = dangerFill(scene, root);
  const rim = dangerRim(scene, root);
  const fillMesh = floorMesh(scene, "lane-fill", lane, n + 1, fan, fill);
  const rimMesh = floorMesh(scene, "lane-rim", lane, n * 4, ribbon, rim);
  rimMesh.position.y = 0.004;
  const front = MeshBuilder.CreateGround("lane-front", { width: 2, height: 1 }, scene);
  front.parent = lane;
  front.material = dangerFront(scene, root);
  front.isPickable = false;
  front.receiveShadows = false;
  front.position.y = 0.008;
  root.metadata = { lane, fill, rim, fillMesh, rimMesh, front, length: -1, half: -1 } satisfies LaneParts;
  updateTelegraphLane(root, 0, 0, 1, 4, 1);
}

/**
 * Turn a lane to its direction, shape it to its size when that changed (once per
 * lane), and run its front from the boss to the far end as the wind-up runs out.
 */
export function updateTelegraphLane(root: Mesh, progress: number, dirX: number, dirY: number, length: number, half: number): void {
  const parts = root.metadata as LaneParts | null;
  if (!parts?.lane) return;
  // The root may be turned by the shared yaw code; the lane answers to world axes.
  parts.lane.rotation.y = Math.atan2(dirX, dirY) - root.rotation.y;
  if (parts.length !== length || parts.half !== half) {
    parts.length = length;
    parts.half = half;
    const edge = laneEdge(length, half);
    const fillAt = [0, 0, length / 2];
    for (const [x, z] of edge) fillAt.push(x, 0, z);
    const rimAt: number[] = [];
    const w = LANE_RIM_WIDTH / 2;
    edge.forEach(([ax, az], i) => {
      const [bx, bz] = edge[(i + 1) % edge.length]!;
      const d = Math.hypot(bx - ax, bz - az) || 1;
      const nx = (-(bz - az) / d) * w;
      const nz = ((bx - ax) / d) * w;
      rimAt.push(ax - nx, 0, az - nz, ax + nx, 0, az + nz, bx + nx, 0, bz + nz, bx - nx, 0, bz - nz);
    });
    parts.fillMesh.updateVerticesData(VertexBuffer.PositionKind, fillAt, true);
    parts.rimMesh.updateVerticesData(VertexBuffer.PositionKind, rimAt, true);
  }
  const reach = length + half;
  const at = Math.min(Math.max(progress * reach, LANE_FRONT_DEPTH / 2), reach - LANE_FRONT_DEPTH / 2);
  const across = at <= length ? half : Math.sqrt(Math.max(0, half * half - (at - length) ** 2));
  parts.front.position.z = at;
  parts.front.scaling.set(Math.max(0.02, across), 1, LANE_FRONT_DEPTH);
  paintDanger(parts.fill, parts.rim, progress);
}

/** Segments round a ring telegraph. */
const RING_SEGMENTS = 64;

interface RingParts {
  fill: StandardMaterial;
  rim: StandardMaterial;
  fillMesh: Mesh;
  innerRim: Mesh;
  front: Mesh;
  /** The hole the fill was last shaped to, as a share of the outer edge. */
  hole: number;
}

/**
 * A boss's ring (Kiln Ring, after PoE1's Elder): the band between the hole and
 * the outer edge, built at an outer radius of 1 like the disc and scaled by the
 * renderer. The hole stays EMPTY, so the safe spot is the bare floor.
 */
function buildTelegraphRing(scene: Scene, root: Mesh): void {
  const fill = dangerFill(scene, root);
  const rim = dangerRim(scene, root);
  // Vertex 2j is the outer edge at segment j, 2j + 1 the hole's; wound counter-clockwise from above.
  const band: number[] = [];
  for (let j = 0; j < RING_SEGMENTS; j++) {
    const o = j * 2;
    const o2 = ((j + 1) % RING_SEGMENTS) * 2;
    band.push(o, o2, o2 + 1, o, o2 + 1, o + 1);
  }
  const fillMesh = floorMesh(scene, "ring-fill", root, RING_SEGMENTS * 2, band, fill);
  const torus = (name: string, material: StandardMaterial): Mesh => {
    const t = MeshBuilder.CreateTorus(name, { diameter: 2, thickness: 0.012, tessellation: RING_SEGMENTS }, scene);
    t.parent = root;
    t.material = material;
    t.isPickable = false;
    t.receiveShadows = false;
    return t;
  };
  torus("ring-rim-outer", rim);
  const innerRim = torus("ring-rim-inner", rim);
  const front = torus("ring-front", dangerFront(scene, root));
  root.metadata = { fill, rim, fillMesh, innerRim, front, hole: -1 } satisfies RingParts;
  updateTelegraphRing(root, 0, 0.5);
}

/** Shape a ring's hole when it changed (once per ring) and close its front from the outer edge in to the hole. */
export function updateTelegraphRing(root: Mesh, progress: number, hole: number): void {
  const parts = root.metadata as RingParts | null;
  if (!parts?.innerRim) return;
  if (parts.hole !== hole) {
    parts.hole = hole;
    const at: number[] = [];
    for (let j = 0; j < RING_SEGMENTS; j++) {
      const a = (2 * Math.PI * j) / RING_SEGMENTS;
      at.push(Math.cos(a), 0, Math.sin(a), Math.cos(a) * hole, 0, Math.sin(a) * hole);
    }
    parts.fillMesh.updateVerticesData(VertexBuffer.PositionKind, at, true);
    const h = Math.max(0.02, hole);
    parts.innerRim.scaling.set(h, 1, h);
  }
  const edge = Math.max(0.02, 1 - progress * (1 - hole));
  parts.front.scaling.set(edge, 1, edge);
  paintDanger(parts.fill, parts.rim, progress);
}

/** Ripples a brood mark sends out per second. */
const BROOD_RIPPLE_HZ = 1.6;

/**
 * Where Mother Vhal's brood rises: murky water stirring. Never the danger
 * palette, because it warns "something comes up here", not "this hurts".
 * Built at radius 1, like the disc.
 */
function buildBroodMark(scene: Scene, root: Mesh): void {
  const water = new StandardMaterial(`${root.name}-brood-fill`, scene);
  water.diffuseColor = new Color3(0, 0, 0);
  water.emissiveColor = new Color3(0.1, 0.13, 0.06);
  water.specularColor = new Color3(0, 0, 0);
  water.alpha = 0.35;
  water.backFaceCulling = false;
  const fill = MeshBuilder.CreateCylinder("brood-fill", { diameter: 2, height: 0.02, tessellation: 32 }, scene);
  fill.parent = root;
  fill.material = water;
  fill.isPickable = false;
  fill.receiveShadows = false;

  const stir = new StandardMaterial(`${root.name}-brood-ripple`, scene);
  stir.diffuseColor = new Color3(0, 0, 0);
  stir.emissiveColor = new Color3(0.3, 0.36, 0.18);
  stir.specularColor = new Color3(0, 0, 0);
  stir.alpha = 0.5;
  stir.alphaMode = 1; // ALPHA_ADD
  const ripples = [0, 1].map((i) => {
    const r = MeshBuilder.CreateTorus(`brood-ripple-${i}`, { diameter: 2, thickness: 0.03, tessellation: 32 }, scene);
    r.parent = root;
    r.material = stir;
    r.isPickable = false;
    r.receiveShadows = false;
    return r;
  });
  root.metadata = { ripples };
  updateBroodMark(root, 0);
}

/** Send a brood mark's rings out from its centre, each fading as it spreads; `seconds` is any steady clock. */
export function updateBroodMark(root: Mesh, seconds: number): void {
  const ripples = (root.metadata as { ripples?: Mesh[] } | null)?.ripples;
  if (!ripples) return;
  ripples.forEach((r, i) => {
    const phase = (seconds * BROOD_RIPPLE_HZ + i / ripples.length) % 1;
    const s = 0.15 + phase * 0.85;
    r.scaling.set(s, 1, s);
    r.visibility = 1 - phase;
  });
}

/** The decal a mark is drawn on, by its shape. A charge's path (`fromX`) is the renderer's own. */
export function markKind(e: SnapshotEntity): MeshKind {
  if (e.shape === "line") return "telegraphLane";
  if (e.shape === "ring") return "telegraphRing";
  return e.ability === BROOD_ABILITY ? "broodMark" : "telegraph";
}

/** Fill a mark's decal (`markKind`) to `progress`; a brood mark churns on `seconds`, any steady clock. */
export function updateMark(root: Mesh, kind: MeshKind | undefined, e: SnapshotEntity, progress: number, seconds: number): void {
  if (kind === "telegraphLane") updateTelegraphLane(root, progress, e.dirX ?? 0, e.dirY ?? 1, e.length ?? 0, e.radius ?? 0);
  else if (kind === "telegraphRing") updateTelegraphRing(root, progress, (e.inner ?? 0) / Math.max(e.radius ?? 1, 0.01));
  else if (kind === "broodMark") updateBroodMark(root, seconds);
  else updateTelegraph(root, progress);
}

/** Width of a charge's path on the floor: a lane, far narrower than the 2.2 hit disc it replaces. */
const CHARGE_PATH_WIDTH = 0.7;

/**
 * A charge's telegraph: a soft lane on the floor from the brute to where it
 * lands, instead of the disc. Built as a unit strip from the landing point
 * (z = 0) back to the brute (z = 1); updateChargePath turns and stretches it
 * each snapshot. Strongest at the landing end, gone at the brute and at both
 * edges, so no polygon edge is ever drawn.
 */
function buildChargePath(scene: Scene, root: Mesh): void {
  const along = [[0, 0.5], [0.06, 1], [0.5, 0.55], [1, 0]];
  const across = [[-0.5, 0], [-0.2, 0.7], [0, 1], [0.2, 0.7], [0.5, 0]];
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (const [z, a] of along) {
    for (const [x, b] of across) {
      positions.push(x!, 0, z!);
      colors.push(1, 1, 1, a! * b!);
    }
  }
  const cols = across.length;
  for (let r = 0; r < along.length - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const v = r * cols + c;
      indices.push(v, v + cols, v + 1, v + 1, v + cols, v + cols + 1);
    }
  }
  const path = new Mesh("telegraph-path", scene);
  Object.assign(new VertexData(), { positions, colors, indices }).applyToMesh(path);
  path.hasVertexAlpha = true;
  path.parent = root;
  path.isPickable = false;
  path.receiveShadows = false;
  // Lit like the disc's rim: colour from emissive alone, added onto the floor.
  const mat = new StandardMaterial(`${root.name}-tel-path`, scene);
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.specularColor = new Color3(0, 0, 0);
  mat.emissiveColor = new Color3(0.55, 0.16, 0.03);
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.disableDepthWrite = true;
  mat.alphaMode = 1; // ALPHA_ADD
  path.material = mat;
  root.metadata = { path: mat };
}

/**
 * Lay a charge's path from the brute (`from`, sim x/y) to the root, which
 * stands on the landing point, and light it as the wind-up runs out. No
 * `from` means the brute has arrived: nothing is left to warn about.
 * Mutates the existing mesh and material; no allocations per call.
 */
export function updateChargePath(root: Mesh, progress: number, from: { x: number; y: number } | undefined): void {
  const mat = (root.metadata as { path?: StandardMaterial } | null)?.path;
  const path = root.getChildMeshes(true)[0];
  if (!mat || !path) return;
  const dx = from ? from.x - root.position.x : 0;
  const dz = from ? from.y - root.position.z : 0;
  const length = Math.hypot(dx, dz);
  path.setEnabled(length > 0.05);
  if (length <= 0.05) return;
  // The root may be turned by the shared yaw code; the path answers to world axes.
  path.rotation.y = Math.atan2(dx, dz) - root.rotation.y;
  path.scaling.set(CHARGE_PATH_WIDTH, 1, length);
  mat.alpha = 0.35 + progress * 0.35;
  const flash = Math.max(0, (progress - 0.85) / 0.15);
  mat.emissiveColor.set(0.55 + flash * 0.45, 0.16 + flash * 0.76, 0.03 + flash * 0.73);
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
  // Lifted 0.2 above where the geometry says it belongs: the tear's lower feather
  // fades out under the floor plane, so a portal centred on its own half-height
  // reads as sunk into the ground rather than standing on it.
  const face = MeshBuilder.CreatePlane(`${root.name}-pi`, { width: 1.5, height: 2.7 }, scene);
  face.position.y = 1.32;
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

const BEAM_SHADER = "ecLootBeam";
const POOL_SHADER = "ecLootPool";

// Value noise that wraps every `period` cells along x, so the shimmer meets
// itself where the cylinder's UV seam closes instead of drawing a line up it.
const NOISE_GLSL = `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p, float period) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(vec2(mod(i.x, period), i.y));
    float b = hash(vec2(mod(i.x + 1.0, period), i.y));
    float c = hash(vec2(mod(i.x, period), i.y + 1.0));
    float d = hash(vec2(mod(i.x + 1.0, period), i.y + 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }`;

/**
 * The loot beam's shader: a hot near-white core inside a sheath of the rarity's
 * colour (PoE1's filter columns), with a slow shimmer rising through the sheath
 * (PoE2's wisps). The core is where the shaft faces the camera head on, read
 * across the shaft only, so a camera looking down still finds it.
 */
function registerBeamShaders(): void {
  if (Effect.ShadersStore[`${BEAM_SHADER}VertexShader`]) return;
  Effect.ShadersStore[`${BEAM_SHADER}VertexShader`] = `
    precision highp float;
    attribute vec3 position;
    attribute vec3 normal;
    attribute vec2 uv;
    uniform mat4 worldViewProjection;
    uniform mat4 world;
    uniform vec3 uCam;
    varying vec2 vUV;
    varying float vFacing;
    void main(void) {
      vec3 wp = (world * vec4(position, 1.0)).xyz;
      vec3 n = mat3(world) * normal;
      vec3 v = uCam - wp;
      vFacing = abs(dot(normalize(vec2(n.x, n.z) + 1e-5), normalize(vec2(v.x, v.z) + 1e-5)));
      vUV = uv;
      gl_Position = worldViewProjection * vec4(position, 1.0);
    }`;
  Effect.ShadersStore[`${BEAM_SHADER}FragmentShader`] = `
    precision highp float;
    uniform vec3 uColor;
    uniform float uLit;
    uniform float uTime;
    uniform float uPhase;
    varying vec2 vUV;
    varying float vFacing;
    ${NOISE_GLSL}
    void main(void) {
      float h = vUV.y;
      // Bright at the floor and run out by the top, slowly enough that the eye
      // watches it go: a fade done by half way reads as a beam someone cut.
      float fade = pow(1.0 - h, 1.7);
      float core = pow(vFacing, 14.0);
      float sheath = pow(vFacing, 1.4);
      float rise = noise(vec2(vUV.x * 6.0 + uPhase, h * 7.0 - uTime * 0.6 + uPhase), 6.0);
      float fine = noise(vec2(vUV.x * 12.0, h * 15.0 - uTime * 1.1 + uPhase), 12.0);
      float shimmer = 0.7 + 0.45 * rise + 0.15 * fine;
      float breathe = 0.9 + 0.1 * sin(uTime * 2.4 + uPhase);
      vec3 col = uColor * sheath * shimmer + vec3(1.0, 0.97, 0.9) * core;
      gl_FragColor = vec4(col * fade * uLit * breathe * 1.8, 1.0);
    }`;
  Effect.ShadersStore[`${POOL_SHADER}VertexShader`] = `
    precision highp float;
    attribute vec3 position;
    attribute vec2 uv;
    uniform mat4 worldViewProjection;
    varying vec2 vUV;
    void main(void) {
      vUV = uv;
      gl_Position = worldViewProjection * vec4(position, 1.0);
    }`;
  Effect.ShadersStore[`${POOL_SHADER}FragmentShader`] = `
    precision highp float;
    uniform vec3 uColor;
    uniform float uLit;
    uniform float uTime;
    uniform float uPhase;
    varying vec2 vUV;
    void main(void) {
      float r = length(vUV - 0.5) * 2.0;
      float glow = pow(clamp(1.0 - r, 0.0, 1.0), 2.2);
      float breathe = 0.85 + 0.15 * sin(uTime * 2.4 + uPhase);
      gl_FragColor = vec4(uColor * glow * uLit * breathe * 1.6, 1.0);
    }`;
}

function lootLightMaterial(scene: Scene, name: string, shader: string, attributes: string[]): ShaderMaterial {
  const mat = new ShaderMaterial(name, scene, shader, {
    attributes,
    uniforms: ["worldViewProjection", "world", "uCam", "uColor", "uLit", "uTime", "uPhase"],
    needAlphaBlending: true,
  });
  mat.alphaMode = 1; // ALPHA_ADD: light over the floor, never a mask on it
  mat.disableDepthWrite = true;
  mat.backFaceCulling = false;
  return mat;
}

/** Beacon colour per rarity, matched to the tooltip palette in hud/ItemTooltip.tsx. */
const GROUND_ITEM_COLOR: Record<string, [number, number, number]> = {
  normal: [0.78, 0.78, 0.78],
  magic: [0.56, 0.59, 1.0],
  rare: [0.9, 0.84, 0.29],
  unique: [0.69, 0.38, 0.15],
};

export interface BeamLook {
  /** Sheath colour; saturated above normal, or the bloom washes it to white. */
  color: [number, number, number];
  /** Overall energy. Intensity, not density (docs/09-reward-psychology.md 3):
   *  a unique is several junk beams, so the tiers spread instead of stepping. */
  lit: number;
  /** A pool of the same light on the floor, kept for drops worth turning for. */
  pool: boolean;
}

const BEAM_LOOKS: Record<string, BeamLook> = {
  normal: { color: [0.8, 0.8, 0.8], lit: 0.09, pool: false },
  magic: { color: [0.3, 0.42, 1.0], lit: 0.24, pool: false },
  rare: { color: [1.0, 0.84, 0.18], lit: 0.45, pool: true },
  unique: { color: [1.0, 0.3, 0.05], lit: 0.7, pool: true },
};

export function beamLook(rarity: string | undefined): BeamLook {
  return BEAM_LOOKS[rarity ?? "normal"] ?? BEAM_LOOKS["normal"]!;
}

interface GroundItemParts {
  beamMat: ShaderMaterial;
  poolMat: ShaderMaterial;
  pool: Mesh;
}

/** Tint a ground-item beacon by rarity, so a drop reads before its plate is. */
export function updateGroundItem(mesh: Mesh, rarity: string | undefined): void {
  const mat = mesh.material as StandardMaterial | null;
  if (!mat) return;
  const [r, g, b] = GROUND_ITEM_COLOR[rarity ?? "normal"] ?? GROUND_ITEM_COLOR["normal"]!;
  mat.diffuseColor = new Color3(r * 0.35, g * 0.35, b * 0.35);
  mat.emissiveColor = new Color3(r, g, b);
  const parts = mesh.metadata as GroundItemParts | null;
  if (!parts?.beamMat) return;
  const look = beamLook(rarity);
  // The phase comes off the mesh's own id, so a floor covered in drops never
  // shimmers in unison, which is the thing that WOULD be distracting.
  const t = (Date.now() % 3600000) / 1000;
  const phase = ((mesh.uniqueId ?? 0) * 1.7) % 6.283;
  const color = new Color3(...look.color);
  for (const m of [parts.beamMat, parts.poolMat]) {
    m.setColor3("uColor", color);
    m.setFloat("uLit", look.lit);
    m.setFloat("uTime", t);
    m.setFloat("uPhase", phase);
  }
  const cam = parts.beamMat.getScene().activeCamera;
  if (cam) parts.beamMat.setVector3("uCam", cam.position);
  parts.pool.setEnabled(look.pool);
}

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
    if (withCue) playPortalSfx(root, "portal-open");
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
    if (withCue) playPortalSfx(root, "portal-open");
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
  playPortalSfx(root, "portal-close");
  scalePortal(scene, root, PORTAL_CLOSE_MS, root.scaling.x, 0.001, () => {
    if (!root.isDisposed()) root.dispose();
  });
}

/** Portals live in the world, unlike menu cues: heard from where they stand. World
 * (x, z) is sim (x, y); the listener is the player, set by the soundscape. */
function playPortalSfx(root: Mesh, name: "portal-open" | "portal-close"): void {
  const source = root.getAbsolutePosition();
  playSfxAt(name, source.x, source.z);
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
  if (kind === "actor") ACTOR_BLOBS.set(root, quad);
}

/** The pool under an actor, so `keepGroundBlobFlat` can find it again. */
const ACTOR_BLOBS = new WeakMap<Mesh, Mesh>();

/**
 * Hold an actor's pool flat on the floor while his body leans over it.
 *
 * `SnapshotRenderer.lean` banks and pitches the ROOT, which pivots on the feet,
 * and the blob is a child of that root — so it tilted with him, drove one edge
 * below y=0, and the floor clipped the buried half off along a dead straight
 * line. It read as the shadow being sliced away in whichever direction he was
 * running, which is exactly what it was.
 *
 * Negated Euler angles rather than a true inverse: Babylon composes these in a
 * fixed order so the cancellation is not exact, but the lean tops out around
 * nine degrees and the residual on a radially symmetric gradient is not
 * something a pixel can show.
 */
export function keepGroundBlobFlat(root: Mesh, pitch: number, roll: number): void {
  const blob = ACTOR_BLOBS.get(root);
  if (blob) blob.rotation.set(-pitch, 0, -roll);
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
 * The disenchanter: a figure standing over a brazier, not a bench.
 *
 * PoE2 gives every hideout service a person to talk to, and a service you walk
 * up to and *ask* is worth more than furniture you rummage in — the shards are
 * the same either way, but someone handing them over is an event. The NPC is the
 * same wardrobe rig the player wears; there is no separate townsman look, so he
 * is drawn identically.
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
    rig.setLooks(VENDOR_LOOKS);
    rig.setLocomotion(0); // stand and breathe; he never goes anywhere
  }

  root.metadata = { markMat, interactKind: "vendor", ...(rig ? { rig } : {}) };
}

/** The disenchanter wears the whole Ember set, a robed caster, and holds nothing. */
export const VENDOR_LOOKS: Looks = looksForEquipment({
  helmet: { baseId: "base.ember_cowl" },
  chest: { baseId: "base.ember_robe" },
  gloves: { baseId: "base.ember_wraps" },
  boots: { baseId: "base.ember_slippers" },
});

/** Warm the ring at his feet when the cursor is on him. */
export function updateVendor(root: Mesh, hovered: boolean): void {
  const parts = root.metadata as { markMat?: StandardMaterial } | null;
  if (!parts?.markMat) return;
  const e = hovered ? 0.85 : 0.18;
  parts.markMat.emissiveColor.set(e, e * 0.68, e * 0.28);
  parts.markMat.alpha = hovered ? 0.85 : 0.5;
}

/**
 * A heap of coins, more of them the bigger the pile, heaped highest in the
 * middle. No beam: gold is the floor's everyday reward, and a beam is kept for
 * the items a filter would shout about. Nothing here is pickable, so a click on
 * a pile walks the player onto it, which is what collects it.
 */
function buildGoldPile(scene: Scene, root: Mesh, amount: number, jackpot: boolean): void {
  const coin = mat(scene, "gold-coin", 0.95, 0.72, 0.22, 0.45);
  coin.specularColor = new Color3(0.6, 0.5, 0.25);
  coin.specularPower = 32;
  const n = Math.min(14, 3 + Math.floor(Math.log2(Math.max(1, amount)))) + (jackpot ? 6 : 0);
  const heap = jackpot ? 0.06 : 0.03;
  for (let i = 0; i < n; i++) {
    const c = MeshBuilder.CreateCylinder(`${root.name}-coin${i}`, { diameter: 0.13, height: 0.022, tessellation: 12 }, scene);
    const r = 0.07 * Math.sqrt(i);
    const a = i * 2.39996; // golden angle, so no two coins line up
    c.position.set(Math.cos(a) * r, 0.012 + heap * (1 - i / n), Math.sin(a) * r);
    c.rotation.set((((i * 37) % 7) - 3) * 0.12, 0, (((i * 53) % 5) - 2) * 0.15);
    c.material = coin;
    c.isPickable = false;
    c.parent = root;
  }
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
 * white-hot and everything orange about it lives in its comet tail
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
  skillId?: string,
): Mesh {
  const mesh = buildMesh(scene, kind, name, at, species, skillId);
  // A look's own materials are named after it; shared ones (part-, glow-, mat-) are not.
  // mesh.dispose() leaves materials in the scene, so without this each one outlived its entity.
  const own = `${name}-`;
  mesh.onDisposeObservable.addOnce(() => {
    for (const m of scene.materials.filter((x) => x.name.startsWith(own))) m.dispose();
  });
  return mesh;
}

function buildMesh(
  scene: Scene,
  kind: MeshKind,
  name: string,
  at?: Vector3,
  species?: string,
  skillId?: string,
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
      // The player's `species` is his class's body.
      const rig = attachRig(scene, root, isBody(species) ? species : "male");
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

  if (kind === "telegraphLane") {
    const root = new Mesh(name, scene);
    buildTelegraphLane(scene, root);
    return root;
  }

  if (kind === "telegraphRing") {
    const root = new Mesh(name, scene);
    buildTelegraphRing(scene, root);
    return root;
  }

  if (kind === "broodMark") {
    const root = new Mesh(name, scene);
    buildBroodMark(scene, root);
    return root;
  }

  if (kind === "chargePath") {
    const root = new Mesh(name, scene);
    buildChargePath(scene, root);
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

  if (kind === "gold") {
    // `species` is the shared string channel; for gold it is `gold:<amount>:<jackpot 0|1>`.
    const [, amount, jackpot] = (species ?? "").split(":");
    const root = new Mesh(name, scene);
    root.metadata = { gold: true };
    // The authored heap from props.glb; the procedural coins stand in headless
    // and before the props load.
    const heap = new TransformNode(`${name}-heap`, scene);
    heap.parent = root;
    heap.rotation.y = root.uniqueId * 2.39996;
    if (jackpot === "1") heap.scaling.setAll(1.6);
    if (attachProp(scene, heap, "goldPile", true)) {
      for (const c of heap.getChildMeshes()) c.isPickable = false;
    } else {
      heap.dispose();
      buildGoldPile(scene, root, Number(amount) || 1, jackpot === "1");
    }
    return root;
  }

  if (kind === "groundItem") {
    // Beacon marker; the name plate over it is DOM (hud/LootLabels.tsx).
    const m = MeshBuilder.CreateCylinder(name, { diameter: 0.5, height: 0.3, tessellation: 6 }, scene);
    const itemMat = new StandardMaterial(`${name}-mat`, scene);
    itemMat.specularColor = new Color3(0, 0, 0);
    m.material = itemMat;
    // Light beam standing on the drop, the way PoE marks loot from across a room.
    // Every look lives in its shader (`registerBeamShaders`); the bloom pass draws
    // the same shader, so the tier and the colour survive the glow instead of
    // being blurred into one white column.
    registerBeamShaders();
    const beam = MeshBuilder.CreateCylinder(`${name}-beam`, {
      diameter: 0.09, height: BEAM_H, tessellation: 12, cap: Mesh.NO_CAP,
    }, scene);
    beam.parent = m;
    const at = beamTransform();
    beam.position.set(at.x, at.y, 0);
    beam.rotation.z = at.rz;
    beam.isPickable = false;
    const beamMat = lootLightMaterial(scene, `${name}-beam-mat`, BEAM_SHADER, ["position", "normal", "uv"]);
    beam.material = beamMat;
    // The floor pool: flat on the ground under the drop, not facing the camera.
    const pool = MeshBuilder.CreateDisc(`${name}-pool`, { radius: 0.7, tessellation: 24 }, scene);
    pool.parent = m;
    pool.rotation.x = Math.PI / 2;
    pool.position.y = -Y_LIFT.groundItem + 0.02;
    pool.isPickable = false;
    const poolMat = lootLightMaterial(scene, `${name}-pool-mat`, POOL_SHADER, ["position", "uv"]);
    pool.material = poolMat;
    const glow = scene.effectLayers?.find((l) => l.name === "glow") as GlowLayer | undefined;
    glow?.referenceMeshToUseItsOwnMaterial(beam);
    glow?.addExcludedMesh(pool);
    m.metadata = { beamMat, poolMat, pool } satisfies GroundItemParts;
    updateGroundItem(m, "normal");
    // The item itself lies on the floor. The hexagon stays only as the stand-in
    // for a base with no model, or a drop made before the wardrobe loaded.
    // `species` is the shared string channel; for a ground item it is the base id.
    if (attachGroundModel(scene, m, species, -Y_LIFT.groundItem)) m.isVisible = false;
    return m;
  }

  if (kind === "projectile" && fxProfile(skillId).arrow) {
    const arrow = buildArrow(scene, name);
    arrow.scaling.setAll(PROJECTILE_ARROW_SCALE);
    if (at) {
      arrow.position.copyFrom(at);
      arrow.computeWorldMatrix(true);
    }
    attachArrowStreak(scene, arrow, fxProfile(skillId));
    return arrow;
  }

  // Projectile heads key by skill too, or the first bolt built in a session
  // decides every later skill's head colour off its own cached material.
  const matName = kind === "projectile" ? `mat-projectile-${skillId ?? "default"}` : `mat-${kind}`;
  let m = scene.getMaterialByName(matName) as StandardMaterial | null;
  if (!m) {
    const [r, g, b] = FIRE_COLOR[kind];
    m = new StandardMaterial(matName, scene);
    m.diffuseColor = new Color3(r, g, b);
    m.specularColor = new Color3(0, 0, 0);
    m.disableLighting = true;
    if (kind === "projectile") {
      // Full emissive so the GlowLayer blooms the head instead of tinting it.
      m.emissiveColor = fxProfile(skillId).core.clone();
    } else {
      // Additive, radially masked, and crawling: the patch reads as ground
      // burning rather than as a translucent decal ending on a hard rim. The
      // dim diffuse under it is the hit area, which has to stay readable
      // between the cracks — it is gameplay information first.
      m.diffuseColor = new Color3(r * 0.22, g * 0.22, b * 0.22);
      m.alpha = CINDER_DISC_ALPHA;
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
  mesh.isPickable = false;
  if (at) {
    mesh.position.copyFrom(at);
    mesh.computeWorldMatrix(true); // the trail reads the bounding box, not the position
  }
  if (kind === "projectile") {
    mesh.material = m;
    attachBoltTrail(scene, mesh, fxProfile(skillId));
    return mesh;
  }
  // The shared material is the template; each patch wears its own copy so it can
  // catch and burn out on its own clock (`ground-fx.ts`). The copy goes with it.
  const own = groundMaterial(scene, `${name}-mat`, m);
  mesh.material = own;
  mesh.onDisposeObservable.addOnce(() => own.dispose());
  const embers = attachCinderFX(scene, mesh);
  // Scorch, fissures and rim erode with the patch, each on its own copy.
  for (const child of mesh.getChildMeshes(true)) {
    const worn = groundMaterial(scene, `${child.name}-mat`, child.material as StandardMaterial);
    child.material = worn;
    child.onDisposeObservable.addOnce(() => worn.dispose());
  }
  mesh.metadata = { embers };
  return mesh;
}

/**
 * Every projectile look built once behind the loading plate and dropped when the
 * scene is ready, so a class's first shot compiles nothing: on a cold cache the
 * arrow's one-axis wake and the bolt's trail were each a first-cast stall.
 */
export function warmProjectiles(scene: Scene): void {
  for (const skillId of Object.keys(SKILL_FX)) {
    const mesh = makeMesh(scene, "projectile", `warm-projectile-${skillId}`, Vector3.Zero(), undefined, skillId);
    if (fxProfile(skillId).arrow) setStreakLength(mesh, 0.5);
    for (const part of [mesh, ...mesh.getChildMeshes()]) {
      part.alwaysSelectAsActiveMesh = true;
      part.computeWorldMatrix(true);
    }
    scene.executeWhenReady(() => mesh.dispose());
  }
}

export const WARM_LOOK_PREFIX = "warm-look-";

/**
 * One of everything the sim spawns mid-run, built behind the loading plate and
 * dropped when the scene is ready: each creature, telegraph, portal, gold heap
 * and floor model compiled its shaders on the frame it first appeared. Per area,
 * because each map's lights change the material variants. Released by the
 * caller once the plate settles, not on first ready: the fire pool switches its
 * lights on in the first frames, and a disabled light is its own variant.
 */
export function warmEntityLooks(scene: Scene): () => void {
  const species = creatureSpecies(scene);
  const looks: [MeshKind, string | undefined][] = [
    ["telegraph", undefined],
    ["telegraphLane", undefined],
    ["telegraphRing", undefined],
    ["broodMark", undefined],
    ["chargePath", undefined],
    ["groundArea", undefined],
    ["portal", undefined],
    ["gold", "gold:1:0"],
    ["gold", "gold:1:1"],
    ...(species.length > 0 ? species : [undefined]).map((s): [MeshKind, string | undefined] => ["monster", s]),
    ...GROUND_LOOK_BASES.map((b): [MeshKind, string | undefined] => ["groundItem", b]),
  ];
  // Twice: a flinch's squash, a telegraph's radius or a parent's lean is a
  // non-uniform scale, which is its own shader variant (NONUNIFORMSCALING).
  const meshes = [...looks, ...looks].map(([kind, look], i) => {
    const mesh = makeMesh(scene, kind, `${WARM_LOOK_PREFIX}${i}`, Vector3.Zero(), look);
    if (i >= looks.length) mesh.scaling.y *= 0.98;
    for (const part of [mesh, ...mesh.getChildMeshes()]) {
      part.alwaysSelectAsActiveMesh = true;
      part.computeWorldMatrix(true);
    }
    return mesh;
  });
  return () => {
    for (const mesh of meshes) {
      creatureOf(mesh)?.dispose();
      mesh.dispose();
    }
  };
}
