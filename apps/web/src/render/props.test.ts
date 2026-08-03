import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PROP_KINDS } from "./props";

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
      "brazier_coal", "stash_chest", "loot_chest",
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
    // Raised from 1.2MB when the two downloaded chests (stash, lootChest) came in.
    expect(glb.byteLength).toBeLessThan(1_500_000);
  });
});
