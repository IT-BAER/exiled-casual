import {
  LoadAssetContainerAsync,
  type AssetContainer,
  type Material,
  type Mesh,
  type Node,
  type Scene,
} from "@babylonjs/core";
import { warmContainer } from "./warm-shaders";

/**
 * The hideout props — the two interactables and the furniture — as one authored glTF.
 *
 * Both used to be stacks of Babylon primitives painted with flat colours, which
 * is a greybox no matter how many cylinders it is made of. `tools/build_props.py`
 * turns and sweeps the real shapes and dresses them in generated texture art;
 * this module is the runtime half: fetch the file once, hand out one instance
 * per prop, and give the builder back the materials its hover code drives.
 *
 * Failure is not fatal, exactly as with the character rig: headless tests and a
 * failed fetch leave `loaded` null and every caller falls back to the primitives
 * it always had, so the lab still runs and the stash is still clickable.
 */
const PROPS_URL = "/models/props.glb";

/**
 * glTF's own wrapper node. It carries the right-to-left-handed conversion, so an
 * instance is parented *with* it — reparenting a prop out of it mirrors the prop.
 */
const GLTF_ROOT = "__root__";

/**
 * Every root `props.glb` carries. The first two are interactables the sim spawns;
 * the rest are the hideout's furniture, placed by render/hideout.ts.
 */
export const PROP_KINDS = [
  "mapDevice", "stash",
  // The reward containers. `crate` and `barrel` are both map loot and hideout
  // decor: one downloaded mesh each, standing in for what used to be a banded
  // box and a lathe (meshes.ts still greyboxes all three when the fetch fails).
  "lootChest",
  "rug", "table", "bench", "crate", "barrel", "pillar",
  // The beach set, placed by render/level.ts along a coast's shoreline.
  "driftwood", "shell", "coastRock", "wreckTimber", "bones",
  // The one prop that is also a light. `render/lights.ts` finds these by their
  // root name and hangs a real point light over each bowl.
  "brazier",
] as const;

export type PropKind = (typeof PROP_KINDS)[number];

interface LoadedProps {
  scene: Scene;
  container: AssetContainer;
}

let loaded: LoadedProps | null = null;
let pending: Promise<void> | null = null;

/** Fetch the props once, before the render loop starts. */
export function loadProps(scene: Scene): Promise<void> {
  if (loaded?.scene === scene) return Promise.resolve();
  if (pending) return pending;

  pending = LoadAssetContainerAsync(PROPS_URL, scene)
    .then(async (container) => {
      // On the SOURCE, because a shared prop is an `InstancedMesh` and setting
      // this on one of those is a no-op that warns. Every prop in this file
      // stands on a floor the sun and the torch both light, so there is no kind
      // that wants it off, and a clone inherits it from here too.
      for (const mesh of container.meshes) mesh.receiveShadows = true;
      loaded = { scene, container };
      // The hideout dresses itself from this container on arrival — 186 active
      // meshes held out of the scene until then, whose shaders otherwise compile
      // as they first draw. That is the return-to-hideout ramp. Warm them here.
      await warmContainer(container);
    })
    .catch(() => {
      loaded = null;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

export function isPropsReady(scene: Scene): boolean {
  return loaded !== null && loaded.scene === scene;
}

/** Drop the cached container — the scene that owns it is going away. */
export function resetProps(): void {
  loaded = null;
  pending = null;
}

function isUnder(node: Node, name: string): boolean {
  for (let n: Node | null = node; n; n = n.parent) {
    if (n.name === name) return true;
  }
  return false;
}

/**
 * Parent one instance of `kind` under `root`, and return its materials by name
 * so the caller can wire them to its hover affordance.
 *
 * Null when the asset has not loaded, which is the signal to greybox instead.
 *
 * `shared` is the difference between a copy and an INSTANCE, and it is the whole
 * cost of a shadow frame. Babylon defaults `doNotInstantiate` to true, so a call
 * that passes only a predicate gets a full clone carrying its own cloned
 * materials — ninety plain meshes in the hideout, redrawn on each of a point
 * light's six cube faces, which measured 875 of the frame's 1241 draw calls. An
 * instance is ONE draw however many stand in the room. The price is that
 * instances share the source's materials, so only a caller that ignores the
 * return value may ask for it: tinting a shared material on hover would light
 * every crate in the area, not the one under the pointer.
 */
export function attachProp(
  scene: Scene, root: Mesh, kind: PropKind, shared = false,
): Record<string, Material> | null {
  if (!loaded || loaded.scene !== scene) return null;

  const entries = loaded.container.instantiateModelsToScene((n) => n, !shared, {
    // Prune the prop we did not ask for at the source. A rejected node takes its
    // whole subtree with it, so the other prop is never cloned — and neither are
    // the per-instance materials that would then have nothing to hang on.
    predicate: (e: Node) => e.name === GLTF_ROOT || isUnder(e, kind),
    doNotInstantiate: !shared,
  });

  const materials: Record<string, Material> = {};
  for (const node of entries.rootNodes) {
    node.parent = root;
    for (const mesh of node.getChildMeshes()) {
      if (mesh.material) materials[mesh.material.name] = mesh.material;
    }
  }
  return materials;
}
