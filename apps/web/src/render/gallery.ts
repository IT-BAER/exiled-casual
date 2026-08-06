import { Mesh, Vector3, type Scene } from "@babylonjs/core";
import { MONSTERS } from "@exiled/content-runtime";
import { attachProp, PROP_KINDS } from "./props";
import { attachCreature } from "./monsters";

/**
 * Every mesh in the game, stood in rows on the floor (F4).
 *
 * A prop is placed by the hideout's decor list and a creature only exists where
 * its biome spawns it, so seeing all of them meant opening five maps and killing
 * nothing. This lays the whole library out at the player's feet instead: props
 * first in the order `props.glb` carries them, then one of every species from
 * `monsters.glb`, each breathing its idle.
 *
 * Nothing here touches the sim. These are render-only meshes with no collision,
 * no pick and no snapshot entity behind them, so the player walks straight
 * through the exhibition and it disappears with the next press.
 */

/** Prefix every gallery root takes, so one pass can find and drop the set. */
const GALLERY_PREFIX = "asset-gallery-";

/**
 * Floor spacing and row width.
 *
 * The camera shows about 19 units across, so six columns at three units is one
 * screen wide: the row he is standing in fills the frame and the rest is a step
 * away. Tighter and the behemoths overlap their neighbours.
 */
const SPACING = 3;
const COLUMNS = 6;

/**
 * Where exhibit `i` stands, given where the player is.
 *
 * Centred across the columns and laid out AWAY from him: row 0 starts one full
 * spacing ahead, so nothing is ever placed inside his own body, and every row
 * after that walks further out.
 */
export function galleryCell(i: number, at: Vector3): { x: number; z: number } {
  const col = i % COLUMNS;
  const row = Math.floor(i / COLUMNS);
  return {
    x: at.x + (col - (COLUMNS - 1) / 2) * SPACING,
    z: at.z + (row + 1) * SPACING,
  };
}

/** Whether the exhibition is currently standing. */
export function isGalleryOpen(scene: Scene): boolean {
  return scene.meshes.some((m) => m.name.startsWith(GALLERY_PREFIX));
}

/**
 * Put the library up, or take it down if it is already up. Returns the state it
 * left the scene in, so the caller can label a key without tracking it.
 *
 * `at` is where the player is standing; the grid is laid out in front of him
 * rather than around him, so nothing spawns inside his own body.
 */
export function toggleGallery(scene: Scene, at: Vector3): boolean {
  if (isGalleryOpen(scene)) {
    clearGallery(scene);
    return false;
  }

  const entries: { name: string; stand: (root: Mesh) => boolean }[] = [
    ...PROP_KINDS.map((kind) => ({
      name: kind,
      stand: (root: Mesh) => attachProp(scene, root, kind) !== null,
    })),
    ...[...MONSTERS.keys()].map((defId) => ({
      name: defId,
      stand: (root: Mesh) => attachCreature(scene, root, defId) !== null,
    })),
  ];

  const placed: { name: string; x: number; z: number }[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const { x, z } = galleryCell(i, at);
    const root = new Mesh(`${GALLERY_PREFIX}${i}-${entry.name}`, scene);
    root.position.set(x, 0, z);
    root.isPickable = false;
    if (!entry.stand(root)) {
      // The asset never loaded (headless, or a failed fetch). Leave a gap
      // rather than a greybox: the point of this mode is judging the real art.
      root.dispose(false, false);
      continue;
    }
    for (const mesh of root.getChildMeshes()) {
      mesh.isPickable = false;
      mesh.receiveShadows = true;
    }
    placed.push({ name: entry.name, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 });
  }

  // The only labelling there is. A name plate over each one would be a second
  // HUD to maintain for a mode only he uses, and the console can be read
  // beside the window.
  if (placed.length > 0) console.table(placed);
  return placed.length > 0;
}

/** Take the exhibition down. Safe on a scene that never had one. */
export function clearGallery(scene: Scene): void {
  for (const node of [...scene.transformNodes, ...scene.meshes]) {
    if (node.name.startsWith(GALLERY_PREFIX)) node.dispose(false, false);
  }
}
