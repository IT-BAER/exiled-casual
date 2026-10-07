/**
 * What a drop looks like lying on the floor: the item itself, the way PoE draws
 * a small model of every ground item under its label and beam.
 *
 * Gear is the piece the character wears, copied out of the wardrobe once per
 * base as a static mesh (no skeleton, so no skinning and no cloth solver) and
 * handed to each drop as instances: one draw per part, however many lie there.
 */
import {
  AssetContainer,
  Matrix,
  Mesh,
  TransformNode,
  Vector3,
  VertexBuffer,
  type Scene,
} from "@babylonjs/core";
import { canonicalBaseId } from "@exiled/content-runtime";
import { GEAR_LOOKS, type GearLook } from "./gear-looks";
import { attachProp, type PropKind } from "./props";
import { wardrobeFor } from "./rig";

export type GroundLook = { gear: GearLook } | { prop: PropKind };

/** Drops nobody wears, modelled in props.glb after their inventory icon. */
const PROP_LOOKS: Readonly<Record<string, PropKind>> = {
  "base.ironsworn_girdle": "beltIronsworn",
  "base.stalker_strap": "beltStalker",
  "base.ember_sash": "beltEmber",
  "base.ember_focus": "focusEmber",
  "currency.wisdom": "scrollWisdom",
  "currency.portal": "scrollPortal",
  "currency.transmutation": "orbTransmutation",
  "currency.augmentation": "orbAugmentation",
  "currency.elevation": "orbElevation",
  "currency.alchemy": "orbAlchemy",
  "currency.embers": "orbEmbers",
  "map.waystone": "waystone",
};

/** Every base that lies on the floor as its own model rather than the marker. */
export const GROUND_LOOK_BASES: readonly string[] = [...Object.keys(GEAR_LOOKS), ...Object.keys(PROP_LOOKS)];

export function groundLookFor(baseId: string | undefined): GroundLook | null {
  if (baseId === undefined) return null;
  const id = canonicalBaseId(baseId);
  const gear = GEAR_LOOKS[id];
  if (gear) return { gear };
  const prop = PROP_LOOKS[id];
  return prop ? { prop } : null;
}

/**
 * Not the item: skin pushed out under the cloth, and the leg pieces, which make
 * a body armour lying on the floor read as a body.
 */
const FILLER = /^(backing|gorget)/;
/** A drop is a token of the item, not the item at the size it is worn. */
export const FLOOR_SCALE = 0.6;
/** Held at a wrist angle, so their flattest side is not on an axis. */
const HELD: ReadonlySet<string> = new Set(["weapon1", "weapon2"]);
/** Worn upright, and set down upright. Everything else lies on its flattest side. */
const UPRIGHT: ReadonlySet<string> = new Set(["helmet", "boots"]);
/** Between the two gloves or boots of a pair, which the bind pose holds arm's length apart. */
const PAIR_GAP = 0.03;
const BONE_KINDS = [
  VertexBuffer.MatricesIndicesKind, VertexBuffer.MatricesWeightsKind,
  VertexBuffer.MatricesIndicesExtraKind, VertexBuffer.MatricesWeightsExtraKind,
];

function bake(parts: readonly Mesh[], m: Matrix): void {
  for (const p of parts) {
    p.bakeTransformIntoVertices(m);
    p.refreshBoundingInfo();
  }
}

function bounds(parts: readonly Mesh[]): { min: Vector3; max: Vector3 } {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of parts) {
    const b = p.getBoundingInfo().boundingBox;
    min.minimizeInPlace(b.minimum);
    max.maximizeInPlace(b.maximum);
  }
  return { min, max };
}

/**
 * The static floor copy of one gear base, resting on y=0 and centred on the
 * origin. Hidden: it is the source its instances draw from.
 */
