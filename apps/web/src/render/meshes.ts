import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Texture,
  type Scene,
  type Vector3,
} from "@babylonjs/core";
import { attachProp } from "./props";
import { attachBoltTrail, attachCinderFX, cinderGlow } from "./skill-fx";
import { attachRig, rigOf, type RigParts } from "./rig";

export type MeshKind = "player" | "monster" | "rare" | "boss" | "projectile" | "groundArea" | "telegraph" | "portal" | "mapDevice" | "stash" | "vendor" | "groundItem";

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
  limbs: { mesh: Mesh; offset: number; amp: number }[];
  /** How far the body rises on each step. */
  bob: number;
  /** Rares only: the ground disc whose colour names their element. */
  auraMat?: StandardMaterial;
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
 * Standing elliptical portal — a vertical void framed by a blazing rim.
 * The disc + torus are rotated 90° on X so they stand upright in world space;
 * scaling.z stretches them from circular to elliptical (local Z → world Y
 * after the rotation). entity.yaw is applied by the renderer post-syncMesh.
 */
function buildPortal(scene: Scene, root: Mesh): void {
  // per-instance so each portal can pulse and hover-highlight independently
  const voidMat = new StandardMaterial(`${root.name}-portal-void`, scene);
  voidMat.diffuseColor = new Color3(0, 0, 0);
  voidMat.emissiveColor = new Color3(0.02, 0.02, 0.10); // deep near-black navy void
  voidMat.specularColor = new Color3(0, 0, 0);
  voidMat.backFaceCulling = false; // visible from both sides; it's a window into void

  const rimMat = new StandardMaterial(`${root.name}-portal-rim`, scene);
  rimMat.diffuseColor = new Color3(0, 0, 0);
  // Starting value; updatePortal drives this each frame. Set high so the GlowLayer
  // has enough emissive energy to produce a real bloom halo.
  rimMat.emissiveColor = new Color3(0.85, 0.92, 1.0);
  rimMat.specularColor = new Color3(0, 0, 0);

  // Tight warm-blue ground pool — soft and transparent so the stone reads through.
  // alpha + additive rendering produces a light-bleed look rather than opaque paint.
  const bloomMat = new StandardMaterial(`${root.name}-portal-bloom`, scene);
  bloomMat.diffuseColor = new Color3(0, 0, 0);
  bloomMat.emissiveColor = new Color3(0.08, 0.12, 0.45); // cool blue, not violet
  bloomMat.specularColor = new Color3(0, 0, 0);
  bloomMat.alpha = 0.18; // subtle — readable stone beneath; standard alpha-blend is the default

  // Void face: diameter=1.2, scaling.z=1.75 → 1.2 units wide × 2.1 units tall ellipse.
  // Six portals on a ~3.5u-radius arc have ~3.7u spacing; 1.2u wide avoids overlap.
  // After rotation.x=π/2, local-Z→world-Y; position.y = half-height = 0.6×1.75 = 1.05.
  const inner = MeshBuilder.CreateCylinder(`${root.name}-pi`, { diameter: 1.2, height: 0.02, tessellation: 36 }, scene);
  inner.rotation.x = Math.PI / 2;
  inner.scaling.z = 1.75;
  inner.position.y = 1.05; // 0.6 * 1.75 — bottom flush with ground
  inner.parent = root;
  inner.material = voidMat;
  inner.receiveShadows = false;

  // Blazing rim: torus matches the inner ellipse dimensions.
  // ponytail: non-uniform torus scale distorts tube cross-section slightly; fine at this size.
  const rim = MeshBuilder.CreateTorus(`${root.name}-pr`, { diameter: 1.2, thickness: 0.15, tessellation: 48 }, scene);
  rim.rotation.x = Math.PI / 2;
  rim.scaling.z = 1.75;
  rim.position.y = 1.05;
  rim.parent = root;
  rim.material = rimMat;
  rim.receiveShadows = false;

  // Small ground bloom disc — 1.4u diameter (just wider than the portal), very faint.
  const bloom = MeshBuilder.CreateCylinder(`${root.name}-pb`, { diameter: 1.4, height: 0.02, tessellation: 24 }, scene);
  bloom.position.y = 0.01;
  bloom.parent = root;
  bloom.material = bloomMat;
  bloom.receiveShadows = false;

  // interactKind lets bindings.ts identify a picked portal child without the snapshot
  root.metadata = { rimMat, voidMat, interactKind: "portal" };
}

/** World height of the loot beam, in the same units as the actors (~1.8 tall). */
const BEAM_H = 2.4;

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
  grad.addColorStop(0.55, "#555");
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
    beamMat.emissiveColor = new Color3(r, g, b);
    // Junk barely glows, a unique is visible across the room. Same idea as a
    // NeverSink filter turning the beam up with the tier.
    beamMat.alpha = BEAM_ALPHA[rarity ?? "normal"] ?? BEAM_ALPHA["normal"]!;
  }
}

const BEAM_ALPHA: Record<string, number> = {
  normal: 0.18,
  magic: 0.34,
  rare: 0.48,
  unique: 0.62,
};

/**
 * Pulse the portal rim and indicate inRange affordance.
 * Called every apply() so the animation is driven off real time without needing
 * a render-timestamp parameter. Mutates material properties only — no allocs.
 */
