import { Mesh, Vector3, type Scene } from "@babylonjs/core";
import { MONSTERS } from "@exiled/content-runtime";
import { attachProp, PROP_KINDS, type PropKind } from "./props";
import { attachCreature } from "./monsters";

/**
 * Standing one asset up in front of the player, on request (F4).
 *
 * A prop is placed by the hideout's decor list and a creature only exists where
 * its biome spawns it, so looking at a particular one meant opening five maps
 * and hoping. This puts any of them on the floor at his feet instead.
 *
 * Nothing here touches the sim. These are render-only meshes with no collision,
 * no pick and no snapshot entity behind them, so the player walks straight
 * through the exhibit and it goes when he clears it.
 */

/** Prefix every spawned root takes, so one pass can find and drop the set. */
const GALLERY_PREFIX = "asset-gallery-";

/**
 * Floor spacing and row width.
 *
 * The camera shows about 19 units across, so six columns at three units is one
 * screen wide: the row he is standing in fills the frame and the next is a step
 * away. Tighter and the behemoths overlap their neighbours.
 */
const SPACING = 3;
const COLUMNS = 6;

export interface Spawnable {
  /** What `spawn` is called with. */
  id: string;
  /** What the menu shows. */
  label: string;
  group: "Props" | "Creatures";
}

/** Everything the game has a mesh for, in the order the two files carry them. */
export const SPAWNABLE: readonly Spawnable[] = [
  ...PROP_KINDS.map((kind) => ({ id: kind, label: kind, group: "Props" as const })),
  ...[...MONSTERS.keys()].map((defId) => ({
    id: defId,
    // `monster.cinder_imp.v1` is a wire id, not a name to read off a button.
    label: defId.replace(/^monster\./, "").replace(/\.v\d+$/, "").replace(/_/g, " "),
    group: "Creatures" as const,
  })),
];

/**
 * Where exhibit `i` stands, given where the player is.
 *
 * Centred across the columns and laid out AWAY from him: the first one stands a
 * full spacing ahead, so nothing is ever placed inside his own body, and each
 * row after that walks further out.
 */
export function galleryCell(i: number, at: Vector3): { x: number; z: number } {
  const col = i % COLUMNS;
  const row = Math.floor(i / COLUMNS);
  return {
    x: at.x + (col - (COLUMNS - 1) / 2) * SPACING,
    z: at.z + (row + 1) * SPACING,
  };
}

/** How many exhibits are standing. Also the index the next one takes. */
export function gallerySize(scene: Scene): number {
  return scene.meshes.filter((m) => m.name.startsWith(GALLERY_PREFIX)).length;
}

/**
 * Stand one asset up at the next free spot. False when the asset has not loaded
 * (headless, or a failed fetch), which leaves the floor empty rather than
 * putting a greybox where the point was to judge the real art.
 */
export function spawnAsset(scene: Scene, id: string, at: Vector3): boolean {
  const index = gallerySize(scene);
  const cell = galleryCell(index, at);
  const root = new Mesh(`${GALLERY_PREFIX}${index}-${id}`, scene);
  root.position.set(cell.x, 0, cell.z);
  root.isPickable = false;

  const isProp = (PROP_KINDS as readonly string[]).includes(id);
  const stood = isProp
    ? attachProp(scene, root, id as PropKind, true) !== null
    : attachCreature(scene, root, id) !== null;
  if (!stood) {
    root.dispose(false, false);
    return false;
  }
  for (const mesh of root.getChildMeshes()) {
    mesh.isPickable = false;
    mesh.receiveShadows = true;
  }
  return true;
}

/** Take every exhibit down. Safe on a scene that never had one. */
export function clearGallery(scene: Scene): void {
  for (const node of [...scene.transformNodes, ...scene.meshes]) {
    if (node.name.startsWith(GALLERY_PREFIX)) node.dispose(false, false);
  }
}
