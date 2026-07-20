import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Texture,
  type Scene,
} from "@babylonjs/core";

export type MeshKind = "player" | "monster" | "rare" | "boss" | "projectile" | "groundArea" | "telegraph";

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
  projectile: 0.3,
  groundArea: 0.05,
  telegraph: 0.06,
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
}

/**
 * Advance one actor's walk cycle. `phase` is driven by distance travelled, not
 * by wall time, so the legs always keep up with the feet and never skate.
 * Everything eases toward its target, which is what smooths the stop.
 */
export function animateActor(root: Mesh, phase: number, moving: boolean): void {
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

const GREYBOX_COLOR: Record<"projectile" | "groundArea", [number, number, number]> = {
  projectile: [1.0, 0.9, 0.25], // yellow — ember bolt
  groundArea: [1.0, 0.42, 0.12], // ember — cinder ground disc
};

export function makeMesh(scene: Scene, kind: MeshKind, name: string): Mesh {
  // ponytail: each actor is assembled from ~10 primitive parts per instance
  // (shared materials, but geometry is not GPU-instanced). Fine for a lab-sized
  // fight; if a large imp swarm tanks FPS, build one template per kind and
  // clone/thin-instance it instead.
  if (kind === "player" || kind === "monster" || kind === "rare" || kind === "boss") {
    const root = new Mesh(name, scene); // empty container; renderer positions this
    if (kind === "player") buildCaster(scene, root);
    else if (kind === "boss") {
      // Darker charcoal rock, hotter lava glow, bright near-white eye.
      // Reuses rare_skin.png (boss_skin.png does not exist in public/textures/).
      // Low emissive on purpose: the reference look is a dark silhouette with hot
      // accents. At 0.85 the whole hide self-lit and the boss read as an orange blob.
      buildImp(scene, root, "boss", [0.18, 0.13, 0.11], 0.3, [1.0, 0.95, 0.8], "/textures/rare_skin.png");
      root.scaling.setAll(2.0);
    } else if (kind === "rare") {
      buildImp(scene, root, "rare", [0.42, 0.19, 0.06], 0.7, [1.0, 0.55, 0.15]);
      root.scaling.setAll(1.7); // elite: bigger than the common imp
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

  const matName = `mat-${kind}`;
  let m = scene.getMaterialByName(matName) as StandardMaterial | null;
  if (!m) {
    const [r, g, b] = GREYBOX_COLOR[kind];
    m = new StandardMaterial(matName, scene);
    m.diffuseColor = new Color3(r, g, b);
    m.emissiveColor = new Color3(r * 0.35, g * 0.35, b * 0.35);
    m.specularColor = new Color3(0, 0, 0);
    if (kind === "groundArea") m.alpha = 0.45; // see the floor through the disc
  }
  // groundArea built at diameter=2 (radius=1); renderer scales x/z to entity.radius.
  const mesh =
    kind === "projectile"
      ? MeshBuilder.CreateSphere(name, { diameter: 0.3 }, scene)
      : MeshBuilder.CreateCylinder(name, { diameter: 2, height: 0.1, tessellation: 24 }, scene);
  mesh.material = m;
  return mesh;
}
