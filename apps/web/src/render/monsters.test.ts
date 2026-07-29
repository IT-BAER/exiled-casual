import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MONSTERS } from "@exiled/content-runtime";
import { partOfCreature } from "./monsters";

/**
 * `monsters.glb` is built offline by `tools/build_monsters.py`, and the runtime
 * finds a creature in it by the monster def id the snapshot carries in
 * `SnapshotEntity.species`. Nothing checks that spelling at build time: a
 * renamed root in the Blender script, or a new species added to
 * `content-runtime` without a model, would surface only as a monster that
 * silently fell back to the primitive imp — which is the exact greyboxing this
 * asset exists to end. This pins the two lists together.
 */
describe("monsters asset", () => {
  const MODELS = fileURLToPath(new URL("../../public/models/", import.meta.url));
  const glb = readFileSync(`${MODELS}monsters.glb`);
  const json = JSON.parse(
    glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"),
  ) as {
    nodes: { name: string; mesh?: number; skin?: number; children?: number[] }[];
    meshes: { primitives: { material?: number; attributes: Record<string, number> }[] }[];
    materials: { name: string }[];
    images: { mimeType: string }[];
    skins: { joints: number[] }[];
    animations: { name: string }[];
  };
  const roots = json.nodes
    .filter((n) => n.mesh === undefined && (n.children?.length ?? 0) > 0)
    .map((n) => n.name);
  const species = roots.filter((n) => n.startsWith("monster."));

  it("ships a model for every monster the content defines", () => {
    for (const id of MONSTERS.keys()) expect(roots).toContain(id);
  });

  it("ships no model the content does not define", () => {
    for (const name of species) expect(MONSTERS.has(name)).toBe(true);
  });

  /**
   * Every creature is SKINNED. The first pass shipped each limb as its own rigid
   * object swung about one hip axis, which can only ever be a pendulum — no
   * knee, no ankle, no weight — and was rejected on sight. A creature with no
   * skin here has quietly regressed to that, and the symptom in the browser is
   * a monster that walks like a robot rather than one that does not walk.
   */
  it("ships one skinned mesh per creature, with a real leg chain in it", () => {
    for (const root of species) {
      const node = json.nodes.find((n) => n.name === root)!;
      const children = (node.children ?? []).map((i) => json.nodes[i]!);
      const mesh = children.find((c) => c.mesh !== undefined);
      expect(mesh, `${root} has no mesh`).toBeDefined();
      expect(mesh!.skin, `${root} is not skinned`).toBeTypeOf("number");

      const joints = json.skins[mesh!.skin!]!.joints.map((i) => json.nodes[i]!.name);
      // A leg has to be a CHAIN — hip, knee, ankle — or the knee cannot bend.
      const legs = joints.filter((j) => j.startsWith("leg"));
      expect(legs.length, `${root} has no leg bones`).toBeGreaterThanOrEqual(2);
      for (const bone of new Set(legs.map((j) => j.split("_")[0]))) {
        expect(legs.filter((j) => j.startsWith(`${bone}_`)).length,
          `${root}/${bone} is a single bone, not a chain`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  /**
   * The clips ride in this same file, one glTF animation per NLA track, named
   * `<species>|<clip>` — `CreatureRig` looks them up by that suffix. The
   * exporter's ACTIONS mode would instead offer every action to every armature
   * and ship all thirty-four clips seventeen times over, which still loads and
   * still animates, so only a name count catches it.
   */
  it("ships a walk and an idle for every creature, and nothing else", () => {
    const names = json.animations.map((a) => a.name);
    for (const root of species) {
      expect(names).toContain(`${root}|walk`);
      expect(names).toContain(`${root}|idle`);
    }
    expect(names.length).toBe(species.length * 2);
  });

  /**
   * The occlusion baked per vertex is the largest part of what makes these read
   * as sculpted rather than inflated, and it rides out as COLOR_0. It is also
   * the easiest thing to lose: the exporter drops it unless asked.
   */
  it("carries the baked occlusion as vertex colour, and the weights beside it", () => {
    for (const mesh of json.meshes) {
      for (const prim of mesh.primitives) {
        expect(prim.attributes).toHaveProperty("COLOR_0");
        expect(prim.attributes).toHaveProperty("JOINTS_0");
        expect(prim.attributes).toHaveProperty("WEIGHTS_0");
        expect(prim.material).toBeTypeOf("number");
      }
    }
  });

  /**
   * What survives instantiation. Babylon runs this predicate over skeletons and
   * animation groups as well as nodes, and neither has a parent to walk up, so
   * the obvious node-only version prunes the skeleton and both clips and leaves
   * a creature standing in its bind pose — with every other test in this file
   * still green, because the FILE is fine. Only this catches it.
   */
  it("keeps the species' skeleton and clips, not only its nodes", () => {
    const imp = "monster.cinder_imp.v1";
    expect(partOfCreature({ name: imp }, imp), "the skeleton").toBe(true);
    expect(partOfCreature({ name: `${imp}|walk` }, imp), "the walk clip").toBe(true);
    expect(partOfCreature({ name: `${imp}|idle` }, imp), "the idle clip").toBe(true);
    expect(partOfCreature({ name: "__root__" }, imp), "the glTF wrapper").toBe(true);
    expect(partOfCreature({ name: "monster.vaal_husk.v1|walk" }, imp)).toBe(false);
    expect(partOfCreature({ name: "monster.vaal_husk.v1" }, imp)).toBe(false);
  });

  /**
   * Seventeen creatures share four hide sheets and one bone material. If that
   * ever stops being true the file is carrying per-species textures, and the
   * download is the first thing a player waits on.
   *
   * The cap went from 4.5MB to 6.5MB when the roster was rigged, and that is a
   * real cost, not a rounding: a skinned vertex carries four joint indices and
   * four weights on top of its position, and the legs each grew a segment so
   * there is somewhere for a knee to be. Measured at the change: mesh 4.1MB,
   * textures 1.1MB, every clip in the file 0.5MB. Compression (KTX2 for the
   * hides, Draco or meshopt for the geometry) is the lever that moves this and
   * it is its own slice of work — the loading plate already sits over forty
   * seconds on Slow 3G with the models that were here before.
   */
  it("embeds compressed textures and stays within budget", () => {
    for (const image of json.images) expect(image.mimeType).toBe("image/jpeg");
    expect(json.images.length).toBeLessThanOrEqual(12);
    expect(glb.byteLength).toBeLessThan(6_500_000);
  });
});
