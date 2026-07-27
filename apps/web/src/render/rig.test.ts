// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core";
import { createScene } from "./engine";
import { makeMesh } from "./meshes";
import {
  clipForSpeed,
  isRigReady,
  loadPlayerRig,
  resetPlayerRig,
  speedRatioFor,
  looksForEquipment,
  meshLook,
  COSMETIC_SLOTS,
  GEAR_TEXTURE_BASES,
  SKIRT_CHAINS,
} from "./rig";
import { ITEM_POOLS } from "@exiled/content-runtime";

const ITEM_BASES = ITEM_POOLS.bases;

let engine: InstanceType<typeof NullEngine>;

afterEach(() => {
  resetPlayerRig();
  engine?.dispose();
});

describe("clipForSpeed", () => {
  it("stands still below the idle threshold", () => {
    expect(clipForSpeed(0)).toBe("idle");
    expect(clipForSpeed(0.1)).toBe("idle");
  });

  it("walks at a stroll and jogs at the player's base speed", () => {
    expect(clipForSpeed(1.0)).toBe("walk");
    expect(clipForSpeed(2.1)).toBe("walk");
    // baseCasterStats moveSpeed is 3.5 u/s, which must read as a jog.
    expect(clipForSpeed(3.5)).toBe("run");
  });
});

describe("speedRatioFor", () => {
  it("matches the walk stride to the actor's ground speed", () => {
    expect(speedRatioFor("walk", 1.4)).toBeCloseTo(1, 5);
    expect(speedRatioFor("walk", 2.1)).toBeCloseTo(1.5, 5);
  });

  it("runs the jog above a literal speed match, which reads better", () => {
    // 3.4 is the clip's authored speed; the cadence trim trades a little foot
    // slide for a stride that does not look sluggish.
    expect(speedRatioFor("run", 3.4)).toBeGreaterThan(1);
    expect(speedRatioFor("run", 3.4)).toBeLessThan(1.35);
  });

  it("still scales with speed so the legs track the movement", () => {
    // Both ends inside the clamp, so the doubling has to show through.
    expect(speedRatioFor("run", 3.4)).toBeCloseTo(2 * speedRatioFor("run", 1.7), 5);
  });

  it("clamps extremes and leaves one-shots alone", () => {
    expect(speedRatioFor("run", 0.01)).toBe(0.5);
    expect(speedRatioFor("walk", 100)).toBe(1.8);
    expect(speedRatioFor("cast", 3.5)).toBe(1);
    expect(speedRatioFor("idle", 0)).toBe(1);
  });
});

describe("rig fallback", () => {
  it("reports not ready before anything is loaded", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    expect(isRigReady(scene)).toBe(false);
  });

  it("survives a failed model fetch instead of throwing", async () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    // There is no HTTP server here, so every model URL fails. The lab must
    // still run, on the primitive actor.
    await loadPlayerRig(scene);
    expect(isRigReady(scene)).toBe(false);
  });

  it("builds the primitive caster when the rig is unavailable", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const player = makeMesh(scene, "player", "entity-0");
    // The primitive actor stashes its swinging limbs on the root; a rigged one
    // would carry a `rig` instead.
    const parts = player.metadata as { limbs?: unknown[]; rig?: unknown } | null;
    expect(parts?.limbs?.length).toBeGreaterThan(0);
    expect(parts?.rig).toBeUndefined();
  });
});

