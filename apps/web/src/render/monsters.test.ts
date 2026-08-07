import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MONSTERS } from "@exiled/content-runtime";
import { partOfCreature, CreatureRig } from "./monsters";
import { warmContainer } from "./warm-shaders";
import type { AnimationGroup, AssetContainer } from "@babylonjs/core";

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
  it("ships a walk, an idle and an attack for every creature, and nothing else", () => {
    const names = json.animations.map((a) => a.name);
    for (const root of species) {
      expect(names).toContain(`${root}|walk`);
      expect(names).toContain(`${root}|idle`);
      expect(names).toContain(`${root}|attack`);
    }
    expect(names.length).toBe(species.length * 3);
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
    expect(partOfCreature({ name: `${imp}|attack` }, imp), "the attack clip").toBe(true);
    expect(partOfCreature({ name: "__root__" }, imp), "the glTF wrapper").toBe(true);
    expect(partOfCreature({ name: "monster.vaal_husk.v1|walk" }, imp)).toBe(false);
    expect(partOfCreature({ name: "monster.vaal_husk.v1" }, imp)).toBe(false);
  });

  /**
   * The strike is a ONE-SHOT over locomotion, and its edge is the snapshot's
   * `attackTick` changing — never its value. Two things go wrong without this:
   * a creature first seen carrying an old swing greets the camera with one,
   * and locomotion drives the bones out from under the strike mid-clip.
   */
  it("plays the strike once on a change of attack tick, never on the first sight", () => {
    const started: string[] = [];
    const ends: (() => void)[] = [];
    const group = (name: string): AnimationGroup => ({
      name,
      speedRatio: 1,
      enableBlending: false,
      blendingSpeed: 0,
      start: (loop: boolean) => started.push(`${name}${loop ? "" : ":once"}`),
      stop: () => {},
      dispose: () => {},
      onAnimationGroupEndObservable: { addOnce: (fn: () => void) => ends.push(fn) },
    } as unknown as AnimationGroup);
    const species = "monster.cinder_imp.v1";
    const rig = new CreatureRig(
      ["walk", "idle", "attack"].map((c) => group(`${species}|${c}`)),
      species,
    );
    started.length = 0; // the constructor's arrival breath

    rig.noteAttack(120); // first report: seeds the edge, plays nothing
    expect(started).toEqual([]);

    rig.noteAttack(150);
    expect(started).toEqual([`${species}|attack:once`]);

    // Mid-strike, locomotion must not take the bones back.
    started.length = 0;
    rig.setLocomotion(3);
    expect(started).toEqual([]);

    // The clip ends, and the next locomotion call owns the body again.
    ends.forEach((fn) => fn());
    rig.setLocomotion(3);
    expect(started).toEqual([`${species}|walk`]);
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
   *
   * 6.75MB since the attack clip: seventeen more clips at fifteen frames each
   * measured 29KB in total, so the third clip per species is a rounding against
   * the mesh and the hides. The lever is still compression.
   */
  /**
   * The shader warm that ends the map-entry stall. Every instance of a species
   * shares one container material, so the effect is compiled ONCE against a
   * source mesh that wears it — one compile per distinct material, never per
   * mesh, and never on a material-less mesh. A regression that compiled per mesh
   * would warm forty shaders for seventeen materials and lengthen the plate for
   * nothing; one that fed a mesh not wearing the material would compile the
   * wrong defines and leave the stall in place.
   */
  it("compiles one shader per distinct material, on a mesh that wears it", async () => {
    const calls: { material: unknown; mesh: unknown }[] = [];
    const makeMat = (id: string) => {
      const self = {
        id,
        forceCompilationAsync(mesh: unknown) {
          calls.push({ material: self, mesh });
          return Promise.resolve();
        },
      };
      return self;
    };
    const a = makeMat("a");
    const b = makeMat("b");
    const container = {
      meshes: [
        { name: "m1", material: a },
        { name: "m2", material: a },
        { name: "m3", material: b },
        { name: "m4", material: null },
      ],
    } as unknown as AssetContainer;

    await warmContainer(container);

    expect(calls.length).toBe(2);
    for (const call of calls) {
      expect((call.mesh as { material: unknown }).material).toBe(call.material);
    }
  });

  it("embeds compressed textures and stays within budget", () => {
    for (const image of json.images) expect(image.mimeType).toBe("image/jpeg");
    expect(json.images.length).toBeLessThanOrEqual(12);
    expect(glb.byteLength).toBeLessThan(6_750_000);
  });
});
