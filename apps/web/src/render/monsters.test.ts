import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MONSTERS } from "@exiled/content-runtime";
import { toNumber } from "@exiled/fixed-point";
import { partOfCreature, CreatureRig, loadMonsters, isMonstersReady, attachCreature, resetMonsters } from "./monsters";
import { creatureOf, setHitFlash } from "./meshes";
import { hasRim } from "./rim";
import { createScene } from "./engine";
import { SnapshotRenderer } from "./renderer";
import { testPlayer } from "../test-fixtures";
import type { Snapshot, SnapshotEntity } from "@exiled/protocol";
import { FreeCamera, LoadAssetContainerAsync, Mesh, NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { contactPoint } from "./contact";
import { warmContainer } from "./warm-shaders";
import type { AnimationGroup, AssetContainer, InstantiatedEntries, TransformNode } from "@babylonjs/core";

// `loadMonsters` fetches a URL; node has no server, so hand the loader the file on disk.
vi.mock("@babylonjs/core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@babylonjs/core")>();
  const { readFileSync: read } = await import("node:fs");
  const path = fileURLToPath(new URL("../../public/models/monsters.glb", import.meta.url));
  return {
    ...core,
    LoadAssetContainerAsync: (src: unknown, scene: import("@babylonjs/core").Scene) =>
      core.LoadAssetContainerAsync(
        src === "/models/monsters.glb" ? new File([read(path)], "monsters.glb", { type: "model/gltf-binary" }) : (src as string),
        scene,
      ),
  };
});

/**
 * The monsters that own a timed wind-up, a heavy's slam or a boss's: each ships
 * its own `slam` for that wind-up beside the `attack` it swings in reach.
 */