export function updatePortal(root: Mesh, hovered: boolean): void {
  const parts = root.metadata as { rimMat: StandardMaterial } | null;
  if (!parts?.rimMat) return;
  // ponytail: Date.now() as animation clock — cheap and always available; upgrade
  // to a passed render-time argument if sub-frame precision ever matters.
  const t = Date.now() / 1000;
  const pulse = 0.88 + 0.12 * Math.sin(t * 1.8);
  // Base brightness: high so the GlowLayer has enough energy for real bloom.
  // Hovered: push into near-white so the pickup is unmistakable.
  const base = hovered ? 1.0 : 0.78;
  parts.rimMat.emissiveColor.set(
    pulse * base * 0.85,  // slight blue-white tint
    pulse * base * 0.92,
    pulse * base * 1.0,
  );
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
  const asset = attachProp(scene, root, "stash");
  if (asset) {
    root.metadata = { iron: asset["iron"], interactKind: "stash" };
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
  const iron = new StandardMaterial(`${root.name}-vn-iron`, scene);
  iron.diffuseColor = new Color3(0.15, 0.14, 0.14);
  iron.emissiveColor = new Color3(0.03, 0.03, 0.03);
  iron.specularColor = new Color3(0.7, 0.68, 0.6);
  iron.specularPower = 96;

  const stone = new StandardMaterial(`${root.name}-vn-stone`, scene);
  stone.diffuseColor = new Color3(0.17, 0.16, 0.15);
  stone.specularColor = new Color3(0.1, 0.1, 0.1);

  // The embers are the one thing here that emits: it is what tells you at a
  // glance which service eats items and which one stores them.
  const ember = new StandardMaterial(`${root.name}-vn-ember`, scene);
  ember.diffuseColor = new Color3(0.35, 0.11, 0.03);
  ember.emissiveColor = new Color3(0.9, 0.34, 0.08);
  ember.specularColor = new Color3(0, 0, 0);

  // Brazier at his side: a stone foot, an iron bowl, coals filled to the brim.
  const foot = MeshBuilder.CreateCylinder(`${root.name}-vn-foot`, { diameterTop: 0.2, diameterBottom: 0.34, height: 0.52, tessellation: 14 }, scene);
  foot.position.set(0.62, 0.26, 0.06);
  foot.parent = root;
  foot.material = stone;

  const bowl = MeshBuilder.CreateCylinder(`${root.name}-vn-bowl`, { diameterTop: 0.46, diameterBottom: 0.26, height: 0.2, tessellation: 16 }, scene);
  bowl.position.set(0.62, 0.6, 0.06);
  bowl.parent = root;
  bowl.material = iron;

  const coals = MeshBuilder.CreateCylinder(`${root.name}-vn-coals`, { diameter: 0.4, height: 0.03, tessellation: 16 }, scene);
  coals.position.set(0.62, 0.7, 0.06);
  coals.parent = root;
  coals.material = ember;

  // The man himself. Null when the models have not loaded (headless tests, a
  // failed fetch), which leaves the brazier standing alone — still visible,
  // still interactable, still obviously the place where things are burnt down.
  const rig = attachRig(scene, root);
  if (rig) {
    rig.setLooks({ helmet: "hood", body: "commoner", gloves: null, boots: "commoner", belt: null });
    rig.setLocomotion(0); // stand and breathe; he never goes anywhere
  }

  root.metadata = { iron, ember, interactKind: "vendor", ...(rig ? { rig } : {}) };
}

/** Blow on the coals when the cursor is over him, and warm the brazier's iron. */
export function updateVendor(root: Mesh, hovered: boolean): void {
  const parts = root.metadata as { iron: StandardMaterial; ember: StandardMaterial } | null;
  if (!parts?.iron) return;
  const e = hovered ? 0.26 : 0.03;
  parts.iron.emissiveColor.set(e, e * 0.72, e * 0.3);
  const g = hovered ? 1.35 : 0.9;
  parts.ember.emissiveColor.set(g, g * 0.38, g * 0.09);
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
export function makeMesh(scene: Scene, kind: MeshKind, name: string, at?: Vector3): Mesh {
  // ponytail: each actor is assembled from ~10 primitive parts per instance
  // (shared materials, but geometry is not GPU-instanced). Fine for a lab-sized
  // fight; if a large imp swarm tanks FPS, build one template per kind and
  // clone/thin-instance it instead.
  if (kind === "player" || kind === "monster" || kind === "rare" || kind === "boss") {
    const root = new Mesh(name, scene); // empty container; renderer positions this
    if (kind === "player") {
      // Skinned humanoid when its assets loaded; the primitive caster is the
      // fallback for headless tests and for a failed model fetch.
      const rig = attachRig(scene, root);
      if (rig) root.metadata = { rig } satisfies RigParts;
      else buildCaster(scene, root);
    } else if (kind === "boss") {
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

  if (kind === "groundItem") {
    // Beacon marker; the name plate over it is DOM (hud/LootLabels.tsx).
    const m = MeshBuilder.CreateCylinder(name, { diameter: 0.5, height: 0.3, tessellation: 6 }, scene);
    const itemMat = new StandardMaterial(`${name}-mat`, scene);
    itemMat.specularColor = new Color3(0, 0, 0);
    m.material = itemMat;
    // Light beam standing on the drop, the way PoE marks loot from across a room.
    // Additive so it glows over the floor instead of masking it, and unlit so it
    // keeps its rarity colour in a dark map.
    const beam = MeshBuilder.CreateCylinder(`${name}-beam`, { diameter: 0.2, height: BEAM_H, tessellation: 10 }, scene);
    beam.parent = m;
    beam.position.y = BEAM_H / 2;
    beam.isPickable = false;
    const beamMat = new StandardMaterial(`${name}-beam-mat`, scene);
    beamMat.diffuseColor = new Color3(0, 0, 0);
    beamMat.specularColor = new Color3(0, 0, 0);
    beamMat.alpha = 0.45;
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
