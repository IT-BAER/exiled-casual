import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * `props.glb` is built offline by `tools/build_props.py`, and the runtime finds
 * everything in it by name: `attachProp` keeps the subtree called `mapDevice` or
 * `stash`, and `meshes.ts` reaches for the materials by the names below to drive
 * hover. Nothing checks that spelling at build time, so a renamed node in the
 * Blender script would surface only as a prop that stopped lighting up — or, for
 * a renamed root, as a prop that silently fell back to its greybox. This pins the
 * two together.
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

  it("ships both props as named roots", () => {
    const roots = json.nodes.filter((n) => n.mesh === undefined && (n.children?.length ?? 0) > 0);
    expect(roots.map((n) => n.name)).toEqual(expect.arrayContaining(["mapDevice", "stash"]));
  });

  /** The exact keys `buildMapDevice` and `buildStash` look up in the asset. */
  it("names the materials the hover code drives", () => {
    const names = json.materials.map((m) => m.name);
    for (const wanted of ["brass_top", "brass_side", "chest_wood", "iron", "stone"]) {
      expect(names).toContain(wanted);
    }
  });

  it("gives every prop mesh a material", () => {
    for (const mesh of json.meshes) {
      for (const prim of mesh.primitives) expect(prim.material).toBeTypeOf("number");
    }
  });

  /**
   * The four 1024 PNG masters embed as ~10MB. They are downscaled and re-encoded
   * on the way in, and this is what notices if that step is ever dropped: two
   * hideout props are not worth more bytes than the character.
   */
  it("embeds compressed textures and stays small", () => {
    for (const image of json.images) expect(image.mimeType).toBe("image/jpeg");
    expect(glb.byteLength).toBeLessThan(1_200_000);
  });
});
