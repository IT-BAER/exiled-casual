import {
  LoadAssetContainerAsync,
  type AssetContainer,
  type Material,
  type Mesh,
  type Node,
  type Scene,
} from "@babylonjs/core";

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
  "rug", "table", "bench", "crate", "barrel", "pillar",
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
    .then((container) => {
      loaded = { scene, container };
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
 */
export function attachProp(scene: Scene, root: Mesh, kind: PropKind): Record<string, Material> | null {
  if (!loaded || loaded.scene !== scene) return null;

  const entries = loaded.container.instantiateModelsToScene((n) => n, true, {
    // Prune the prop we did not ask for at the source. A rejected node takes its
    // whole subtree with it, so the other prop is never cloned — and neither are
    // the per-instance materials that would then have nothing to hang on.
    predicate: (e: Node) => e.name === GLTF_ROOT || isUnder(e, kind),
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