export function floorParts(wardrobe: AssetContainer, baseId: string, gear: GearLook): Mesh[] {
  const prefix = `${gear.slot}.${gear.look}.`;
  const parts: Mesh[] = [];
  for (const src of wardrobe.meshes) {
    if (!(src instanceof Mesh) || !src.name.startsWith(prefix)) continue;
    const part = src.name.slice(prefix.length);
    if (FILLER.test(part)) continue;
    // The bind pose is the raw vertices under the import's own handedness root.
    const world = src.computeWorldMatrix(true).clone();
    const m = src.clone(`floor.${baseId}.${part}`, null, true)!;
    m.skeleton = null;
    // Unique BEFORE anything is stripped: the geometry is shared with the worn part.
    m.makeGeometryUnique();
    for (const k of BONE_KINDS) m.removeVerticesData(k);
    m.position.setAll(0);
    m.rotationQuaternion = null;
    m.rotation.setAll(0);
    m.scaling.setAll(1);
    bake([m], world);
    m.isVisible = false;
    m.isPickable = false;
    parts.push(m);
  }
  if (parts.length === 0) return parts;

  const pair = parts.filter((p) => /_[lr]$/.test(p.name));
  if (pair.length === 2 && gear.slot === "gloves") {
    // Held out at arm's length, fingers pointing away from each other: turn the
    // left one round so both point the same way, then lay them side by side.
    const left = pair.find((p) => p.getBoundingInfo().boundingBox.center.x < 0) ?? pair[0]!;
    const c = left.getBoundingInfo().boundingBox.center.clone();
    bake([left], Matrix.Translation(-c.x, -c.y, -c.z).multiply(Matrix.RotationY(Math.PI)).multiply(Matrix.Translation(c.x, c.y, c.z)));
    const all = bounds(pair);
    const cy = (all.min.y + all.max.y) / 2;
    pair.forEach((p, i) => {
      const b = p.getBoundingInfo().boundingBox;
      const half = (b.maximum.z - b.minimum.z) / 2;
      const side = i === 0 ? -1 : 1;
      bake([p], Matrix.Translation(-b.center.x, cy - b.center.y, side * (half + PAIR_GAP / 2) - b.center.z));
    });
  } else if (pair.length === 2) {
    const all = bounds(pair);
    const cz = (all.min.z + all.max.z) / 2;
    for (const p of pair) {
      const b = p.getBoundingInfo().boundingBox;
      const side = Math.sign(b.center.x) || 1;
      const half = (b.maximum.x - b.minimum.x) / 2;
      bake([p], Matrix.Translation(side * (half + PAIR_GAP / 2) - b.center.x, 0, cz - b.center.z));
    }
  }

  if (HELD.has(gear.slot)) {
    bake(parts, flattest(parts));
  } else if (!UPRIGHT.has(gear.slot)) {
    const { min, max } = bounds(parts);
    const e = max.subtract(min);
    // Depth thinnest: on its back, front up. Width thinnest: on its side.
    if (e.z <= e.x && e.z <= e.y) bake(parts, Matrix.RotationX(-Math.PI / 2));
    else if (e.x <= e.y) bake(parts, Matrix.RotationZ(Math.PI / 2));
  }

  const { min, max } = bounds(parts);
  bake(parts, Matrix.Translation(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2)
    .multiply(Matrix.Scaling(FLOOR_SCALE, FLOOR_SCALE, FLOOR_SCALE)));
  return parts;
}

/**
 * The turn that leaves the parts lowest, searched in 5 degree steps over a
 * sample of their vertices. Runs once per base per scene.
 */
function flattest(parts: readonly Mesh[]): Matrix {
  const pts: number[] = [];
  for (const p of parts) {
    const v = p.getVerticesData(VertexBuffer.PositionKind) ?? [];
    for (let i = 0; i < v.length; i += 3 * 16) pts.push(v[i]!, v[i + 1]!, v[i + 2]!);
  }
  const step = Math.PI / 36;
  let best = Matrix.Identity();
  let bestH = Infinity;
  for (let a = 0; a < Math.PI; a += step) {
    for (let b = 0; b < Math.PI; b += step) {
      const m = Matrix.RotationX(a).multiply(Matrix.RotationZ(b));
      // Row-vector convention: y' = x*m[1] + y*m[5] + z*m[9].
      const r = m.m;
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < pts.length; i += 3) {
        const y = pts[i]! * r[1]! + pts[i + 1]! * r[5]! + pts[i + 2]! * r[9]!;
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
      if (hi - lo < bestH) { bestH = hi - lo; best = m; }
    }
  }
  return best;
}

const masters = new WeakMap<Scene, Map<string, Mesh[]>>();

/**
 * Lay the drop's own model under `root`, `floorY` below it. False when there is
 * none to lay (an unmapped base, or the wardrobe has not loaded), which is the
 * caller's signal to keep its marker.
 */
export function attachGroundModel(scene: Scene, root: Mesh, baseId: string | undefined, floorY: number): boolean {
  const look = groundLookFor(baseId);
  if (!look || baseId === undefined) return false;
  const holder = (): TransformNode => {
    const h = new TransformNode(`${root.name}-floor`, scene);
    h.parent = root;
    h.position.y = floorY;
    // Each drop lands at its own angle; off the mesh id, so it is stable per drop.
    h.rotation.y = root.uniqueId * 2.39996;
    return h;
  };

  if ("prop" in look) {
    const h = holder();
    if (attachProp(scene, h, look.prop, true) === null) {
      h.dispose();
      return false;
    }
    for (const m of h.getChildMeshes()) m.isPickable = false;
    return true;
  }

  const wardrobe = wardrobeFor(scene);
  if (!wardrobe) return false;
  let byBase = masters.get(scene);
  if (!byBase) masters.set(scene, (byBase = new Map()));
  let parts = byBase.get(baseId);
  if (!parts || parts.some((p) => p.isDisposed())) {
    parts = floorParts(wardrobe, baseId, look.gear);
    byBase.set(baseId, parts);
  }
  if (parts.length === 0) return false;

  const h = holder();
  for (const p of parts) {
    const inst = p.createInstance(`${root.name}-${p.name}`);
    inst.parent = h;
    inst.isPickable = false;
  }
  return true;
}
