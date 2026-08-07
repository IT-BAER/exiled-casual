import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Mesh, Scene } from "@babylonjs/core";
import { attachProp, loadProps, PROP_KINDS, resetProps } from "./props";

/**
 * The container the loader would hand back, with the one call this module makes
 * on it recorded. Hoisted because `vi.mock`'s factory runs before the file body.
 */
const fake = vi.hoisted(() => ({
  instantiate: vi.fn(
    (_name: unknown, _cloneMaterials: boolean, _options: { doNotInstantiate: boolean }) => ({
      rootNodes: [] as never[],
    }),
  ),
  sources: [{ receiveShadows: false }, { receiveShadows: false }],
}));

vi.mock("@babylonjs/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@babylonjs/core")>()),
  LoadAssetContainerAsync: () =>
    Promise.resolve({ meshes: fake.sources, instantiateModelsToScene: fake.instantiate }),
}));

/**
 * `props.glb` is built offline by `tools/build_props.py`, and the runtime finds
 * everything in it by name: `attachProp` keeps the subtree named after the prop it
 * was asked for, and `meshes.ts` reaches for the materials by the names below to
 * drive hover. Nothing checks that spelling at build time, so a renamed node in the
 * Blender script would surface only as a prop that stopped lighting up — or, for a
 * renamed root, as a prop that silently fell back to its greybox, or a piece of
 * hideout furniture that simply never appeared. This pins them together.
 */
describe("props asset", () => {
  const MODELS = fileURLToPath(new URL("../../public/models/", import.meta.url));
  const glb = readFileSync(`${MODELS}props.glb`);
  const json = JSON.parse(
    glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"),
  ) as {
    nodes: { name: string; mesh?: number; children?: number[] }[];
    meshes: { primitives: { material?: number }[] }[];
    materials: { name: string }[];
    images: { mimeType: string }[];
  };

  it("ships every prop as a named root", () => {
    const roots = json.nodes.filter((n) => n.mesh === undefined && (n.children?.length ?? 0) > 0);
    // The two the sim spawns, then the furniture render/hideout.ts places.
    expect(roots.map((n) => n.name)).toEqual(expect.arrayContaining([
      "mapDevice", "stash", "lootChest", "rug", "table", "bench", "crate", "barrel", "pillar", "brazier",
    ]));
  });

  /**
   * Every kind the client can ask for has to BE in the file. `attachProp` answers a
   * miss with an empty instantiate rather than a throw, so a typo on either side is
   * a prop that is simply not there.
   */
  it("carries a root for every PropKind the client knows", () => {
    const roots = new Set(
      json.nodes.filter((n) => n.mesh === undefined && (n.children?.length ?? 0) > 0).map((n) => n.name),
    );
    for (const kind of PROP_KINDS) expect(roots.has(kind), kind).toBe(true);
  });

  /** The exact keys `buildMapDevice` and `buildStash` look up in the asset. */
  it("names the materials the hover code drives", () => {
    const names = json.materials.map((m) => m.name);
    for (const wanted of [
      "brass_top", "brass_side", "chest_wood", "iron", "rug", "pillar_stone",
      "brazier_coal", "stash_chest", "loot_chest", "barrel_wood", "crate_wood",
    ]) {
      expect(names).toContain(wanted);
    }
  });

  it("gives every prop mesh a material", () => {
    for (const mesh of json.meshes) {
      for (const prim of mesh.primitives) expect(prim.material).toBeTypeOf("number");
    }
  });

  /**
   * The 1024 PNG masters embed as ~10MB each. They are downscaled and re-encoded on
   * the way in, and this is what notices if that step is ever dropped: the hideout's
   * furniture is not worth more bytes than the character who walks past it.
   */
  it("embeds compressed textures and stays small", () => {
    for (const image of json.images) expect(image.mimeType).toBe("image/jpeg");
    // Raised from 1.2MB when the two downloaded chests (stash, lootChest) came
    // in, again for the downloaded barrel and crate, again for the beach set
    // (driftwood, shell), and again for the wreck debris (wreckTimber, bones).
    // Each costs one 512 JPEG; a dropped downscale would cost ten megabytes,
    // which is what this number is really watching for.
    expect(glb.byteLength).toBeLessThan(2_100_000);
  });
});

/**
 * How a prop is REPLICATED, which is the whole cost of a shadow frame.
 *
 * Babylon defaults `doNotInstantiate` to true, so the original call — which only
 * passed a predicate — gave every prop a full clone with its own cloned
 * materials. Ninety plain meshes carrying ten materials' worth of geometry is
 * ninety draws on each of a point light's six cube faces, measured at 875 of the
 * hideout's 1241 draw calls. An instance is one draw however many stand in the
 * room, so anything whose materials nobody drives asks for `shared`.
 */
describe("attachProp replication", () => {
  const scene = {} as Scene;
  const root = {} as Mesh;

  beforeEach(async () => {
    resetProps();
    fake.instantiate.mockClear();
    for (const m of fake.sources) m.receiveShadows = false;
    await loadProps(scene);
  });

  /** The interactables: `meshes.ts` tints these materials on hover, so a shared
   *  one would light every crate in the area up with the one under the pointer. */
  it("clones materials for a prop whose hover code drives them", () => {
    attachProp(scene, root, "mapDevice");
    const [, cloneMaterials, options] = fake.instantiate.mock.calls[0]!;
    expect(cloneMaterials).toBe(true);
    expect(options.doNotInstantiate).toBe(true);
  });

  it("instantiates a shared prop against one material", () => {
    attachProp(scene, root, "table", true);
    const [, cloneMaterials, options] = fake.instantiate.mock.calls[0]!;
    expect(cloneMaterials).toBe(false);
    expect(options.doNotInstantiate).toBe(false);
  });

  /**
   * `InstancedMesh.receiveShadows` is a no-op that warns — the flag belongs to
   * the source. Set at load, so the call sites' existing per-child loop stays a
   * harmless no-op instead of silently leaving the furniture unlit.
   */
  it("makes the container's own meshes shadow receivers", () => {
    expect(fake.sources.map((m) => m.receiveShadows)).toEqual([true, true]);
  });
});