const SLAMS: ReadonlySet<string> = new Set(
  [...MONSTERS.values()].filter((d) => d.heavy !== undefined || d.boss !== undefined).map((d) => d.id),
);
/** Both builders key their clips at 30 fps (`FPS` in `build_monsters.py` and `rig_humanoid.py`). */
const AUTHORED_FPS = 30;

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
    accessors: { min?: number[]; max?: number[] }[];
    materials: { name: string }[];
    images: { mimeType: string }[];
    extensionsRequired?: string[];
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
  const FLOATERS: ReadonlySet<string> = new Set(["monster.fen_wisp.v1"]);
  it("ships one skinned mesh per creature, with a real leg chain in it", () => {
    for (const root of species) {
      const node = json.nodes.find((n) => n.name === root)!;
      const children = (node.children ?? []).map((i) => json.nodes[i]!);
      const mesh = children.find((c) => c.mesh !== undefined);
      expect(mesh, `${root} has no mesh`).toBeDefined();
      expect(mesh!.skin, `${root} is not skinned`).toBeTypeOf("number");

      const joints = json.skins[mesh!.skin!]!.joints.map((i) => json.nodes[i]!.name);
      // A floater has no legs to regress: it is a body chain that bobs.
      if (FLOATERS.has(root)) continue;
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
  it("ships a walk, an idle and an attack for every creature, a slam for each that winds one up, and nothing else", () => {
    const names = json.animations.map((a) => a.name);
    for (const root of species) {
      expect(names).toContain(`${root}|walk`);
      expect(names).toContain(`${root}|idle`);
      expect(names).toContain(`${root}|attack`);
      expect(names.includes(`${root}|slam`), `${root}|slam`).toBe(SLAMS.has(root));
    }
    expect(names.length).toBe(species.length * 3 + SLAMS.size);
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
      {
        animationGroups: ["walk", "idle", "attack"].map((c) => group(`${species}|${c}`)),
        rootNodes: [],
        skeletons: [],
        dispose: () => {},
      } as unknown as InstantiatedEntries,
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

    // First sight with no swing yet: the first swing after it is a real edge.
    const fresh = new CreatureRig(
      {
        animationGroups: ["walk", "idle", "attack"].map((c) => group(`${species}|${c}`)),
        rootNodes: [],
        skeletons: [],
        dispose: () => {},
      } as unknown as InstantiatedEntries,
      species,
    );
    started.length = 0;
    fresh.noteAttack(undefined);
    fresh.noteAttack(200);
    expect(started, "the first swing while in view").toEqual([`${species}|attack:once`]);
  });

  /**
   * Clips as the glTF loader keys them (60 fps), each strike carrying the blow
   * `build_monsters.py` stamps into its extras, in seconds: the attack's at 0.3 s
   * of 0.77, the slam's at 0.667 s of 1.23, as the packed glb has them.
   */
  const striker = (species: string, clips: readonly string[]) => {
    const groups = new Map<string, { speedRatio: number; isPlaying: boolean }>();
    const started: string[] = [];
    const ends: (() => void)[] = [];
    const STRIKES: Record<string, { to: number; blow: number }> = {
      attack: { to: 46, blow: 0.3 },
      slam: { to: 74, blow: 0.666667 },
    };
    const group = (clip: string): AnimationGroup => {
      const name = `${species}|${clip}`;
      const strike = STRIKES[clip];
      const g = {
        name,
        speedRatio: 1,
        isPlaying: false,
        enableBlending: false,
        blendingSpeed: 0,
        from: 0,
        to: strike?.to ?? 46,
        targetedAnimations: [{ animation: { framePerSecond: 60 } }],
        metadata: strike ? { gltf: { extras: { blow: strike.blow } } } : null,
        start: (loop: boolean, ratio?: number) => {
          if (ratio !== undefined) g.speedRatio = ratio;
          g.isPlaying = true;
          started.push(`${clip}${loop ? "" : ":once"}`);
        },
        stop: () => { g.isPlaying = false; },
        dispose: () => {},
        onAnimationGroupEndObservable: { addOnce: (fn: () => void) => ends.push(fn) },
      };
      groups.set(clip, g);
      return g as unknown as AnimationGroup;
    };
    const rig = new CreatureRig(
      { animationGroups: clips.map(group), rootNodes: [], skeletons: [], dispose: () => {} } as unknown as InstantiatedEntries,
      species,
    );
    started.length = 0; // the constructor's arrival breath
    return { rig, groups, started, ends };
  };

  /**
   * A heavy's swing starts on the wind-up's first tick and the hit lands a second
   * later: played at its own pace the blow would fall on empty air long before the
   * floor erupts. A species that owns a slam plays it for the wind-up, and its coil
   * stretches so the slam's own blow meets the impact; one without plays its attack.
   */
  it("slams into a wind-up, its coil slowed so the slam's blow lands on the impact", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    try {
      const { rig, groups, started } = striker("monster.cinder_warden.v1", ["walk", "idle", "attack", "slam"]);
      const slam = groups.get("slam")!;
      const attack = groups.get("attack")!;
      rig.noteAttack(1); // first report: seeds the edge
      rig.noteAttack(2, 1.12);
      expect(started).toEqual(["slam:once"]);
      // The slam's blow is 0.667 s in: landing 1.12 s out plays it at 0.595.
      expect(slam.speedRatio).toBeCloseTo(0.666667 / 1.12, 3);
      now.mockReturnValue(1000 + 1110);
      rig.setLocomotion(0);
      expect(slam.speedRatio, "still coiling").toBeCloseTo(0.666667 / 1.12, 3);
      now.mockReturnValue(1000 + 1130);
      rig.setLocomotion(0);
      expect(slam.speedRatio, "past the blow: the strike's own quick pace").toBeCloseTo(1.3, 3);

      started.length = 0;
      rig.noteAttack(3);
      expect(started, "a plain swing is the attack").toEqual(["attack:once"]);
      expect(attack.speedRatio, "at its quick pace").toBeCloseTo(1.3, 3);
      expect(slam.isPlaying, "the slam lets go of the bones").toBe(false);

      const plain = striker("monster.vaal_construct.v1", ["walk", "idle", "attack"]);
      plain.rig.noteAttack(1);
      plain.rig.noteAttack(2, 1.12);
      expect(plain.started, "no slam: the attack takes the wind-up").toEqual(["attack:once"]);
      expect(plain.groups.get("attack")!.speedRatio).toBeCloseTo(0.3 / 1.12, 3);
    } finally {
      now.mockRestore();
    }
  });

  /**
   * A charger's wind-up is the run: the hit lands where the dash ends, a second or
   * more out, and a coil stretched over the whole run would hold the body bent
   * while it sprints. The strike instead starts late, at its own pace, so its blow
   * falls on the impact; until then the legs run.
   */
  it("starts a charge's strike late so its blow lands on the impact, running until then", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    try {
      const { rig, groups, started } = striker("monster.thornhide_boar.v1", ["walk", "idle", "attack"]);
      rig.noteAttack(1);
      rig.noteAttack(2, 1, true);
      expect(started, "nothing swings at the start of the run").toEqual([]);
      rig.setLocomotion(6);
      expect(started).toEqual(["walk"]);
      // The blow is 0.3 s in at 1.3x: the strike starts 0.231 s before the impact.
      const startAt = 1000 + (1 - 0.3 / 1.3) * 1000;
      now.mockReturnValue(startAt - 5);
      rig.setLocomotion(6);
      expect(started, "still running").toEqual(["walk"]);
      now.mockReturnValue(startAt + 5);
      rig.setLocomotion(6);
      expect(started).toEqual(["walk", "attack:once"]);
      expect(groups.get("attack")!.speedRatio).toBeCloseTo(1.3, 3);
    } finally {
      now.mockRestore();
    }
  });

  it("stops its clip while asleep and starts the latest one on waking", () => {
    const log: string[] = [];
    const group = (name: string): AnimationGroup => ({
      name,
      speedRatio: 1,
      enableBlending: false,
      blendingSpeed: 0,
      start: (loop: boolean) => log.push(`start ${name}${loop ? "" : ":once"}`),
      stop: () => log.push(`stop ${name}`),
      dispose: () => {},
      onAnimationGroupEndObservable: { addOnce: () => {} },
    } as unknown as AnimationGroup);
    const species = "monster.cinder_imp.v1";
    const rig = new CreatureRig(
      {
        animationGroups: ["walk", "idle", "attack"].map((c) => group(`${species}|${c}`)),
        rootNodes: [],
        skeletons: [],
        dispose: () => {},
      } as unknown as InstantiatedEntries,
      species,
    );
    rig.noteAttack(1);
    log.length = 0;

    rig.setAwake(false);
    expect(log).toEqual([`stop ${species}|idle`]);
    // Asleep, nothing drives the bones: a walk is only remembered, a swing unseen.
    log.length = 0;
    rig.setLocomotion(3);
    rig.noteAttack(2);
    expect(log).toEqual([]);

    rig.setAwake(true);
    expect(log.filter((l) => l.startsWith("start"))).toEqual([`start ${species}|walk`]);
  });

  it("blends clips only while near: far bodies cut, and the flag changes at a start, never mid-ramp", () => {
    const groups = new Map<string, { enableBlending: boolean }>();
    const group = (name: string): AnimationGroup => {
      const g = {
        name,
        speedRatio: 1,
        enableBlending: false,
        blendingSpeed: 0,
        start: () => {},
        stop: () => {},
        dispose: () => {},
        onAnimationGroupEndObservable: { addOnce: () => {} },
      };
      groups.set(name, g);
      return g as unknown as AnimationGroup;
    };
    const species = "monster.cinder_imp.v1";
    const rig = new CreatureRig(
      {
        animationGroups: ["walk", "idle", "attack"].map((c) => group(`${species}|${c}`)),
        rootNodes: [],
        skeletons: [],
        dispose: () => {},
      } as unknown as InstantiatedEntries,
      species,
    );
    const walk = groups.get(`${species}|walk`)!;
    rig.setLocomotion(3);
    expect(walk.enableBlending, "near: cross-fades").toBe(true);

    rig.setBlending(false);
    expect(walk.enableBlending, "a running clip keeps its ramp").toBe(true);
    rig.setLocomotion(0);
    rig.setLocomotion(3);
    expect(walk.enableBlending, "far: the next start cuts").toBe(false);

    rig.setBlending(true);
    rig.setLocomotion(0);
    rig.setLocomotion(3);
    expect(walk.enableBlending, "back inside: blends again").toBe(true);
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
   *
   * 7.0MB since the Drowned Grubling became a generated mesh with its own sheet:
   * measured +242KB (6,744,556 -> 6,986,708).
   *
   * 8.25MB since the Sand Skitterer became a generated mesh at 8k triangles with
   * a 1024 sheet and a baked normal map: measured +1.2MB (6,987,528 -> 8,186,100).
   *
   * 5.25MB once `tools/pack_monsters.mjs` meshopt-packs the geometry: measured
   * 8,186,100 -> 5,157,736. WebP hides measured LARGER than these JPEGs.
   *
   * 5.5MB and fifteen images since the Sunbaked Colossus became a generated mesh
   * at 4k triangles with two 512 sheets: measured 5,157,736 -> 5,428,792 packed.
   *
   * 5.75MB and seventeen images since the Bramble Whelp did the same: measured
   * 5,430,556 -> 5,664,344 packed.
   *
   * 6.0MB and nineteen images since the Cinder Imp did the same: measured
   * 5,662,876 -> 5,895,208 packed.
   *
   * 6.25MB and twenty-one images since the Thornhide Boar did the same: measured
   * 5,895,208 -> 6,080,492 packed.
   *
   * Twenty-three images since the Vaal Husk did the same: measured 5,350,232 ->
   * 5,530,408 packed, inside 6.25MB because the volumetric opening shrank the rest.
   *
   * Twenty-five images since the Dune Spitter did the same: measured 5,530,408 ->
   * 5,659,900 packed.
   *
   * Twenty-seven images since the Rotting Behemoth did the same: measured
   * 5,659,900 -> 5,855,316 packed.
   *
   * 6.5MB and twenty-nine images since Ghaltrek did the same at 8k triangles with
   * two 1024 sheets: measured 5,855,316 -> 6,308,124 packed.
   *
   * 6.75MB and thirty-one images since the Bog Drowned did the same: measured
   * 6,308,124 -> 6,509,768 packed.
   *
   * Thirty-two images since the Drowned Grubling was opened and given a baked
   * normal map: measured 6,509,744 -> 6,535,012 packed.
   *
   * Thirty-four images since the Vaal Construct became a generated mesh with two
   * 512 sheets: measured 6,428,688 -> 6,622,052 packed.
   *
   * 7.0MB since the Cinder Warden became a generated mesh at 8k triangles with
   * two 1024 sheets: measured 6,521,388 -> 6,829,176 packed.
   *
   * 7.25MB and thirty-six images since Mother Vhal did the same: measured
   * 6,623,960 -> 7,050,236 packed.
   *
   * 7.5MB and forty-two images since the Tide Spitter became the Strand's third
   * own species, each 4k triangles with two 512 sheets: measured 7,099,664 ->
   * 7,375,260 packed.
   *
   * 7.75MB since the armed and the big swing their own strikes, twelve attacks
   * and seven slams: measured 7,376,528 -> 7,497,716 packed.
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
    expect(json.images.length).toBeLessThanOrEqual(42);
    expect(json.extensionsRequired).toContain("EXT_meshopt_compression");
    expect(glb.byteLength).toBeLessThan(7_750_000);
  });
});