describe("looksForEquipment", () => {
  it("dresses an empty character as a commoner, never bare", () => {
    const bare = looksForEquipment({});
    // Body and boots must always render something: a naked character is a bug,
    // and the packs have no naked body to fall back to anyway.
    expect(bare.body).not.toBeNull();
    expect(bare.boots).not.toBeNull();
    expect(bare.helmet).toBeNull();
  });

  it("shows an armoured look for any item in a slot", () => {
    const bare = looksForEquipment({});
    for (const slot of COSMETIC_SLOTS) {
      const worn = looksForEquipment({ [slot]: {} });
      expect(worn[slot]).not.toBeNull();
      expect(worn[slot]).not.toBe(bare[slot]);
    }
  });

  it("leaves the other slots alone when one is filled", () => {
    const worn = looksForEquipment({ helmet: {} });
    const bare = looksForEquipment({});
    expect(worn.body).toBe(bare.body);
    expect(worn.boots).toBe(bare.boots);
  });

  it("dresses a slot the same whatever the item's rarity rolled", () => {
    // A rarity tint was tried here and reverted: it recoloured the whole
    // silhouette rather than reading as one special piece. Rarity must stay out
    // of the look until there is accent geometry to give it.
    const plain = looksForEquipment({ body: {} }).body;
    for (const rarity of ["normal", "magic", "rare", "unique"]) {
      expect(looksForEquipment({ body: { rarity } }).body).toBe(plain);
    }
  });

  it("wears the equipped base's armour texture, and only for a base that has one", () => {
    const plain = looksForEquipment({ body: {} }).body!;
    const geared = looksForEquipment({ body: { baseId: "base.emberweave_robe" } }).body!;
    // The texture rides along with the look; the geometry it names is unchanged.
    expect(geared).toBe(`${plain}#base.emberweave_robe`);
    expect(meshLook(geared)).toBe(plain);
    // An unmapped base keeps the authored look rather than asking for a missing file.
    expect(looksForEquipment({ body: { baseId: "base.nonexistent" } }).body).toBe(plain);
  });
});

/**
 * The armour textures are baked offline from the item icons, so nothing at build
 * time connects the base ids in `items.ts`, the files in `public/textures/gear/`
 * and the table in `rig.ts`. A base renamed in content would silently go back to
 * wearing green linen. This pins all three together.
 */
describe("gear textures", () => {
  const GEAR = fileURLToPath(new URL("../../public/textures/gear/", import.meta.url));

  it("ships a texture file for every base the rig can ask for", () => {
    expect(GEAR_TEXTURE_BASES.length).toBeGreaterThan(0);
    for (const baseId of GEAR_TEXTURE_BASES) {
      const slug = baseId.split(".", 2)[1]!;
      expect(existsSync(`${GEAR}${slug}.png`)).toBe(true);
    }
  });

  it("names bases that content actually defines", () => {
    const defined = new Set(ITEM_BASES.map((b) => b.id));
    for (const baseId of GEAR_TEXTURE_BASES) expect(defined).toContain(baseId);
  });

  it("covers every base that can fill a cosmetic slot", () => {
    // Any equippable armour base without a texture renders as green ranger gear
    // next to charred-iron item art, which is the mismatch this whole pipeline
    // exists to remove.
    const cosmetic = new Set<string>(COSMETIC_SLOTS);
    const missing = ITEM_BASES.filter(
      (b) => b.itemClass !== undefined && cosmetic.has(b.itemClass) && !GEAR_TEXTURE_BASES.includes(b.id),
    );
    expect(missing.map((b) => b.id)).toEqual([]);
  });
});

/**
 * The runtime dresses the character by name: it shows every mesh prefixed
 * `<slot>.<look>.` and hides the rest of that slot. Nothing checks that spelling
 * at build time, so a renamed part in `tools/build_wardrobe.py` would surface
 * only as an invisible limb in the running game. This pins the two together.
 */
