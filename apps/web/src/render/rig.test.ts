// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach } from "vitest";
import { LoadAssetContainerAsync, NullEngine } from "@babylonjs/core";
import { createScene } from "./engine";
import { makeMesh } from "./meshes";
import {
  actionRatio,
  ACTION_RATIO_MAX,
  ACTION_RATIO_MIN,
  aimAngles,
  ARM_MAX,
  CLIP_BIAS,
  HEAD_FOLLOW,
  HEAD_MAX,
  clipForSpeed,
  CLIP_NAME,
  idleRatio,
  indexRigSubtree,
  IDLE_SETTLE_SEC,
  IDLE_SETTLED,
  isRigReady,
  loadPlayerRig,
  resetPlayerRig,
  speedRatioFor,
  BASE_LOOKS,
  NO_LOOKS,
  SLOTS,
  HIPS_BOB,
  STRIKE_CLIPS,
  isLayeredClip,
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
    // baseCasterStats moveSpeed is 3.5 u/s, and it must read as a jog. Handing
    // that speed to the walk clip played fast is a power-walk, not a run.
    expect(clipForSpeed(3.5)).toBe("run");
  });
});

describe("speedRatioFor", () => {
  it("matches the walk stride to the actor's ground speed", () => {
    expect(speedRatioFor("walk", 1.4)).toBeCloseTo(1, 5);
    expect(speedRatioFor("walk", 2.1)).toBeCloseTo(1.5, 5);
  });

  it("paces the walk on its own stride and turns the jog over a little quicker", () => {
    // The walk is literal: 1.0 keeps its planted foot planted.
    expect(speedRatioFor("walk", 1.4)).toBeCloseTo(1, 5);
    // The jog trades a little slide for steps that are not bounds — its clip
    // depicts 4 u/s and the player only covers 3.5; cadence 1.32 turns the legs
    // over quicker than the ground to match the footstep cues.
    expect(speedRatioFor("run", 3.5)).toBeGreaterThan(1.1);
    expect(speedRatioFor("run", 3.5)).toBeLessThan(1.35);
  });

  it("holds the jog through a corner instead of flicking to a walk", () => {
    // The sim sheds speed into a turn; a single threshold sat inside that dip.
    expect(clipForSpeed(2.0, "run")).toBe("run");
    expect(clipForSpeed(2.0, "walk")).toBe("walk");
    // Far enough down and it really is a walk again, whatever it was doing.
    expect(clipForSpeed(1.5, "run")).toBe("walk");
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

describe("actionRatio", () => {
  it("fits the authored clip into the wind-up the sim granted", () => {
    // A 1s swing inside a 0.5s cast plays at twice speed, so the release pose
    // lands on the tick the hit does instead of a third of the way in.
    expect(actionRatio(1, 0.5)).toBeCloseTo(2, 5);
    expect(actionRatio(1, 1)).toBeCloseTo(1, 5);
  });

  it("clamps so a short wind-up is not a one-frame twitch", () => {
    expect(actionRatio(1, 0.01)).toBe(ACTION_RATIO_MAX);
    expect(actionRatio(1, 100)).toBe(ACTION_RATIO_MIN);
  });

  it("falls back to the authored rate when the window is unknown", () => {
    expect(actionRatio(1, undefined)).toBe(1);
    expect(actionRatio(0, 0.5)).toBe(1);
  });
});

describe("aimAngles", () => {
  it("leaves the head straight when the body already faces the aim", () => {
    // A standing cast turns the body onto the aim, so the residual angle is
    // zero. The arm still gets the clip's own bias, because the mirrored cast
    // bakes it right of where it points; the neck must not inherit that or the
    // head sits cocked to one side for the whole cast.
    const { arm, head } = aimAngles(1.2, 1.2);
    expect(arm).toBeCloseTo(CLIP_BIAS, 5);
    expect(head).toBeCloseTo(0, 5);
  });

  it("turns the head toward an aim the body has not caught up with", () => {
    // Body at 0, target a half-radian to its right: the head leads the turn.
    const right = aimAngles(0.5, 0);
    expect(right.head).toBeCloseTo(-0.5 * HEAD_FOLLOW, 5);
    const left = aimAngles(-0.5, 0);
    expect(left.head).toBeCloseTo(0.5 * HEAD_FOLLOW, 5);
  });

  it("clamps both, so neither the shoulder nor the neck breaks", () => {
    expect(aimAngles(-2, 0).arm).toBe(ARM_MAX);
    expect(aimAngles(2, 0).arm).toBe(-ARM_MAX);
    expect(aimAngles(-2, 0).head).toBeCloseTo(HEAD_MAX * HEAD_FOLLOW, 5);
    expect(aimAngles(2, 0).head).toBeCloseTo(-HEAD_MAX * HEAD_FOLLOW, 5);
  });

  it("aiming at his own back picks a side rather than tearing", () => {
    // Straight behind, the bias pushes the arm past a half turn and it wraps to
    // the other shoulder. Both ends are the same pose, so either is right; this
    // pins WHICH, because a silent flip here would read as a twitch.
    expect(aimAngles(-Math.PI + 0.1, 0).arm).toBe(-ARM_MAX);
    expect(aimAngles(-Math.PI + 0.5, 0).arm).toBe(ARM_MAX);
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

  /**
   * The menu stage and the game are two Babylon scenes in one page's lifetime,
   * and in dev StrictMode makes even one screen two. An asset container belongs
   * to the scene it was loaded with, so handing a second scene the first's
   * in-flight load leaves `isRigReady` false for the scene that is actually on
   * screen — which showed up as a character select with nobody standing in it.
   */
  it("does not hand two scenes the same load", () => {
    engine = new NullEngine();
    const a = createScene(engine).scene;
    const b = createScene(engine).scene;
    const first = loadPlayerRig(a);
    // The same scene asking twice shares, which is what the cache is for...
    expect(loadPlayerRig(a)).toBe(first);
    // ...and a different scene never does.
    expect(loadPlayerRig(b)).not.toBe(first);
  });

  it("an abandoned scene's teardown leaves another scene's load alone", async () => {
    engine = new NullEngine();
    const a = createScene(engine).scene;
    const b = createScene(engine).scene;
    const pending = loadPlayerRig(b);
    // `a` never loaded anything; tearing it down must not cancel b's load.
    resetPlayerRig(a);
    await pending;
    // Headless there is no server, so neither is ready — what is being pinned
    // is that resetting `a` did not throw away `b`'s in-flight work.
    expect(isRigReady(a)).toBe(false);
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

/**
 * The runtime dresses the character by name: it shows every mesh prefixed
 * `<slot>.<look>.` and hides the rest of that slot. Nothing checks that spelling
 * at build time, so a renamed part in `tools/build_wardrobe.py` would surface
 * only as an invisible limb in the running game. This pins the two together.
 */
/** Which joint each rigid piece must hang from, and nothing else. */
const RIGID_BONES: Record<string, string> = {
  "helmet.iron.helm": "Head",
  "weapon1.emberwand.mesh": "hand_r",
  "weapon2.buckler.mesh": "lowerarm_l",
};

/**
 * Every joint the suit is allowed to answer to; see `PLATE_BONES` in the build.
 * It is one shell from the gorget to the fauld's hem, so it answers to the hips
 * and both thighs as well as the trunk and the shoulders.
 */
const PLATE_BONES = [
  "spine_01", "spine_02", "spine_03", "neck_01",
  "clavicle_l", "clavicle_r", "upperarm_l", "upperarm_r",
  "pelvis", "thigh_l", "thigh_r",
];


/**
 * Every joint the trousers are allowed to answer to; see `LEG_BONES` in the
 * build, plus the `spine_01` the waist rim picks up off the body's own weights.
 */
const LEG_BONES = ["pelvis", "thigh_l", "thigh_r", "calf_l", "calf_r", "spine_01"];

/**
 * Each sabaton and the leg it belongs to; see `SABATON_BONES` in the build.
 *
 * The pair is the point. One boot is fitted to the right leg and the other is
 * that mesh reflected across the body's mid-plane, so a left sabaton that kept
 * a single `_r` group would ride the far leg across the character.
 */
const SABATON_BONES: Record<string, string[]> = {
  "boots.plate.sabaton_r": ["calf_r", "foot_r", "ball_r"],
  "boots.plate.sabaton_l": ["calf_l", "foot_l", "ball_l"],
};

const COMPONENTS: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** Read one glTF accessor out of the binary chunk as a flat number array. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readAccessor(json: any, bin: Buffer, index: number): number[] {
  const acc = json.accessors[index];
  const view = json.bufferViews[acc.bufferView];
  const per = TYPE_COUNT[acc.type]!;
  const size = COMPONENTS[acc.componentType]!;
  const stride = view.byteStride ?? per * size;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out: number[] = [];
  for (let i = 0; i < acc.count; i += 1) {
    for (let c = 0; c < per; c += 1) {
      const at = base + i * stride + c * size;
      switch (acc.componentType) {
        case 5121: out.push(bin.readUInt8(at)); break;
        case 5123: out.push(bin.readUInt16LE(at)); break;
        case 5125: out.push(bin.readUInt32LE(at)); break;
        case 5126: out.push(bin.readFloatLE(at)); break;
        default: throw new Error(`unhandled componentType ${acc.componentType}`);
      }
    }
  }
  return out;
}

describe("wardrobe asset", () => {
  const MODELS = fileURLToPath(new URL("../../public/models/", import.meta.url));
  const glb = readFileSync(`${MODELS}wardrobe.glb`);
  const json = JSON.parse(
    glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any as {
    nodes: { name: string; mesh?: number; skin?: number; children?: number[] }[];
    skins: { joints: number[] }[];
    meshes: { name: string; primitives: { attributes: Record<string, number> }[] }[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    accessors: any[]; bufferViews: any[]; buffers0Len: number;
  };
  // The JSON chunk is padded to four bytes and the BIN chunk header is another
  // eight; without both the binary offsets land mid-accessor.
  json.buffers0Len = (glb.readUInt32LE(12) + 3 & ~3) + 8;
  const skinned = json.nodes.filter((n) => n.skin !== undefined).map((n) => n.name);

  it("ships the two base bodies and the rigid gear, and nothing else", () => {
    const meshNames = json.meshes.map((m) => m.name).sort();
    expect(meshNames).toEqual([
      "base.female.body", "base.female.brows", "base.female.eyes", "base.female.hair",
      "base.male.body", "base.male.brows", "base.male.eyes", "base.male.hair",
      "helmet.iron.helm", "weapon1.emberwand.mesh", "weapon2.buckler.mesh",
      "chest.plate.cuirass", "chest.plate.legs",
      "boots.plate.sabaton_l", "boots.plate.sabaton_r",
    ].sort());
  });

  /**
   * The whole reason the client needs no socket, no parenting and no per-frame
   * work for held and worn gear: each rigid piece is skinned entirely to the one
   * joint it hangs from, so it rides the skeleton exactly the way the body does.
   * A piece that picked up a second influence would start deforming, and a piece
   * bound to the wrong joint would follow the wrong limb - neither shows up in a
   * name check, so the weights are read out of the buffer.
   */
  it("binds every rigid piece to exactly one joint at full weight", () => {
    const bin = glb.subarray(20 + json.buffers0Len);
    for (const [mesh, bone] of Object.entries(RIGID_BONES)) {
      const node = json.nodes.find((n) => n.name === mesh);
      expect(node, `no node ${mesh}`).toBeDefined();
      const prim = json.meshes[node!.mesh!]!.primitives[0]!;
      const joints = readAccessor(json, bin, prim.attributes["JOINTS_0"]!);
      const weights = readAccessor(json, bin, prim.attributes["WEIGHTS_0"]!);
      const skin = json.skins[node!.skin!]!;
      const used = new Set<number>();
      for (let v = 0; v < weights.length / 4; v += 1) {
        const w = weights.slice(v * 4, v * 4 + 4);
        const j = joints.slice(v * 4, v * 4 + 4);
        for (let k = 0; k < 4; k += 1) {
          if (w[k]! > 0.0001) used.add(j[k]!);
        }
        expect(w[0]).toBeCloseTo(1, 4);
      }
      expect([...used]).toHaveLength(1);
      expect(json.nodes[skin.joints[[...used][0]!]!]!.name).toBe(bone);
    }
  });

  /**
   * The suit is the one worn piece that is NOT rigid, and the difference has to be
   * asserted rather than assumed: a torso plate skinned to a single joint passes
   * the name check, looks right standing still, and swings off the shoulders the
   * moment the spine bends. So it must use several joints, all of them from the
   * set it was fitted against, and every vertex must carry a full unit of weight
   * - an unnormalised vertex drags toward the origin as a spike.
   */
  it("deforms the suit over the spine, both shoulders and both thighs", () => {
    const bin = glb.subarray(20 + json.buffers0Len);
    const node = json.nodes.find((n) => n.name === "chest.plate.cuirass");
    expect(node, "no node chest.plate.cuirass").toBeDefined();
    const prim = json.meshes[node!.mesh!]!.primitives[0]!;
    const joints = readAccessor(json, bin, prim.attributes["JOINTS_0"]!);
    const weights = readAccessor(json, bin, prim.attributes["WEIGHTS_0"]!);
    const skin = json.skins[node!.skin!]!;
    const used = new Set<number>();
    for (let v = 0; v < weights.length / 4; v += 1) {
      const w = weights.slice(v * 4, v * 4 + 4);
      const j = joints.slice(v * 4, v * 4 + 4);
      for (let k = 0; k < 4; k += 1) {
        if (w[k]! > 0.0001) used.add(j[k]!);
      }
      expect(w[0]! + w[1]! + w[2]! + w[3]!).toBeCloseTo(1, 3);
    }
    const names = [...used].map((u) => json.nodes[skin.joints[u]!]!.name).sort();
    expect(names.length).toBeGreaterThan(1);
    expect(names.every((n) => PLATE_BONES.includes(n)), `strays: ${names}`).toBe(true);
    expect(names).toContain("spine_03");
    // The fauld is part of the same shell: without the legs it stays welded to
    // the pelvis and a thigh walks straight out through it.
    expect(names).toContain("thigh_l");
    expect(names).toContain("thigh_r");
  });

  /**
   * The trousers are the body's own leg surface pushed out four millimetres, so
   * their weights are the skin's weights and nothing else: a group from outside
   * the leg set means the copy picked up a neighbour's influence and the leather
   * will part from the leg it was cut from, which is the one thing this
   * technique exists to make impossible.
   */
  it("deforms the trousers over the legs alone, on the body's own weights", () => {
    const bin = glb.subarray(20 + json.buffers0Len);
    const node = json.nodes.find((n) => n.name === "chest.plate.legs");
    expect(node, "no node chest.plate.legs").toBeDefined();
    const prim = json.meshes[node!.mesh!]!.primitives[0]!;
    const joints = readAccessor(json, bin, prim.attributes["JOINTS_0"]!);
    const weights = readAccessor(json, bin, prim.attributes["WEIGHTS_0"]!);
    const skin = json.skins[node!.skin!]!;
    const used = new Set<number>();
    for (let v = 0; v < weights.length / 4; v += 1) {
      const w = weights.slice(v * 4, v * 4 + 4);
      const j = joints.slice(v * 4, v * 4 + 4);
      for (let k = 0; k < 4; k += 1) {
        if (w[k]! > 0.0001) used.add(j[k]!);
      }
      expect(w[0]! + w[1]! + w[2]! + w[3]!).toBeCloseTo(1, 3);
    }
    const names = [...used].map((u) => json.nodes[skin.joints[u]!]!.name).sort();
    expect(names.every((n) => LEG_BONES.includes(n)), `strays: ${names}`).toBe(true);
    expect(names).toContain("thigh_l");
    expect(names).toContain("calf_r");
  });

  /**
   * The boots deform too, and each one has to answer to its OWN leg. A mirrored
   * mesh is a copy, so its weights arrive naming the leg it was fitted to: miss
   * the rename and the left boot walks with the right foot, which stands still
   * in the bind pose and tears across the character on the first stride.
   */
  it("deforms each sabaton over its own calf, ankle and ball", () => {
    const bin = glb.subarray(20 + json.buffers0Len);
    for (const [mesh, bones] of Object.entries(SABATON_BONES)) {
      const node = json.nodes.find((n) => n.name === mesh);
      expect(node, `no node ${mesh}`).toBeDefined();
      const prim = json.meshes[node!.mesh!]!.primitives[0]!;
      const joints = readAccessor(json, bin, prim.attributes["JOINTS_0"]!);
      const weights = readAccessor(json, bin, prim.attributes["WEIGHTS_0"]!);
      const skin = json.skins[node!.skin!]!;
      const used = new Set<number>();
      for (let v = 0; v < weights.length / 4; v += 1) {
        const w = weights.slice(v * 4, v * 4 + 4);
        const j = joints.slice(v * 4, v * 4 + 4);
        for (let k = 0; k < 4; k += 1) {
          if (w[k]! > 0.0001) used.add(j[k]!);
        }
        expect(w[0]! + w[1]! + w[2]! + w[3]!).toBeCloseTo(1, 3);
      }
      const names = [...used].map((u) => json.nodes[skin.joints[u]!]!.name).sort();
      expect(names.length, mesh).toBeGreaterThan(1);
      expect(names.every((n) => bones.includes(n)), `${mesh} strays: ${names}`).toBe(true);
      expect(names, mesh).toContain(bones[1]);
    }
  });

  /**
   * The pair is one mesh and its reflection, so the two must be the same size
   * and stand on opposite sides of the body's mid-plane. Refitting the mirror
   * image instead would let the search land on its own ratio and put visibly
   * different steel on the two legs.
   */
  it("stands the two sabatons on opposite legs, same steel on both", () => {
    const bin = glb.subarray(20 + json.buffers0Len);
    const centres = ["boots.plate.sabaton_r", "boots.plate.sabaton_l"].map((mesh) => {
      const node = json.nodes.find((n) => n.name === mesh)!;
      const prim = json.meshes[node.mesh!]!.primitives[0]!;
      const pos = readAccessor(json, bin, prim.attributes["POSITION"]!);
      const axis = (c: number): [number, number] => {
        let lo = Infinity;
        let hi = -Infinity;
        for (let v = 0; v < pos.length / 3; v += 1) {
          lo = Math.min(lo, pos[v * 3 + c]!);
          hi = Math.max(hi, pos[v * 3 + c]!);
        }
        return [lo, hi];
      };
      return { x: axis(0), y: axis(1), z: axis(2) };
    });
    const [right, left] = centres as [typeof centres[0], typeof centres[0]];
    // glTF is exported Y-up, so the mid-plane is x and the legs differ only in it.
    expect(right.x[0]! + left.x[1]!).toBeCloseTo(0, 3);
    expect(right.x[1]! + left.x[0]!).toBeCloseTo(0, 3);
    expect(right.y[0]).toBeCloseTo(left.y[0]!, 4);
    expect(right.z[1]).toBeCloseTo(left.z[1]!, 4);
    // ...and they are on opposite sides of it, not two copies of one leg.
    expect(right.x[1]! * left.x[0]!).toBeLessThan(0);
  });

  it("rides two 65-bone skeletons, one per body", () => {
    expect(json.skins).toHaveLength(2);
    for (const skin of json.skins) {
      expect(skin.joints.map((j) => json.nodes[j]!.name)).toHaveLength(65);
    }
  });

  it("carries every look the code can ask for", () => {
    for (const looks of [BASE_LOOKS, NO_LOOKS]) {
      for (const slot of SLOTS) {
        const look = looks[slot];
        if (look === null) continue;
        const prefix = `${slot}.${look}.`;
        expect(skinned.some((n) => n.startsWith(prefix)), `wardrobe has no ${prefix}*`).toBe(true);
      }
    }
  });

  it("names the two skeleton roots the loader keys off of", () => {
    const roots = json.nodes.filter((n) => n.name === "Armature" || n.name === "Armature_female");
    expect(roots.map((n) => n.name).sort()).toEqual(["Armature", "Armature_female"]);
  });

  it("skins every part, so no piece floats free of a rig", () => {
    const meshNodes = json.nodes.filter((n) => n.name.includes("."));
    expect(meshNodes.length).toBe(skinned.length);
  });
});

/**
 * A standing man must stand ON something.
 *
 * `Idle_Loop` is authored foot-planted: the hips breathe, and the knees and
 * ankles counter-rotate exactly enough to leave the soles where they are. Only
 * the hips curve is retargeted onto this rig (`remapHips`); the legs get their
 * rotations raw. So any scaling of that one curve breaks the bargain, and the
 * error has nowhere to go but the feet — the character rises and sinks off the
 * painted floor, which is what `HIPS_BOB` at the jog's 0.65 was doing to him.
 *
 * This replays the clip onto `wardrobe.glb`'s own skeleton and measures how far
 * the ankle travels. It is deliberately NOT a check that the constant is 1: it
 * measures the consequence, so it also catches a new anim library, a rebuilt
 * wardrobe, or a change to the remap itself. The runtime path cannot be used —
 * there is no HTTP server here, so the loader always falls back.
 */
/**
 * The cast is the pack's left-handed spell mirrored onto the right arm by
 * `tools/build_cast_mirror.py`, because the wand skins to `hand_r`. Nothing else
 * pins that: the clip is a name the loader looks up, and a library rebuilt
 * without the mirror step still loads, still animates, and casts from the empty
 * hand. So this measures which arm actually moves, per bone, straight out of the
 * glb — the mirror is a swap, so the two chains trade places exactly.
 */
describe("the cast clip drives the weapon arm", () => {
  const MODELS = fileURLToPath(new URL("../../public/models/", import.meta.url));
  const glb = readFileSync(`${MODELS}anim-library.glb`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8")) as any;
  const bin = 20 + glb.readUInt32LE(12) + 8;

  /** How far a bone's rotation travels over a clip, summed component-wise. */
  function travel(clipName: string, bone: string): number {
    const clip = json.animations.find((a: { name: string }) => a.name === clipName);
    expect(clip, clipName).toBeDefined();
    let total = 0;
    for (const channel of clip.channels) {
      if (channel.target.path !== "rotation") continue;
      if (json.nodes[channel.target.node].name !== bone) continue;
      const a = json.accessors[clip.samplers[channel.sampler].output];
      const start = bin + (json.bufferViews[a.bufferView].byteOffset ?? 0) + (a.byteOffset ?? 0);
      const at = (k: number, c: number) => glb.readFloatLE(start + (k * 4 + c) * 4);
      // q and -q are the same rotation, and the pack's own takes do flip sign
      // mid-clip: `Sword_Attack`'s upperarm_r flips twice and reads as nearly
      // three times the travel it actually has. Align each frame to the one
      // before it, or the measure says more about the encoding than the arm.
      for (let k = 1; k < a.count; k++) {
        let dot = 0;
        for (let c = 0; c < 4; c++) dot += at(k, c) * at(k - 1, c);
        const sign = dot < 0 ? -1 : 1;
        for (let c = 0; c < 4; c++) total += Math.abs(sign * at(k, c) - at(k - 1, c));
      }
    }
    return total;
  }

  it("ships every clip the loader asks for", () => {
    const names = new Set(json.animations.map((a: { name: string }) => a.name));
    for (const name of Object.values(CLIP_NAME)) expect(names, name).toContain(name);
  });

  it("ships two sword-derived weapon-arm attacks and layers both over locomotion", () => {
    expect(STRIKE_CLIPS).toHaveLength(2);
    expect(new Set(STRIKE_CLIPS.map((clip) => CLIP_NAME[clip])).size).toBe(2);
    expect(CLIP_NAME.strikeA).toBe("Rig|Sword_Attack");
    // Both takes are slashes: the second is the first rolled onto another swing
    // plane by tools/build_slash_variant.py, not the pack's bare-fisted punch.
    expect(CLIP_NAME.strikeB).toBe("Rig|Sword_Attack_Down");
    for (const clip of STRIKE_CLIPS) {
      expect(isLayeredClip(clip)).toBe(true);
      const right = travel(CLIP_NAME[clip], "upperarm_r") + travel(CLIP_NAME[clip], "lowerarm_r");
      const left = travel(CLIP_NAME[clip], "upperarm_l") + travel(CLIP_NAME[clip], "lowerarm_l");
      // A sword take swings one arm and counterbalances with the other, so the
      // weapon arm leads by about 2x rather than owning the clip outright.
      expect(right, clip).toBeGreaterThan(left * 1.8);
    }
  });

  it("swings the right arm and not the left", () => {
    for (const bone of ["upperarm", "lowerarm"]) {
      const right = travel(CLIP_NAME.cast, `${bone}_r`);
      const left = travel(CLIP_NAME.cast, `${bone}_l`);
      expect(right, bone).toBeGreaterThan(left * 3);
    }
  });
});

describe("the idle clip leaves the soles planted", () => {
  const MODELS = fileURLToPath(new URL("../../public/models/", import.meta.url));

  /** A glb's json chunk plus a reader for any accessor in it, by index. */
  function open(file: string) {
    const glb = readFileSync(`${MODELS}${file}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8")) as any;
    const bin = 20 + glb.readUInt32LE(12) + 8;
    const width: Record<string, number> = { SCALAR: 1, VEC3: 3, VEC4: 4 };
    const accessor = (i: number): number[][] => {
      const a = json.accessors[i];
      const view = json.bufferViews[a.bufferView];
      const n = width[a.type as string]!;
      const start = bin + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
      const step = view.byteStride ?? n * 4;
      const out: number[][] = [];
      for (let k = 0; k < a.count; k++) {
        const row: number[] = [];
        for (let c = 0; c < n; c++) row.push(glb.readFloatLE(start + k * step + c * 4));
        out.push(row);
      }
      return out;
    };
    return { json, accessor };
  }

  type Track = { t: number[]; v: number[][] };

  const lib = open("anim-library.glb");
  const clip = lib.json.animations.find((a: { name: string }) => a.name === "Rig|Idle_Loop");
  const tracks = new Map<string, Record<string, Track>>();
  for (const channel of clip.channels) {
    const sampler = clip.samplers[channel.sampler];
    const name = lib.json.nodes[channel.target.node].name as string;
    if (!tracks.has(name)) tracks.set(name, {});
    tracks.get(name)![channel.target.path as string] = {
      t: lib.accessor(sampler.input).map((row) => row[0]!),
      v: lib.accessor(sampler.output),
    };
  }
  const duration = Math.max(
    ...clip.samplers.flatMap((s: { input: number }) => lib.accessor(s.input).map((r) => r[0]!)),
  );

  /** Linear sample, which is what these takes are baked with. */
  function at(track: Track, time: number): number[] {
    if (time <= track.t[0]!) return track.v[0]!;
    const last = track.t.length - 1;
    if (time >= track.t[last]!) return track.v[last]!;
    let i = 0;
    while (track.t[i + 1]! < time) i++;
    const a = track.v[i]!;
    const b = track.v[i + 1]!;
    const f = (time - track.t[i]!) / (track.t[i + 1]! - track.t[i]!);
    return a.map((x, k) => x + (b[k]! - x) * f);
  }

  const rig = open("wardrobe.glb");
  const parent = new Map<number, number>();
  rig.json.nodes.forEach((n: { children?: number[] }, i: number) =>
    (n.children ?? []).forEach((c) => parent.set(c, i)),
  );
  const nodeOf = (name: string): number =>
    rig.json.nodes.findIndex((n: { name: string }) => n.name === name);

  /** Column-major TRS, and "apply a, then b". */
  function trs(t: number[], q: number[], s: number[]): number[] {
    const [x, y, z, w] = q as [number, number, number, number];
    const m = [
      1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
      2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
      2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
      t[0]!, t[1]!, t[2]!, 1,
    ];
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r]! *= s[c]!;
    return m;
  }
  function mul(a: number[], b: number[]): number[] {
    const o = new Array<number>(16).fill(0);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++)
        for (let k = 0; k < 4; k++) o[c * 4 + r]! += b[k * 4 + r]! * a[c * 4 + k]!;
    return o;
  }

  // The hips remap, re-derived rather than imported: the point is the outcome,
  // so a mistake shared with the runtime should not cancel itself out here.
  const HIPS = "pelvis";
  const animRest = lib.json.nodes[
    lib.json.nodes.findIndex((n: { name: string }) => n.name === HIPS)
  ].translation as number[];
  const outfitRest = rig.json.nodes[nodeOf(HIPS)].translation as number[];
  const length = (v: number[]): number => Math.hypot(v[0]!, v[1]!, v[2]!);
  const scale = length(outfitRest) / length(animRest);
  const hipsTrack = tracks.get(HIPS)!.translation!;
  const low = [0, 1, 2].map((k) => Math.min(...hipsTrack.v.map((v) => v[k]!)));

  /** World Y of one joint at one time, for a given share of the hips curve. */
  function worldY(name: string, time: number, bob: number): number {
    let m: number[] | null = null;
    let i = nodeOf(name);
    while (i !== undefined && i >= 0) {
      const node = rig.json.nodes[i];
      const track = tracks.get(node.name as string) ?? {};
      const hips = node.name === HIPS && track.translation;
      const t = hips
        ? [0, 1, 2].map(
            (k) =>
              outfitRest[k]! +
              (low[k]! + (at(track.translation!, time)[k]! - low[k]!) * bob - animRest[k]!) * scale,
          )
        : ((node.translation as number[] | undefined) ?? [0, 0, 0]);
      const q = track.rotation
        ? at(track.rotation, time)
        : ((node.rotation as number[] | undefined) ?? [0, 0, 0, 1]);
      const local = trs(t, q, (node.scale as number[] | undefined) ?? [1, 1, 1]);
      m = m ? mul(m, local) : local;
      i = parent.get(i)!;
    }
    return m![13]!;
  }

  /** Peak-to-peak travel of a joint across the whole clip, in metres. */
  function travel(name: string, bob: number): number {
    const ys: number[] = [];
    for (let k = 0; k <= 40; k++) ys.push(worldY(name, (k / 40) * duration, bob));
    return Math.max(...ys) - Math.min(...ys);
  }

  it("plays a clip that actually moves the hips", () => {
    // Guards the two tests below against passing because nothing was applied.
    expect(travel(HIPS, HIPS_BOB.idle)).toBeGreaterThan(0.005);
  });

  it("holds both ankles within a millimetre or two of still", () => {
    // 1.76mm at the settled value. What is left is the anim rig's legs being
    // ~7% shorter than this one's, which no single scalar takes out.
    expect(travel("foot_l", HIPS_BOB.idle)).toBeLessThan(0.0025);
    expect(travel("foot_r", HIPS_BOB.idle)).toBeLessThan(0.0025);
  });

  it("floats him again if the hips curve is compressed", () => {
    // The mechanism, pinned: the jog's 0.65 put 4.7mm of rise and fall into the
    // soles, and dropping the curve entirely puts the hips' whole 10.4mm there.
    expect(travel("foot_l", 0.65)).toBeGreaterThan(0.004);
    expect(travel("foot_l", 0)).toBeGreaterThan(0.01);
  });
});

/**
 * The one thing the JSON checks above cannot see: what Babylon's glTF loader
 * HANDS BACK. It wraps every import in a single `__root__` node carrying the
 * right-to-left-handed conversion, so an asset's own skeleton roots are that
 * node's children and never the container's root nodes. Reading the roots as if
 * they were the armatures indexes nothing, disables the whole import, and
 * renders a black screen with no error anywhere — the asset, the fetch and the
 * bone names all being correct is exactly why nothing else here catches it.
 *
 * So this goes through the real loader on the real glb rather than the JSON.
 */
describe("indexRigSubtree against the real loader", () => {
  const MODELS = fileURLToPath(new URL("../../public/models/", import.meta.url));

  /** Babylon reads a File through FileReader, which node does not ship. */
  class NodeFileReader {
    result: unknown;
    error: unknown;
    onload?: (e: { target: NodeFileReader }) => void;
    onerror?: (e: { target: NodeFileReader }) => void;
    onloadend?: (e: { target: NodeFileReader }) => void;
    abort(): void {}
    readAsArrayBuffer(blob: Blob): void { this.finish(blob.arrayBuffer()); }
    readAsText(blob: Blob): void { this.finish(blob.text()); }
    private finish(promise: Promise<unknown>): void {
      promise.then((result) => {
        this.result = result;
        this.onload?.({ target: this });
        this.onloadend?.({ target: this });
      }).catch((error: unknown) => {
        this.error = error;
        this.onerror?.({ target: this });
        this.onloadend?.({ target: this });
      });
    }
  }

  it("indexes the male subtree and switches the female body off", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    engine = new NullEngine();
    const { scene } = createScene(engine);
    try {
      const bytes = readFileSync(`${MODELS}wardrobe.glb`);
      const file = new File([bytes], "wardrobe.glb", { type: "model/gltf-binary" });
      const container = await LoadAssetContainerAsync(file, scene);
      const entries = container.instantiateModelsToScene((n) => n, false, {
        doNotInstantiate: true,
      });

      const byName = indexRigSubtree(entries.rootNodes);

      // The male body's parts and his bones, or the runtime has nothing to
      // dress and no skeleton to drive.
      for (const part of ["body", "brows", "eyes", "hair"]) {
        expect(byName.has(`base.male.${part}`), `base.male.${part}`).toBe(true);
      }
      expect(byName.has("pelvis")).toBe(true);
      expect(byName.has("hand_r")).toBe(true);
      // Her skeleton must not be indexed: both carry the same 65 bone names and
      // whichever landed second would silently own the animation.
      expect(byName.has("base.female.body")).toBe(false);

      const enabled = (name: string): boolean =>
        scene.meshes.find((m) => m.name === name)?.isEnabled() ?? false;
      expect(enabled("base.male.body")).toBe(true);
      expect(enabled("base.female.body")).toBe(false);
    } finally {
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  });
});

describe("idleRatio", () => {
  it("starts at the authored rate and settles slower, once", () => {
    expect(idleRatio(0)).toBe(1);
    expect(idleRatio(IDLE_SETTLE_SEC / 2)).toBeCloseTo((1 + IDLE_SETTLED) / 2, 6);
    expect(idleRatio(IDLE_SETTLE_SEC)).toBeCloseTo(IDLE_SETTLED, 6);
    // It does not keep slowing forever: a body stood still for a minute is
    // breathing, not dying.
    expect(idleRatio(600)).toBeCloseTo(IDLE_SETTLED, 6);
  });
});