/** Babylon reads a File through FileReader, which node does not ship. */
class NodeFileReader {
  result: unknown;
  onload?: (e: { target: NodeFileReader }) => void;
  onloadend?: (e: { target: NodeFileReader }) => void;
  onerror?: (e: { target: NodeFileReader }) => void;
  abort(): void {}
  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((r) => { this.result = r; this.onload?.({ target: this }); this.onloadend?.({ target: this }); });
  }
}

/** The share of a circle of radius `r` round the origin that the meshes' skinned plan view covers, on a 1cm grid. */
function circleCoverage(meshes: Mesh[], r: number): number {
  const cell = 0.01;
  const n = Math.ceil(r / cell);
  const side = 2 * n;
  const grid = new Uint8Array(side * side);
  for (const m of meshes) {
    const p = m.getPositionData(true, true);
    const idx = m.getIndices();
    if (!p || !idx) continue;
    m.computeWorldMatrix(true);
    const w: Vector3[] = [];
    for (let i = 0; i < p.length; i += 3) {
      w.push(Vector3.TransformCoordinatesFromFloatsToRef(p[i]!, p[i + 1]!, p[i + 2]!, m.getWorldMatrix(), new Vector3()));
    }
    for (let t = 0; t < idx.length; t += 3) {
      const a = w[idx[t]!]!, b = w[idx[t + 1]!]!, c = w[idx[t + 2]!]!;
      const d = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
      if (Math.abs(d) < 1e-12) continue;
      const x0 = Math.max(-n, Math.floor(Math.min(a.x, b.x, c.x) / cell));
      const x1 = Math.min(n - 1, Math.ceil(Math.max(a.x, b.x, c.x) / cell));
      const z0 = Math.max(-n, Math.floor(Math.min(a.z, b.z, c.z) / cell));
      const z1 = Math.min(n - 1, Math.ceil(Math.max(a.z, b.z, c.z) / cell));
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
        const px = (gx + 0.5) * cell, pz = (gz + 0.5) * cell;
        const u = ((b.x - px) * (c.z - pz) - (c.x - px) * (b.z - pz)) / d;
        const v = ((c.x - px) * (a.z - pz) - (a.x - px) * (c.z - pz)) / d;
        if (u >= 0 && v >= 0 && u + v <= 1) grid[(gz + n) * side + gx + n] = 1;
      }
    }
  }
  let inside = 0, body = 0;
  for (let gz = -n; gz < n; gz++) for (let gx = -n; gx < n; gx++) {
    if (Math.hypot((gx + 0.5) * cell, (gz + 0.5) * cell) > r) continue;
    inside++;
    body += grid[(gz + n) * side + gx + n]!;
  }
  return body / inside;
}

/** A strike's blow in seconds on its glTF timeline: the build writes it into the clip's extras, Babylon hands them on as metadata. */
function blowOf(group: AnimationGroup): number | undefined {
  return (group.metadata as { gltf?: { extras?: { blow?: number } } } | null | undefined)?.gltf?.extras?.blow;
}

/** One creature's skinned meshes among a loaded container's. */
function meshesOf(container: AssetContainer, id: string): Mesh[] {
  return container.meshes.filter((m) => m.skeleton && partOfCreature(m, id)) as Mesh[];
}