describe("wardrobe asset", () => {
  const MODELS = fileURLToPath(new URL("../../public/models/", import.meta.url));
  const glb = readFileSync(`${MODELS}wardrobe.glb`);
  const json = JSON.parse(
    glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"),
  ) as {
    nodes: { name: string; mesh?: number; skin?: number; translation?: [number, number, number] }[];
    skins: { joints: number[] }[];
    meshes: { primitives: { attributes: Record<string, number> }[] }[];
    accessors: {
      bufferView: number;
      byteOffset?: number;
      componentType: number;
      count: number;
      type: string;
    }[];
    bufferViews: { byteOffset?: number; byteStride?: number }[];
  };
  const skinned = json.nodes.filter((n) => n.skin !== undefined).map((n) => n.name);

  /** The glb's binary chunk: past the header, the json chunk, and its own header. */
  const bin = 20 + glb.readUInt32LE(12) + 8;

  /** One vertex attribute, read out of the binary chunk as a flat array. */
  function attribute(mesh: string, name: string): { data: number[]; stride: number } {
    const node = json.nodes.find((n) => n.name === mesh && n.mesh !== undefined)!;
    const accessor = json.accessors[json.meshes[node.mesh!]!.primitives[0]!.attributes[name]!]!;
    const view = json.bufferViews[accessor.bufferView]!;
    const stride = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type]!;
    // Only the component types glTF allows for JOINTS_0 and WEIGHTS_0.
    const read: Record<number, [number, (o: number) => number]> = {
      5121: [1, (o) => glb.readUInt8(o)],
      5123: [2, (o) => glb.readUInt16LE(o)],
      5126: [4, (o) => glb.readFloatLE(o)],
    };
    const [size, readAt] = read[accessor.componentType]!;
    const start = bin + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const step = view.byteStride ?? size * stride;
    const data: number[] = [];
    for (let i = 0; i < accessor.count; i++) {
      for (let c = 0; c < stride; c++) data.push(readAt(start + i * step + c * size));
    }
    return { data, stride };
  }

  it("rides one skeleton: the packs' 65 joints plus the coat's chains", () => {
    expect(json.skins).toHaveLength(1);
    const joints = json.skins[0]!.joints.map((j) => json.nodes[j]!.name);
    const skirt = joints.filter((n) => n.startsWith("skirt_"));
    // Every borrowed mesh binds by joint order, so the pack joints must still be
    // all of the skeleton except what the builder adds for cloth.
    expect(joints.length - skirt.length).toBe(65);
    // Against the constant, not against 16: the chain count lives in the builder
    // and in `rig.ts`, and a rebuild with one of them changed drops chains out of
    // the coat silently.
    expect(skirt.length).toBe(SKIRT_CHAINS * 2);
  });

  it("hangs every skirt chain on effectively one segment length", () => {
    // `rig.ts` measures one chain and solves all eight against it. They are not
    // bit-identical, because the coat is an ellipse and a chain at the hip
    // travels further out than one at the belly, but that spread is 0.2% - a
    // millimetre on this character. A ring that drifted past 1% would render as
    // cloth of the wrong length on seven chains out of eight.
    const lengths = json.nodes
      .filter((n) => /^skirt_\d+_02$/.test(n.name))
      .map((n) => Math.hypot(...(n.translation ?? [0, 0, 0])));
    expect(lengths).toHaveLength(SKIRT_CHAINS);
    expect(lengths[0]).toBeGreaterThan(0.1);
    for (const length of lengths) {
      expect(Math.abs(length - lengths[0]!) / lengths[0]!).toBeLessThan(0.01);
    }
  });

  it("binds every coat vertex to a single chain, so collision can reach it", () => {
    // The solver collides the chains and nothing else: two particles per chain,
    // pushed out of the leg capsules. A vertex weighted half to one chain and
    // half to its neighbour is skinned to the average of the two, which lies on
    // neither of them — it hangs in the gap *between* the collided lines, and no
    // capsule can ever push it. Measured on the running character, those split
    // vertices sat up to 0.088 off the nearest chain, wider than the whole thigh
    // capsule (0.088), so a leg swinging between two chains passed through the
    // coat while the solver reported every particle clear.
    //
    // The fix is a chain per coat column, and this is what pins it: one ring
    // coarser than the other silently re-opens the gap. It is a weight test
    // rather than a count test because the counts live in two languages.
    const joints = json.skins[0]!.joints.map((j) => json.nodes[j]!.name);
    const chainOf = joints.map((n) => /^skirt_(\d+)_/.exec(n)?.[1] ?? null);
    const { data: index } = attribute("body.ranger.coat", "JOINTS_0");
    const { data: weight } = attribute("body.ranger.coat", "WEIGHTS_0");

    let worst = 0;
    for (let v = 0; v < weight.length / 4; v++) {
      const perChain = new Map<string, number>();
      for (let k = 0; k < 4; k++) {
        const chain = chainOf[index[v * 4 + k]!] ?? null;
        if (chain === null) continue; // the pelvis holds the pinned waist band
        perChain.set(chain, (perChain.get(chain) ?? 0) + weight[v * 4 + k]!);
      }
      const shares = [...perChain.values()].sort((a, b) => b - a);
      worst = Math.max(worst, shares[1] ?? 0);
    }
    expect(worst).toBeLessThan(0.01);
  });

  it("carries a head, because neither source pack has one", () => {
    expect(skinned.filter((n) => n.startsWith("base.head.")).length).toBeGreaterThan(0);
  });

  it("carries the coat, which is the armoured body's silhouette", () => {
    // Generated, not cut from a pack: every body base is drawn as a long coat
    // and the ranger's authored body stops at the hip. Lose this part in a
    // rebuild and the character silently goes back to wearing a tunic, which
    // the look-prefix tests above would not notice.
    expect(skinned).toContain("body.ranger.coat");
  });

  it("carries the helm, which is the iron half of a helmet", () => {
    // Generated from the cowl's own crown: the pack ships cloth and every helmet
    // base is drawn as a riveted shell over it. Lose this part in a rebuild and
    // the character goes back to a soft hood under charred-iron item art, which
    // the look-prefix test below would not notice - the hood is still there.
    expect(skinned).toContain("helmet.hood.helm");
  });

  it("carries every look the code can ask for", () => {
    const asked = new Set<string>();
    for (const looks of [
      looksForEquipment({}),
      looksForEquipment(Object.fromEntries(COSMETIC_SLOTS.map((s) => [s, {}]))),
    ]) {
      for (const slot of COSMETIC_SLOTS) {
        if (looks[slot] !== null) asked.add(`${slot}.${looks[slot]}.`);
      }
    }
    expect(asked.size).toBeGreaterThan(0);
    for (const prefix of asked) {
      expect(skinned.some((n) => n.startsWith(prefix))).toBe(true);
    }
  });

  it("skins every part, so no piece floats free of the rig", () => {
    const meshNodes = json.nodes.filter((n) => n.name.includes("."));
    expect(meshNodes.length).toBe(skinned.length);
  });
});

