// @vitest-environment node
import { readFileSync } from "node:fs";
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
} from "./rig";

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

  it("tints a rare or unique piece without changing which geometry it wears", () => {
    const plain = looksForEquipment({ body: { rarity: "normal" } }).body!;
    for (const rarity of ["rare", "unique"]) {
      const tinted = looksForEquipment({ body: { rarity } }).body!;
      // Same look, different variant: the tier shows as colour, not as a new mesh.
      expect(meshLook(tinted)).toBe(meshLook(plain));
      expect(tinted).toBe(`${meshLook(plain)}#${rarity}`);
    }
  });

  it("leaves normal and magic gear in its authored colours", () => {
    const plain = looksForEquipment({ body: {} }).body!;
    for (const rarity of ["normal", "magic"]) {
      expect(looksForEquipment({ body: { rarity } }).body).toBe(plain);
    }
    expect(plain).toBe(meshLook(plain));
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
  ) as { nodes: { name: string; skin?: number }[]; skins: { joints: number[] }[] };
  const skinned = json.nodes.filter((n) => n.skin !== undefined).map((n) => n.name);

  it("rides the same single 65-joint skeleton as the source packs", () => {
    expect(json.skins).toHaveLength(1);
    expect(json.skins[0]!.joints).toHaveLength(65);
  });

  it("carries a head, because neither source pack has one", () => {
    expect(skinned.filter((n) => n.startsWith("base.head.")).length).toBeGreaterThan(0);
  });

  it("carries every look the code can ask for", () => {
    const asked = new Set<string>();
    for (const looks of [
      looksForEquipment({}),
      looksForEquipment(Object.fromEntries(COSMETIC_SLOTS.map((s) => [s, {}]))),
      // Rarity variants must resolve to geometry that exists too: they only
      // recolour a look, so a tint must never invent a mesh name.
      ...["magic", "rare", "unique"].map((rarity) =>
        looksForEquipment(Object.fromEntries(COSMETIC_SLOTS.map((s) => [s, { rarity }]))),
      ),
    ]) {
      for (const slot of COSMETIC_SLOTS) {
        const look = looks[slot];
        if (look !== null) asked.add(`${slot}.${meshLook(look)}.`);
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