/** Every vertex of `meshes` as their skeletons pose it now, in world space: x, y, z after x, y, z. */
function posed(meshes: Mesh[]): number[] {
  const out: number[] = [];
  const at = new Vector3();
  for (const m of meshes) {
    m.computeWorldMatrix(true);
    m.skeleton!.prepare(true);
    const p = m.getPositionData(true, true)!;
    for (let i = 0; i < p.length; i += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(p[i]!, p[i + 1]!, p[i + 2]!, m.getWorldMatrix(), at);
      out.push(at.x, at.y, at.z);
    }
  }
  return out;
}

/**
 * `instantiateModelsToScene` hands every clone the container mesh's metadata
 * OBJECT, and the hit flash rides that metadata: one struck monster lit its
 * whole species.
 */
describe("creature instances", () => {
  it("finds a blow's contact on the creature's skinned pose, inside its box", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      await loadMonsters(scene);
      const root = new Mesh("body", scene);
      root.position.set(4, 0, 0);
      expect(attachCreature(scene, root, [...MONSTERS.keys()][0]!)).not.toBeNull();
      root.computeWorldMatrix(true);
      for (const m of root.getChildMeshes(false)) m.computeWorldMatrix(true);
      // Through the trunk: lower, the ray passes under the first species' belly.
      const from = new Vector3(0, 0.55, 0);
      const centre = new Vector3(4, 0.55, 0);
      const skin = contactPoint(root, from, centre, true);
      const box = contactPoint(root, from, centre, false);
      expect(skin).not.toBe(centre);
      expect(box).not.toBe(centre);
      // The skin lies inside the box the ray entered first, short of the centre.
      expect(skin.x).toBeGreaterThan(box.x + 1e-3);
      expect(skin.x).toBeLessThan(4);
    } finally {
      resetMonsters();
      engine.dispose();
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  });

  /**
   * The sim's body radius is every hitbox a monster has: bolts, swings and slams
   * all land on that circle. Authored apart from the mesh, an archetype radius on
   * a slim body detonates bolts on empty air (the Warden shipped 1.4 wide round a
   * torso 0.32 deep). Scored as how much of the circle the skinned idle silhouette
   * fills from above, never the bounding box, which an outstretched arm sets.
   * One-sided: a circle smaller than a sprawling mesh is a forgiving hitbox.
   */
  it("keeps every sim body radius on its creature's silhouette", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    const engine = new NullEngine();
    const scene = new Scene(engine);
    new FreeCamera("cam", new Vector3(0, 10, -10), scene);
    try {
      await loadMonsters(scene);
      for (const id of MONSTERS.keys()) {
        const root = new Mesh(id, scene);
        attachCreature(scene, root, id)!.setLocomotion(0);
        scene.render();
        const r = toNumber(MONSTERS.get(id)!.radiusFixed);
        const cover = circleCoverage(root.getChildMeshes(false) as Mesh[], r);
        expect(cover, `${id}: ${Math.round(cover * 100)}% of its ${r} circle is body`).toBeGreaterThanOrEqual(0.7);
        root.dispose();
      }
    } finally {
      resetMonsters();
      engine.dispose();
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  });

  /**
   * A generated shell can weld a hanging fist to its thigh or an elbow to its
   * hip, and the build cuts it free (`thigh`, `fused_arms` in
   * `build_monsters.py`). Uncut, the Bog Drowned's strike drew its right fist
   * out of the knee as a sheet: edges from an arm vertex to a leg vertex grew
   * 1.1 m. Scored on every strike the creature owns, its slam too, by each
   * vertex's strongest bone, counting edges stretched past twice their rest.
   * The Wrack Drowned's left elbow stays welded to its hip, uncut, so its
   * smash leaves that arm hanging (swung, it tore 108 edge-frames).
   */
  it("keeps a freed fist off its leg through every strike", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    const engine = new NullEngine();
    const scene = new Scene(engine);
    new FreeCamera("cam", new Vector3(0, 10, -10), scene);
    try {
      const container = await LoadAssetContainerAsync("/models/monsters.glb", scene);
      container.addAllToScene();
      for (const g of container.animationGroups) g.stop();
      for (const id of ["monster.bog_drowned.v1", "monster.cinder_warden.v1", "monster.drowned_grubling.v1", "monster.hoarfrost_spitter.v1", "monster.wrack_drowned.v1"]) {
        for (const clip of SLAMS.has(id) ? ["attack", "slam"] : ["attack"]) {
          const strike = container.animationGroups.find((g) => g.name === `${id}|${clip}`);
          expect(strike, `${id}|${clip}`).toBeDefined();
          strike!.start(false);
          strike!.pause();
          let torn = 0;
          for (let f = strike!.from; f <= strike!.to; f++) {
            strike!.goToFrame(f);
            scene.render();
            for (const m of meshesOf(container, id)) {
              m.computeWorldMatrix(true);
              m.skeleton!.prepare(true);
              const rest = m.getPositionData(false, false)!, pose = m.getPositionData(true, true)!;
              const idx = m.getIndices()!, mi = m.getVerticesData("matricesIndices")!, mw = m.getVerticesData("matricesWeights")!;
              const part = (v: number) => {
                let k0 = 0;
                for (let k = 1; k < 4; k++) if (mw[4 * v + k]! > mw[4 * v + k0]!) k0 = k;
                const name = m.skeleton!.bones[mi[4 * v + k0]!]!.name;
                return /^(arm_|hand_)/.test(name) ? "arm" : name.startsWith("leg") ? "leg" : "trunk";
              };
              const len = (p: ArrayLike<number>, a: number, b: number) =>
                Math.hypot(p[3 * a]! - p[3 * b]!, p[3 * a + 1]! - p[3 * b + 1]!, p[3 * a + 2]! - p[3 * b + 2]!);
              for (let t = 0; t < idx.length; t += 3) {
                for (const [a, b] of [[idx[t]!, idx[t + 1]!], [idx[t + 1]!, idx[t + 2]!], [idx[t + 2]!, idx[t]!]] as const) {
                  const ends = [part(a), part(b)].sort().join("-");
                  if (ends === "arm-leg" && len(pose, a, b) > 2 * len(rest, a, b) + 0.03) torn++;
                }
              }
            }
          }
          strike!.stop();
          expect(torn, `${id}: arm-to-leg edges stretched past 2x through the ${clip}`).toBe(0);
        }
      }
    } finally {
      engine.dispose();
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  }, 30_000);

  /**
   * Where the blow lands rides in each strike's glTF extras as `blow`, seconds on
   * the clip's timeline, so a wind-up's impact can be met by the clip's own
   * contact rather than one share guessed for every clip. The exporter writes no
   * animation extras, so the build patches them in, and an instance's clone must
   * keep them: a creature built from the file is what the runtime times.
   */
  it("carries each strike's blow inside its clip, through to every instance", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const container = await LoadAssetContainerAsync("/models/monsters.glb", scene);
      const strikes = container.animationGroups.filter((g) => /\|(attack|slam)$/.test(g.name));
      expect(strikes.length).toBe(MONSTERS.size + SLAMS.size);
      for (const g of strikes) {
        const blow = blowOf(g);
        expect(blow, `${g.name} carries no blow`).toBeTypeOf("number");
        const fps = g.targetedAnimations[0]!.animation.framePerSecond;
        const at = (blow! * fps - g.from) / (g.to - g.from);
        expect(at, `${g.name}: the blow sits ${Math.round(at * 100)}% into it`).toBeGreaterThanOrEqual(0.1);
        expect(at, `${g.name}: the blow sits ${Math.round(at * 100)}% into it`).toBeLessThanOrEqual(0.9);
      }
      await loadMonsters(scene);
      for (const id of MONSTERS.keys()) {
        const strike = attachCreature(scene, new Mesh(id, scene), id)!.clipGroups.get("attack")!;
        expect(blowOf(strike), `${id}: an instance's attack`).toBe(blowOf(strikes.find((g) => g.name === `${id}|attack`)!));
      }
    } finally {
      resetMonsters();
      engine.dispose();
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  }, 30_000);

  /**
   * The blow sits on the contact. Whatever moves furthest in one frame on the
   * way to it (a blade's tip, a fist, a snapping head) does so in the three
   * frames before the blow, and two frames after it has all but stopped. A blow
   * keyed on the coil or the follow-through times the hit to a limb still in
   * the air.
   */
  it("lands each strike's blow where its fastest point stops", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    const engine = new NullEngine();
    const scene = new Scene(engine);
    new FreeCamera("cam", new Vector3(0, 10, -10), scene);
    try {
      const container = await LoadAssetContainerAsync("/models/monsters.glb", scene);
      container.addAllToScene();
      for (const g of container.animationGroups) g.stop();
      const strikes = container.animationGroups.filter((g) => /\|(attack|slam)$/.test(g.name));
      expect(strikes.length).toBe(MONSTERS.size + SLAMS.size);
      const moved = (a: number[], b: number[], v: number) => Math.hypot(b[v]! - a[v]!, b[v + 1]! - a[v + 1]!, b[v + 2]! - a[v + 2]!);
      for (const g of strikes) {
        const blow = blowOf(g);
        expect(blow, `${g.name} carries no blow`).toBeTypeOf("number");
        const meshes = meshesOf(container, g.name.split("|")[0]!);
        const fps = g.targetedAnimations[0]!.animation.framePerSecond;
        const step = fps / AUTHORED_FPS;
        g.start(false);
        g.pause();
        const frames: number[][] = [];
        for (let f = g.from; f <= g.to + 1e-6; f += step) {
          g.goToFrame(f);
          scene.render();
          frames.push(posed(meshes));
        }
        g.stop();
        const hit = Math.round((blow! * fps - g.from) / step);
        let peak = 0, point = 0, at = 0;
        for (let s = 1; s <= hit; s++) {
          for (let v = 0; v < frames[s]!.length; v += 3) {
            const d = moved(frames[s - 1]!, frames[s]!, v);
            if (d > peak) { peak = d; point = v; at = s; }
          }
        }
        expect(hit - at, `${g.name}: its fastest point peaks ${hit - at} frames before the blow`).toBeLessThan(3);
        for (let s = hit + 1; s <= Math.min(hit + 2, frames.length - 1); s++) {
          const d = moved(frames[s - 1]!, frames[s]!, point);
          expect(d, `${g.name}: ${s - hit} frames after the blow it still moves at ${(d / peak).toFixed(2)} of its peak`).toBeLessThan(peak / 2);
        }
      }
    } finally {
      engine.dispose();
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  }, 30_000);

  /**
   * The owner's complaint as geometry: a sword "in the hand" that never swings.
   * The Blood Sentinel's attack carries its blade's tip round the front of its
   * body and holds it out ahead at the blow; the overhead strikes (the
   * Sentinel's chop, the Warden's slab, the Wrack Drowned's anchor) bring the
   * weapon down onto the floor in front. The weapon is what the right hand holds
   * rigidly (`rig_humanoid.skin`), its tip the held point furthest from the body.
   */
  it("swings each carried weapon through its blow", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    const engine = new NullEngine();
    const scene = new Scene(engine);
    new FreeCamera("cam", new Vector3(0, 10, -10), scene);
    try {
      const container = await LoadAssetContainerAsync("/models/monsters.glb", scene);
      container.addAllToScene();
      for (const g of container.animationGroups) g.stop();
      scene.render();
      /** Each creature's rest, taken before its first strike: a stopped group leaves the bones where it stopped. */
      const rests = new Map<string, number[]>();
      /** The weapon's points and the world pose at each frame up to the blow, beside the creature's rest height and floor. */
      const swing = (id: string, clip: string) => {
        const meshes = meshesOf(container, id);
        if (!rests.has(id)) rests.set(id, posed(meshes));
        const rest = rests.get(id)!;
        const held: number[] = [];
        let base = 0;
        for (const m of meshes) {
          const mi = m.getVerticesData("matricesIndices")!, mw = m.getVerticesData("matricesWeights")!;
          for (let v = 0; v < mw.length / 4; v++) {
            for (let k = 0; k < 4; k++) {
              if (mw[4 * v + k]! > 0.999 && m.skeleton!.bones[mi[4 * v + k]!]!.name === "hand_r") held.push(3 * (base + v));
            }
          }
          base += m.getTotalVertices();
        }
        let floor = Infinity, top = -Infinity;
        for (let v = 1; v < rest.length; v += 3) { floor = Math.min(floor, rest[v]!); top = Math.max(top, rest[v]!); }
        const g = container.animationGroups.find((a) => a.name === `${id}|${clip}`);
        expect(g, `${id}|${clip}`).toBeDefined();
        const blow = blowOf(g!);
        expect(blow, `${id}|${clip} carries no blow`).toBeTypeOf("number");
        const fps = g!.targetedAnimations[0]!.animation.framePerSecond;
        g!.start(false);
        g!.pause();
        const frames: number[][] = [];
        for (let f = g!.from; f < blow! * fps + 1e-6; f += fps / AUTHORED_FPS) {
          g!.goToFrame(f);
          scene.render();
          frames.push(posed(meshes));
        }
        g!.goToFrame(blow! * fps);
        scene.render();
        const atBlow = posed(meshes);
        g!.stop();
        return { rest, held, frames, atBlow, floor, H: top - floor };
      };

      const cleave = swing("monster.blood_sentinel.v1", "attack");
      const isHeld = new Set(cleave.held);
      let tip = cleave.held[0]!, far = 0;
      for (const h of cleave.held) {
        let near = Infinity;
        for (let v = 0; v < cleave.rest.length; v += 3) {
          if (isHeld.has(v)) continue;
          near = Math.min(near, Math.hypot(cleave.rest[v]! - cleave.rest[h]!, cleave.rest[v + 1]! - cleave.rest[h + 1]!, cleave.rest[v + 2]! - cleave.rest[h + 2]!));
        }
        if (near > far) { far = near; tip = h; }
      }
      // The tip's bearing round the vertical through the creature, unwound frame to frame.
      let turn = 0, lo = 0, hi = 0;
      let last = Math.atan2(cleave.frames[0]![tip]!, cleave.frames[0]![tip + 2]!);
      for (const p of cleave.frames.slice(1)) {
        const a = Math.atan2(p[tip]!, p[tip + 2]!);
        turn += ((a - last + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
        last = a;
        lo = Math.min(lo, turn);
        hi = Math.max(hi, turn);
      }
      expect(((hi - lo) * 180) / Math.PI, "degrees the Sentinel's blade sweeps round its body to the blow").toBeGreaterThanOrEqual(120);
      expect(cleave.atBlow[tip + 2]! / cleave.H, "the blade's tip ahead of the Sentinel at the blow, in heights").toBeGreaterThanOrEqual(0.4);

      for (const [id, clip] of [["monster.blood_sentinel.v1", "slam"], ["monster.cinder_warden.v1", "slam"], ["monster.wrack_drowned.v1", "attack"]] as const) {
        const s = swing(id, clip);
        let low = s.held[0]!;
        for (const h of s.held) if (s.atBlow[h + 1]! < s.atBlow[low + 1]!) low = h;
        expect((s.atBlow[low + 1]! - s.floor) / s.H, `${id}|${clip}: the weapon's lowest point above the floor at the blow, in heights`).toBeLessThanOrEqual(0.08);
        expect(s.atBlow[low + 2]! / s.H, `${id}|${clip}: that point ahead of the body, in heights`).toBeGreaterThanOrEqual(0.5);
      }
    } finally {
      engine.dispose();
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  }, 30_000);

  /**
   * A paused group still counts as started, so `start` on waking returned early
   * and the creature came back into view frozen mid-step.
   */
  it("lets go of its bones while asleep and moves them again on waking", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      await loadMonsters(scene);
      const rig = attachCreature(scene, new Mesh("body", scene), [...MONSTERS.keys()][0]!)!;
      const idle = rig.clipGroups.get("idle")!;
      expect(idle.isPlaying).toBe(true);
      rig.setAwake(false);
      expect(idle.animatables.length, "asleep, nothing left for Scene.animate to walk").toBe(0);
      rig.setAwake(true);
      expect(idle.isPlaying, "awake again, the idle runs").toBe(true);
    } finally {
      resetMonsters();
      engine.dispose();
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  });

  it("flash alone when struck", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      await loadMonsters(scene);
      expect(isMonstersReady(scene)).toBe(true);
      const species = [...MONSTERS.keys()][0]!;
      const [struck, other] = ["struck", "other"].map((n) => {
        const root = new Mesh(n, scene);
        expect(attachCreature(scene, root, species), species).not.toBeNull();
        return root;
      });
      setHitFlash(struck!, 1);
      const flash = (root: Mesh) => root.getChildMeshes(false).filter((m) => hasRim(m.material))
        .map((m) => (m.metadata as { hitFlash?: number } | null)?.hitFlash ?? 0);
      expect(flash(struck!).length).toBeGreaterThan(0);
      expect(flash(struck!).every((f) => f === 1)).toBe(true);
      expect(flash(other!).every((f) => f === 0)).toBe(true);
    } finally {
      resetMonsters();
      engine.dispose();
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  });

  /** A map snapshot holding `entities`, the player standing off to one side. */
  const snap = (tick: number, entities: SnapshotEntity[]): Snapshot => ({
    tick, player: testPlayer({ x: 2, y: 2 }), area: "map", portalsLeft: 0, mapOpen: false, areaTier: 0,
    atlasSeed: 0, completedNodes: [], entities,
    inventory: { cols: 12, rows: 5, items: [] }, stash: { cols: 12, rows: 12, items: [] },
    vendor: { cols: 12, rows: 12, items: [] }, shards: {}, equipment: {},
  });
  /** Whether any part of the actor drawn for entity `id` glows through a wind-up. */
  const glowing = (scene: Scene, id: number) => {
    const root = scene.getMeshByName(`entity-${id}`) as Mesh;
    return [root, ...root.getChildMeshes(false)]
      .some((m) => ((m.metadata as { dangerGlow?: number } | null)?.dangerGlow ?? 0) > 0);
  };

  /**
   * The sim stamps a boss's swing on the wind-up's first tick. Drawn from the
   * snapshot, the Warden slams for its heavy, the slam stretched to land on the
   * impact a second out, and a plain swing is its attack at its own pace.
   * Measured on the packed glb: the Warden's slam lands its blow 0.667 s in
   * (`rig_humanoid.py` frame 20, stamped by `build_monsters.py`), so a blow a
   * second away plays it at 0.667.
   */
  it("times a boss's slam to the heavy wind-up it casts", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    const engine = new NullEngine();
    const { scene } = createScene(engine);
    try {
      await loadMonsters(scene);
      const renderer = new SnapshotRenderer(scene);
      // In front of the camera: a creature off screen sleeps and skips a swing nobody sees.
      const warden = (attackTick: number): SnapshotEntity => ({
        id: 7, kind: "monster", boss: true, species: "monster.cinder_warden.v1", x: 0, y: 0, attackTick,
      });
      // Half filled: a fresh tell glows 0, so the glow is only told apart once it fills.
      const slam: SnapshotEntity = { id: 8, kind: "telegraph", x: 1, y: 1, radius: 3.5, progress: 0.5, ownerId: 7, impactIn: 1, heavy: true };
      const volley: SnapshotEntity = { id: 9, kind: "telegraph", x: 1, y: 1, radius: 1.3, progress: 0, ownerId: 7, impactIn: 1, ability: "cinder_rain" };

      renderer.apply(null, snap(1, [warden(0)]), 0);
      const clips = creatureOf(scene.getMeshByName("entity-7") as Mesh)!.clipGroups;
      renderer.apply(null, snap(2, [warden(2), slam]), 0);
      expect(clips.get("slam")!.isPlaying, "the heavy is the slam").toBe(true);
      expect(clips.get("slam")!.speedRatio).toBeCloseTo(0.667, 2);
      expect(glowing(scene, 7), "a boss's heavy glows").toBe(true);

      renderer.apply(null, snap(3, [warden(3)]), 0);
      expect(clips.get("attack")!.isPlaying, "a plain swing is the attack").toBe(true);
      expect(clips.get("attack")!.speedRatio).toBeCloseTo(1.3, 3);

      renderer.apply(null, snap(4, [warden(4), volley]), 0);
      expect(clips.get("attack")!.speedRatio, "a boss's light mark never times its swing").toBeCloseTo(1.3, 3);
    } finally {
      resetMonsters();
      engine.dispose();
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  });

  // 24 strafing shooters cost 3.4-4.8 ms a frame in the leg solve; a few degrees off the facing never shows.
  it("solves the legs only for a move that reads as a sidestep", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    const engine = new NullEngine();
    const scene = new Scene(engine);
    new FreeCamera("cam", new Vector3(0, 10, -10), scene);
    const solved = vi.spyOn(CreatureRig.prototype as unknown as { turnLegs(): void }, "turnLegs");
    try {
      await loadMonsters(scene);
      const rig = attachCreature(scene, new Mesh("spitter", scene), "monster.dune_spitter.v1")!;
      const walk = (rel: number) => {
        solved.mockClear();
        for (let i = 0; i < 30; i++) { rig.setLocomotion(2); rig.setMoveAngle(rel); scene.render(); }
        return solved.mock.calls.length;
      };
      expect(walk(0.1), "a lean into a turn").toBe(0);
      expect(walk(Math.PI / 2), "a strafe").toBeGreaterThan(0);
    } finally {
      solved.mockRestore();
      resetMonsters();
      engine.dispose();
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  });

  it("tells a shooter's legs how far off its facing it moves, and nothing while it walks where it faces", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    const engine = new NullEngine();
    const { scene } = createScene(engine);
    const told = vi.spyOn(CreatureRig.prototype, "setMoveAngle");
    try {
      await loadMonsters(scene);
      const renderer = new SnapshotRenderer(scene);
      // Turned to a target on +y while it goes: square across (+x), straight back, and then straight at it.
      const spitter = (x: number, y: number, heading?: { x: number; y: number }): SnapshotEntity => ({
        id: 7, kind: "monster", species: "monster.dune_spitter.v1", x, y, ...(heading ? { heading } : {}),
      });
      const last = () => told.mock.calls.at(-1)![0];
      renderer.apply(null, snap(1, [spitter(0, 0, { x: 0, y: 1 })]), 1);
      // Come round to the heading it was sent: the headless turn steps a millisecond a frame.
      scene.getMeshByName("entity-7")!.rotation.y = 0;
      renderer.apply(snap(40, [spitter(0, 0, { x: 0, y: 1 })]), snap(41, [spitter(0.05, 0, { x: 0, y: 1 })]), 0.5);
      expect(last()).toBeCloseTo(Math.PI / 2, 1);
      renderer.apply(snap(41, [spitter(0.05, 0, { x: 0, y: 1 })]), snap(42, [spitter(0.05, -0.05, { x: 0, y: 1 })]), 0.5);
      expect(Math.abs(last())).toBeCloseTo(Math.PI, 1);
      // No target sent: the body turns into its walk, and the lag of that turn is no sidestep.
      renderer.apply(snap(42, [spitter(0.05, -0.05)]), snap(43, [spitter(0.1, -0.05)]), 0.5);
      expect(last()).toBe(0);
    } finally {
      told.mockRestore();
      resetMonsters();
      engine.dispose();
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  });

  /**
   * Trash wind-ups carry no `heavy` flag, so drawn as before every trash slam and
   * charge was a plain swing that landed long before the hit. A trash heavy's
   * slam now stretches to its impact without the boss's red glow, and a charger
   * runs its dash and starts its strike late, so the blow falls on the impact.
   */
  it("times a trash heavy's slam without a glow, and a charge's strike to the end of its run", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    const engine = new NullEngine();
    const { scene } = createScene(engine);
    const now = vi.spyOn(performance, "now");
    try {
      await loadMonsters(scene);
      now.mockReturnValue(1000);
      const renderer = new SnapshotRenderer(scene);
      const sentinel = (attackTick: number): SnapshotEntity => ({
        id: 7, kind: "monster", species: "monster.blood_sentinel.v1", x: 0, y: 0, attackTick,
      });
      const boar = (attackTick: number): SnapshotEntity => ({
        id: 9, kind: "monster", species: "monster.thornhide_boar.v1", x: -1, y: 0, attackTick,
      });
      // Half filled: a fresh tell glows 0 even for a boss.
      const slam: SnapshotEntity = { id: 8, kind: "telegraph", x: 1, y: 1, radius: 2.6, progress: 0.5, ownerId: 7, impactIn: 1 };
      const charge: SnapshotEntity = {
        id: 10, kind: "telegraph", x: 2, y: 2, radius: 1, progress: 0, ownerId: 9, impactIn: 1, fromX: -1, fromY: 0,
      };

      renderer.apply(null, snap(1, [sentinel(0), boar(0)]), 0);
      const heavy = creatureOf(scene.getMeshByName("entity-7") as Mesh)!.clipGroups;
      const runner = creatureOf(scene.getMeshByName("entity-9") as Mesh)!.clipGroups;
      renderer.apply(null, snap(2, [sentinel(2), boar(2), slam, charge]), 0);
      expect(heavy.get("slam")!.isPlaying, "the trash heavy slams").toBe(true);
      expect(heavy.get("slam")!.speedRatio).toBeCloseTo(0.667, 2);
      expect(glowing(scene, 7), "the glow stays the boss's").toBe(false);
      expect(runner.get("attack")!.isPlaying ?? false, "no swing at the start of the run").toBe(false);

      // The boar's blow is 0.3 s in at 1.3x: its strike starts 0.231 s before the impact.
      const startAt = 1000 + (1 - 0.3 / 1.3) * 1000;
      const late = { ...charge, impactIn: 0.25 };
      now.mockReturnValue(startAt - 5);
      renderer.apply(null, snap(2, [sentinel(2), boar(2), slam, late]), 0);
      expect(runner.get("attack")!.isPlaying ?? false, "still running").toBe(false);
      now.mockReturnValue(startAt + 5);
      renderer.apply(null, snap(2, [sentinel(2), boar(2), slam, late]), 0);
      expect(runner.get("attack")!.isPlaying, "the strike, a frame before its blow is due").toBe(true);
      expect(runner.get("attack")!.speedRatio).toBeCloseTo(1.3, 3);
    } finally {
      now.mockRestore();
      resetMonsters();
      engine.dispose();
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  });
  /**
   * The idle is breathing, and a paw is planted while the body breathes over it.
   * The walk's push-off roll run on the idle rocks each foot 17 degrees about its
   * ankle while the creature stands still.
   */
  /**
   * A shooter strafes square to the player and backs off it while its body
   * stays turned to its target, and the forward walk played under that slid it
   * sideways on legs stepping ahead. Each foot's stance (its lowest quarter of
   * the cycle) must push against the way the body really goes, as it does on a
   * plain walk: sideways for a strafe, ahead for a backpedal.
   */
  it("steps its legs the way it moves, not the way it faces", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    const engine = new NullEngine();
    const scene = new Scene(engine);
    scene.useConstantAnimationDeltaTime = true;
    new FreeCamera("cam", new Vector3(0, 10, -10), scene);
    try {
      await loadMonsters(scene);
      const strafers = [...MONSTERS.values()].filter((d) => d.ranged !== undefined).map((d) => d.id);
      expect(strafers.length).toBeGreaterThanOrEqual(4);
      let legged = 0;
      /** Each foot's lowest point walking ahead. */
      const lowest = new Map<string, number>();
      for (const id of strafers) {
        for (const rel of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
          const root = new Mesh(`${id}-${rel}`, scene);
          const rig = attachCreature(scene, root, id)!;
          const feet = root.getDescendants(false).filter((n) => /^(leg\d+_2|leg[LR]_ankle)$/.test(n.name)) as TransformNode[];
          if (feet.length === 0) { root.dispose(); rig.dispose(); continue; }
          if (rel === 0) legged++;
          const track = new Map<TransformNode, Vector3[]>(feet.map((f) => [f, []]));
          for (let frame = 0; frame < 150; frame++) {
            rig.setLocomotion(2);
            rig.setMoveAngle(rel);
            scene.render();
            if (frame < 60) continue;
            for (const f of feet) track.get(f)!.push(f.getAbsolutePosition().clone());
          }
          const move = new Vector3(Math.sin(rel), 0, Math.cos(rel));
          const across = new Vector3(move.z, 0, -move.x);
          for (const [f, at] of track) {
            const ys = at.map((p) => p.y);
            const low = Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * 0.25;
            const push = new Vector3();
            for (let k = 1; k < at.length; k++) if (at[k]!.y <= low && at[k - 1]!.y <= low) push.addInPlace(at[k]!.subtract(at[k - 1]!));
            const along = Vector3.Dot(push, move);
            const side = Math.abs(Vector3.Dot(push, across));
            const label = `${id} ${f.name} at ${Math.round((rel * 180) / Math.PI)} deg: along ${along.toFixed(3)} across ${side.toFixed(3)}`;
            expect(along, label).toBeLessThan(0);
            expect(-along, label).toBeGreaterThan(side);
            // Planted on the floor the clip puts it on, neither sunk nor lifted.
            const floor = Math.min(...ys);
            const ahead = lowest.get(`${id} ${f.name}`) ?? (lowest.set(`${id} ${f.name}`, floor), floor);
            expect(Math.abs(floor - ahead), label).toBeLessThan(0.01);
          }
          root.dispose();
          rig.dispose();
        }
      }
      expect(legged, "strafers with legs").toBe(3);
    } finally {
      resetMonsters();
      engine.dispose();
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  });

  it("keeps every foot at one angle to the ground through the idle", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const container = await LoadAssetContainerAsync("/models/monsters.glb", scene);
      container.addAllToScene();
      const depth = (n: TransformNode) => { let d = 0; for (let p = n.parent; p; p = p.parent) d++; return d; };
      const nodes = [...container.transformNodes].sort((a, b) => depth(a) - depth(b));
      const idles = container.animationGroups.filter((g) => g.name.endsWith("|idle"));
      expect(idles.length).toBeGreaterThan(0);
      for (const group of idles) {
        const feet = [...new Set(group.targetedAnimations.map((a) => a.target as TransformNode))]
          .filter((t) => /^leg\d+_2$/.test(t.name));
        group.start(true);
        group.pause();
        const first = new Map<TransformNode, import("@babylonjs/core").Quaternion>();
        let worst = 0;
        for (let k = 0; k <= 12; k++) {
          group.goToFrame(group.from + ((group.to - group.from) * k) / 12);
          for (const n of nodes) n.computeWorldMatrix(true);
          for (const foot of feet) {
            const q = foot.absoluteRotationQuaternion.clone();
            const q0 = first.get(foot) ?? (first.set(foot, q), q);
            worst = Math.max(worst, 2 * Math.acos(Math.min(1, Math.abs(q.dot(q0)))));
          }
        }
        group.stop();
        expect(worst, `${group.name} rocks a foot by ${worst.toFixed(3)} rad`).toBeLessThan(0.02);
      }
    } finally {
      engine.dispose();
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  });
});