/**
 * The modular wardrobe rests entirely on the packs being skin-compatible: a mesh
 * from one is bound to the other's live skeleton by assignment alone, with no
 * retargeting. That holds only while every pack lists the same joints in the
 * same order with the same inverse bind matrices. It is an asset invariant, not
 * a code one, so it is checked against the files a new pack would have to join.
 */
describe("pack skin compatibility", () => {
  const PACKS = fileURLToPath(new URL("../../../../assets/characters/", import.meta.url));

  /** Joint names in skin order, plus the flat inverse bind matrix buffer. */
  function readSkin(file: string): { joints: string[]; ibm: Float32Array } {
    const gltf = JSON.parse(readFileSync(`${PACKS}${file}.gltf`, "utf8"));
    const bin = readFileSync(`${PACKS}${file}.bin`);
    const accessor = gltf.accessors[gltf.skins[0].inverseBindMatrices];
    const view = gltf.bufferViews[accessor.bufferView];
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const ibm = new Float32Array(accessor.count * 16);
    for (let i = 0; i < ibm.length; i++) ibm[i] = bin.readFloatLE(start + i * 4);
    return { joints: gltf.skins[0].joints.map((j: number) => gltf.nodes[j].name), ibm };
  }

  const ranger = readSkin("Male_Ranger");
  const peasant = readSkin("Male_Peasant");

  it("lists the same joints in the same order", () => {
    expect(ranger.joints).toHaveLength(65);
    expect(peasant.joints).toEqual(ranger.joints);
  });

  it("binds those joints at the same rest pose", () => {
    // Bit-identical in both packs today. Any drift here means a borrowed mesh
    // would deform against the wrong bind pose, so exactness is the point.
    expect(peasant.ibm).toEqual(ranger.ibm);
  });

  it("keeps the pieces the mixed outfit borrows", () => {
    // Named in rig.ts; renaming a mesh in the pack would silently drop the piece.
    const gltf = JSON.parse(readFileSync(`${PACKS}Male_Ranger.gltf`, "utf8"));
    const names = gltf.meshes.map((m: { name: string }) => m.name);
    expect(names).toContain("Male_Ranger_Head_Hood");
    expect(names).toContain("Male_Ranger_Acc_Pauldron");
  });
});
