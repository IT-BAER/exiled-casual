// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach } from "vitest";
import { LoadAssetContainerAsync, Mesh, NullEngine, Quaternion, TransformNode, Vector3 } from "@babylonjs/core";
import { createScene } from "./engine";
import { ARROW_LENGTH } from "./skill-fx";
import { makeMesh } from "./meshes";
import {
  actionRatio,
  ACTION_RATIO_MAX,
  ACTION_RATIO_MIN,
  aimAngles,
  ARM_MAX,
  BOW_CARRY,
  BOW_HOOK,
  BOW_RELEASE,
  bowStringFor,
  CLIP_BIAS,
  HEAD_FOLLOW,
  HEAD_MAX,
  clipForSpeed,
  CLIP_NAME,
  directionBlend,
  DIRECTIONS,
  LEFT_PLANT,
  framePhaseMatched,
  gaitOf,
  hipTurn,
  HIP_TURN,
  type RigClip,
  idleRatio,
  indexRigSubtree,
  weaponTipLocal,
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
  REACTION_CLIPS,
  isLayeredClip,
  hiddenBaseParts,
  SKIRT_CHAINS,
  SKIRT_JOINTS,
  SKIRT_COLLIDERS,
  STRIKE_TIMING,
  type StrikeClip,
  strikePace,
  strikeRatioAt,
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

/**
 * PoE2's run-and-gun: the body faces the target and the keys carry it, so the
 * legs walk the move's way off the facing. `rel` is the move's yaw off the facing.
 */
describe("directionBlend", () => {
  const deg = (d: number) => (d * Math.PI) / 180;
  const clipsAt = (legYaw: number) => {
    const b = directionBlend(legYaw, "run");
    return { from: DIRECTIONS.run[b.from]!.clip, to: DIRECTIONS.run[b.to]!.clip, w: b.w };
  };

  it("turns the hips part way to a sidestep, never a quarter turn, and not at all ahead or behind", () => {
    expect(hipTurn(0)).toBeCloseTo(0, 9);
    expect(hipTurn(Math.PI)).toBeCloseTo(0, 9);
    expect(hipTurn(Math.PI / 2)).toBeCloseTo(HIP_TURN, 9);
    expect(hipTurn(-Math.PI / 2)).toBeCloseTo(-HIP_TURN, 9);
    expect(HIP_TURN).toBeGreaterThan(deg(20));
    expect(HIP_TURN).toBeLessThan(deg(50));
  });

  it("lands a sidestep's leftover yaw on the strafe clip alone", () => {
    const right = clipsAt(Math.PI / 2 - hipTurn(Math.PI / 2));
    expect(right.w === 0 ? right.from : right.w === 1 ? right.to : "blend").toBe("runStrafeR");
    const left = clipsAt(-Math.PI / 2 - hipTurn(-Math.PI / 2));
    expect(left.w === 0 ? left.from : left.w === 1 ? left.to : "blend").toBe("runStrafeL");
  });

  it("plays one clip straight ahead and straight behind", () => {
    const only = (y: number) => {
      const c = clipsAt(y);
      return c.w === 0 ? c.from : c.w === 1 ? c.to : "blend";
    };
    expect(only(0)).toBe("run");
    // UAL2 has no backward jog: a running backpedal is the jog, turned backwards
    // by tools/build_direction_clips.py. A back walk sped up reads as a walk.
    expect(only(Math.PI)).toBe("runBack");
    expect(only(-Math.PI)).toBe("runBack");
  });

  it("blends the two neighbours in between, weight rising with the yaw", () => {
    const a = clipsAt(deg(20));
    const b = clipsAt(deg(40));
    expect([a.from, a.to]).toEqual(["run", "runStrafeR"]);
    expect(b.w).toBeGreaterThan(a.w);
    const back = clipsAt(deg(-150));
    expect([back.from, back.to].sort()).toEqual(["runBack", "runBackL"]);
  });

  it("is continuous: a hair either side of every clip's yaw gives nearly the same pose", () => {
    for (const gait of ["walk", "run"] as const) {
      const dirs = DIRECTIONS[gait];
      const pose = (y: number) => {
        const b = directionBlend(y, gait);
        const m = new Map<number, number>();
        m.set(b.from, (m.get(b.from) ?? 0) + 1 - b.w);
        m.set(b.to, (m.get(b.to) ?? 0) + b.w);
        return m;
      };
      for (const d of dirs) {
        const weightOf = (m: Map<number, number>) =>
          [...m].filter(([i]) => dirs[i]!.clip === d.clip).reduce((t, [, w]) => t + w, 0);
        expect(weightOf(pose(d.yaw - 1e-6))).toBeCloseTo(1, 4);
        expect(weightOf(pose(d.yaw + 1e-6))).toBeCloseTo(1, 4);
      }
    }
  });

  it("walks eight authored ways, 45 degrees apart", () => {
    expect(DIRECTIONS.walk.map((d) => Math.round((d.yaw * 180) / Math.PI))).toEqual([-180, -135, -90, -45, 0, 45, 90, 135, 180]);
    expect(DIRECTIONS.walk.map((d) => d.clip)).toEqual(
      ["walkBack", "walkBackL", "walkStrafeL", "walkFwdL", "walk", "walkFwdR", "walkStrafeR", "walkBackR", "walkBack"]);
  });

  it("paces each clip on its own measured step: back walks long, sidesteps short", () => {
    const stride = (clip: RigClip) => DIRECTIONS.walk.find((d) => d.clip === clip)!.stride;
    expect(stride("walk")).toBe(1);
    expect(stride("walkBack")).toBeGreaterThan(1);
    expect(stride("walkStrafeL")).toBeLessThan(0.8);
    expect(DIRECTIONS.run.find((d) => d.clip === "runStrafeR")!.stride).toBe(1);
  });
});

describe("framePhaseMatched", () => {
  it("lands the left plant of one clip on the left plant of the other", () => {
    const walk: [number, number] = [0, 40];
    const jog: [number, number] = [0, 28];
    const plant = LEFT_PLANT.walk! * 40;
    expect(framePhaseMatched("walk", walk, plant, "run", jog)).toBeCloseTo(LEFT_PLANT.run! * 28, 6);
    expect(framePhaseMatched("walk", walk, plant, "walkBack", walk)).toBeCloseTo(LEFT_PLANT.walkBack! * 40, 6);
  });

  it("is the identity on its own clip and stays inside the target's range", () => {
    expect(framePhaseMatched("walkStrafeL", [5, 45], 17, "walkStrafeL", [5, 45])).toBeCloseTo(17, 6);
    for (let f = 0; f <= 40; f += 5) {
      const g = framePhaseMatched("walk", [0, 40], f, "walkStrafeR", [10, 38]);
      expect(g).toBeGreaterThanOrEqual(10);
      expect(g).toBeLessThan(38);
    }
  });

  it("knows the plant of every locomotion clip", () => {
    for (const gait of ["walk", "run"] as const) {
      for (const d of DIRECTIONS[gait]) expect(LEFT_PLANT[d.clip]).toBeDefined();
    }
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

  it("paces a backpedal on the same stride as its forward clip", () => {
    expect(speedRatioFor("walkBack", 1.4)).toBe(speedRatioFor("walk", 1.4));
    expect(speedRatioFor("runStrafeL", 3.5)).toBe(speedRatioFor("run", 3.5));
    expect(speedRatioFor("walkStrafeR", 1.4)).toBe(speedRatioFor("walk", 1.4));
  });

  it("runs every running direction on a jog, never a walk sped up", () => {
    for (const d of DIRECTIONS.run) expect(gaitOf(d.clip), d.clip).toBe("run");
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
  "helmet.ironsworn.helm": "Head",
  "weapon1.emberwand.mesh": "hand_r",
  "weapon1.ironswornhammer.mesh": "hand_r",
  "weapon1.stalkerbow.mesh": "hand_l",
  "weapon2.buckler.mesh": "lowerarm_l",
};

/**
 * Every joint the suit is allowed to answer to; see `SUIT_BONES` in the build.
 * It is one harness from the gorget to the ankles, so it answers to both knees
 * as well as the trunk, the shoulders and the hips. No forearm: the sleeve ends
 * at the pauldron and the arm below it is skin.
 */
/** Every joint a class hood may answer to, crown to capelet; see `HOOD_BONES` in the build. */
const HOOD_BONES = ["Head", "neck_01", "spine_02", "spine_03", "clavicle_l", "clavicle_r",
  "upperarm_l", "upperarm_r"];

const PLATE_BONES = [
  "spine_01", "spine_02", "spine_03", "neck_01",
  "clavicle_l", "clavicle_r", "upperarm_l", "upperarm_r",
  "pelvis", "thigh_l", "thigh_r", "calf_l", "calf_r",
];



/**
 * Each sabaton and the leg it belongs to; see `SABATON_BONES` in the build.
 *
 * The pair is the point. One boot is fitted to the right leg and the other is
 * that mesh reflected across the body's mid-plane, so a left sabaton that kept
 * a single `_r` group would ride the far leg across the character.
 */
const SABATON_BONES: Record<string, string[]> = {
  "boots.ironsworn.sabaton_r": ["calf_r", "foot_r", "ball_r"],
  "boots.ironsworn.sabaton_l": ["calf_l", "foot_l", "ball_l"],
  "boots.stalker.boot_r": ["calf_r", "foot_r", "ball_r"],
  "boots.stalker.boot_l": ["calf_l", "foot_l", "ball_l"],
};

const COMPONENTS: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

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

/**
 * Worn steel replaces the body under it rather than standing over it. Skin the
 * armour closes is not drawn at all, so nothing can poke through a plate at any
 * pose, and the pieces the armour does NOT close stay on the body.
 */
describe("what worn gear hides of the body", () => {
  it("leaves a bare man whole", () => {
    expect([...hiddenBaseParts(BASE_LOOKS)]).toEqual([]);
  });

  it("takes the hands under gloves, the feet under boots and the trunk under a chest", () => {
    expect([...hiddenBaseParts({ ...BASE_LOOKS, gloves: "plate" })].sort())
      .toEqual(["hand_l", "hand_r"]);
    expect([...hiddenBaseParts({ ...BASE_LOOKS, boots: "plate" })].sort())
      .toEqual(["foot_l", "foot_r", "shin_l", "shin_r"]);
    expect([...hiddenBaseParts({ ...BASE_LOOKS, chest: "plate" })].sort())
      .toEqual(["collar", "leg_l", "leg_r", "torso"]);
  });

  /**
   * The one that was already here: a fringe comes through a closed shell at the
   * brow, and the helm is fitted to the bare skull rather than to a hairstyle.
   */
  it("still takes the hair under a helmet", () => {
    expect([...hiddenBaseParts({ ...BASE_LOOKS, helmet: "iron" })]).toEqual(["hair"]);
  });

  /** The cowl is open at the throat: a hidden neck is a black hole under the chin. */
  it("keeps the neck under every helmet", () => {
    for (const helmet of ["ember", "stalker", "ironsworn"]) {
      expect(hiddenBaseParts({ ...BASE_LOOKS, helmet }).has("neck")).toBe(false);
    }
  });

  /**
   * A dressed man keeps his head, his neck and his bare arms. The suit closes
   * the trunk, the collar - both clavicles, under its own gorget plate - and
   * the legs; the gauntlets close the hands and the boots close the feet. The
   * neck stands bare above a short gorget ring, and between pauldron and
   * gauntlet the arm is his own.
   */
  it("leaves a dressed man his head and his arms", () => {
    const dressed = { ...BASE_LOOKS, chest: "plate", gloves: "plate", boots: "plate" };
    const hidden = hiddenBaseParts(dressed);
    expect([...hidden].sort()).toEqual([
      "collar", "foot_l", "foot_r", "hand_l", "hand_r", "leg_l", "leg_r", "shin_l", "shin_r", "torso",
    ]);
  });

  /**
   * A robe carries `backing_leg_*` of its own, pinned below, so the legs under
   * it are switched off like any other chest. Drawing both stands two surfaces
   * 3 mm apart and the backing wins in patches through the cloth.
   */
  it("closes the legs under a robe, which backs them itself", () => {
    const hidden = hiddenBaseParts({ ...BASE_LOOKS, chest: "robe", boots: "leather" });
    expect(hidden.has("leg_l")).toBe(true);
    expect(hidden.has("leg_r")).toBe(true);
    expect(hidden.has("torso")).toBe(true);
    expect(hiddenBaseParts({ ...BASE_LOOKS, chest: "leather" }).has("leg_l")).toBe(true);
  });

  /**
   * The suits' shins were open shells, so a suit ends below the knee and the
   * bare shin runs from under its hem to the foot; a boot closes both.
   */
  it("leaves the shins bare under a suit and closes them under boots", () => {
    expect(hiddenBaseParts({ ...BASE_LOOKS, chest: "plate" }).has("shin_l")).toBe(false);
    expect(hiddenBaseParts({ ...BASE_LOOKS, chest: "plate" }).has("shin_r")).toBe(false);
    expect(hiddenBaseParts({ ...BASE_LOOKS, chest: "plate", boots: "plate" }).has("shin_l"))
      .toBe(true);
  });
});

describe("wardrobe asset", () => {
  // Blender's unpacked output: this suite reads raw float accessors, and the
  // served copy is meshopt-packed. The loader-driven suites below read that one.
  const glb = readFileSync(fileURLToPath(new URL("../../../../assets/characters/wardrobe.glb", import.meta.url)));
  const json = JSON.parse(
    glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any as {
    nodes: { name: string; mesh?: number; skin?: number; children?: number[] }[];
    skins: { joints: number[]; inverseBindMatrices: number }[];
    meshes: { name: string;
      primitives: { indices?: number; attributes: Record<string, number> }[] }[];
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
      "base.female.torso", "base.female.hand_l", "base.female.hand_r",
      "base.female.foot_l", "base.female.foot_r",
      "base.female.arm_l", "base.female.arm_r", "base.female.collar",
      "base.female.neck",
      "base.female.leg_l", "base.female.leg_r", "base.female.shin_l", "base.female.shin_r",
      "base.male.body", "base.male.brows", "base.male.eyes", "base.male.hair",
      "base.male.torso", "base.male.hand_l", "base.male.hand_r",
      "base.male.foot_l", "base.male.foot_r",
      "base.male.arm_l", "base.male.arm_r", "base.male.collar",
      "base.male.neck",
      "base.male.leg_l", "base.male.leg_r", "base.male.shin_l", "base.male.shin_r",
      "helmet.ironsworn.helm", "helmet.stalker.hood", "helmet.ember.cowl", "weapon1.emberwand.mesh", "weapon2.buckler.mesh",
      "weapon1.ironswornhammer.mesh", "weapon1.stalkerbow.mesh", "weapon2.towershield.mesh",
      "chest.ironsworn.cuirass", "chest.ironsworn.gorget", "chest.ironsworn.backing",
      "chest.ironsworn.backing_arm_l", "chest.ironsworn.backing_arm_r",
      "chest.stalker.coat", "chest.stalker.gorget", "chest.stalker.backing",
      "chest.stalker.backing_arm_l", "chest.stalker.backing_arm_r",
      "chest.stalker.backing_leg_l", "chest.stalker.backing_leg_r",
      "chest.ember.robe", "chest.ember.gorget", "chest.ember.backing",
      "chest.ember.backing_arm_l", "chest.ember.backing_arm_r",
      "chest.ember.backing_leg_l", "chest.ember.backing_leg_r",
      "boots.ironsworn.sabaton_l", "boots.ironsworn.sabaton_r",
      "boots.stalker.boot_l", "boots.stalker.boot_r",
      "boots.ember.slipper_l", "boots.ember.slipper_r",
      "gloves.ironsworn.gauntlet_l", "gloves.ironsworn.gauntlet_r",
      "gloves.stalker.glove_l", "gloves.stalker.glove_r",
      "gloves.ember.wrap_l", "gloves.ember.wrap_r",
    ].sort());
  });

  /**
   * Worn gear hides body pieces by part name alone, in every slot (see
   * `applyLooks`), so a gear part named like a body region is hidden with it.
   */
  it("names no gear part like a body region", () => {
    const names = json.meshes.map((m) => m.name);
    const part = (name: string) => name.split(".")[2];
    const body = new Set(names.filter((n) => n.startsWith("base.")).map(part));
    expect(names.filter((n) => !n.startsWith("base.") && body.has(part(n)))).toEqual([]);
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
  it("deforms the suit over the spine, both elbows and both knees", () => {
    const bin = glb.subarray(20 + json.buffers0Len);
    const node = json.nodes.find((n) => n.name === "chest.ironsworn.cuirass");
    expect(node, "no node chest.ironsworn.cuirass").toBeDefined();
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
    // And the harness runs to the ankles, so the greave has to answer to the
    // joint above it or a shin swings with the thigh.
    expect(names).toContain("calf_l");
    expect(names).toContain("calf_r");
  });

  /**
   * Each class hood is one piece from crown to capelet (`tools/prep_hood.py`): the
   * crown rides Head, the capelet what the coat or robe under it rides, and nothing
   * below the trunk. Lining and trim are vertex colour on the one material.
   */
  it("deforms each hood from the head down onto the shoulders, and colours it", () => {
    const bin = glb.subarray(20 + json.buffers0Len);
    for (const mesh of ["helmet.stalker.hood", "helmet.ember.cowl"]) {
      const node = json.nodes.find((n) => n.name === mesh);
      expect(node, `no node ${mesh}`).toBeDefined();
      const prim = json.meshes[node!.mesh!]!.primitives[0]!;
      const joints = readAccessor(json, bin, prim.attributes["JOINTS_0"]!);
      const weights = readAccessor(json, bin, prim.attributes["WEIGHTS_0"]!);
      const position = readAccessor(json, bin, prim.attributes["POSITION"]!);
      const skin = json.skins[node!.skin!]!;
      const head = skin.joints.findIndex((j) => json.nodes[j]!.name === "Head");
      const used = new Set<number>();
      for (let v = 0; v < weights.length / 4; v += 1) {
        const w = weights.slice(v * 4, v * 4 + 4);
        const j = joints.slice(v * 4, v * 4 + 4);
        for (let k = 0; k < 4; k += 1) {
          if (w[k]! > 0.0001) used.add(j[k]!);
        }
        expect(w[0]! + w[1]! + w[2]! + w[3]!).toBeCloseTo(1, 3);
        // The crown: the pack skins it softly, a few percent on the neck, never less.
        if (position[v * 3 + 1]! > 1.7) {
          const onHead = [0, 1, 2, 3].reduce((sum, k) => sum + (j[k] === head ? w[k]! : 0), 0);
          expect(onHead, `${mesh} vertex ${v} above the crown line`).toBeGreaterThan(0.95);
        }
      }
      const names = [...used].map((u) => json.nodes[skin.joints[u]!]!.name);
      expect(names.every((n) => HOOD_BONES.includes(n)), `${mesh} strays: ${names}`).toBe(true);
      expect(names).toContain("Head");
      expect(names).toContain("spine_03");
      expect(prim.attributes["COLOR_0"], mesh).toBeDefined();
    }
  });

  /**
   * The trousers are parked, and this is what says so out loud. They were the
   * body's own leg surface pushed out four millimetres and called leather,
   * standing in for leg armour the chest slot did not have; the harness carries
   * cuisses and greaves of its own now, so shipping them again would only bury
   * a second pair of legs inside the steel.
   */
  it("ships no stand-in trousers under the harness", () => {
    expect(json.nodes.find((n) => n.name === "chest.ironsworn.legs")).toBeUndefined();
  });

  /**
   * The v9 suit carries no steel over the trapezius, so the collar it hides is
   * closed by a plate cut from the collar region itself: skinned, on the same
   * clavicles, or the shoulders roll out from under it.
   */
  const jointsUsed = (name: string): Set<string> => {
    const bin = glb.subarray(20 + json.buffers0Len);
    const node = json.nodes.find((n) => n.name === name);
    expect(node, `no node ${name}`).toBeDefined();
    expect(node!.skin).toBeDefined();
    const skin = json.skins[node!.skin!]!;
    const prim = json.meshes[node!.mesh!]!.primitives[0]!;
    const joints = readAccessor(json, bin, prim.attributes["JOINTS_0"]!);
    const weights = readAccessor(json, bin, prim.attributes["WEIGHTS_0"]!);
    const used = new Set<string>();
    for (let k = 0; k < weights.length; k += 1) {
      if (weights[k]! > 0.0001) used.add(json.nodes[skin.joints[joints[k]!]!]!.name);
    }
    return used;
  };

  const sub = (a: number[], b: number[]): number[] => a.map((v, i) => v - b[i]!);
  const dot = (a: number[], b: number[]): number => a.reduce((sum, v, i) => sum + v * b[i]!, 0);
  const toSegment = (p: number[], a: number[], b: number[]): number => {
    const ab = sub(b, a);
    const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
    const off = sub(p, a.map((v, i) => v + ab[i]! * t));
    return Math.sqrt(dot(off, off));
  };

  /** Where each joint of a skin stands in bind pose: the origin its inverse bind sends to zero. */
  const bindPose = (skin: any): Map<string, number[]> => {
    const ibm = readAccessor(json, glb.subarray(20 + json.buffers0Len), skin.inverseBindMatrices);
    const at = new Map<string, number[]>();
    skin.joints.forEach((j: number, k: number) => {
      const m = ibm.slice(k * 16, k * 16 + 16);
      const a = (r: number, c: number): number => m[c * 4 + r]!;
      const det = (p: (r: number, c: number) => number): number =>
        p(0, 0) * (p(1, 1) * p(2, 2) - p(1, 2) * p(2, 1))
        - p(0, 1) * (p(1, 0) * p(2, 2) - p(1, 2) * p(2, 0))
        + p(0, 2) * (p(1, 0) * p(2, 1) - p(1, 1) * p(2, 0));
      const d = det(a);
      // Cramer, on A * o = -t: the column the answer is wanted in is swapped
      // for the right-hand side.
      at.set(json.nodes[j]!.name, [0, 1, 2].map((col) =>
        det((r, c) => (c === col ? -m[12 + r]! : a(r, c))) / d));
    });
    return at;
  };

  /** Where a point given in joint `name`'s own frame stands in bind pose. */
  const bindPoint = (skin: any, name: string, local: readonly number[]): number[] => {
    const ibm = readAccessor(json, glb.subarray(20 + json.buffers0Len), skin.inverseBindMatrices);
    const k = skin.joints.findIndex((j: number) => json.nodes[j]!.name === name);
    const m = ibm.slice(k * 16, k * 16 + 16);
    const a = (r: number, c: number): number => m[c * 4 + r]!;
    const det = (p: (r: number, c: number) => number): number =>
      p(0, 0) * (p(1, 1) * p(2, 2) - p(1, 2) * p(2, 1))
      - p(0, 1) * (p(1, 0) * p(2, 2) - p(1, 2) * p(2, 0))
      + p(0, 2) * (p(1, 0) * p(2, 1) - p(1, 1) * p(2, 0));
    const d = det(a);
    return [0, 1, 2].map((col) =>
      det((r, c) => (c === col ? local[r]! - m[12 + r]! : a(r, c))) / d);
  };

  it("ships a skinned gorget plate over the hidden collar", () => {
    const used = jointsUsed("chest.ironsworn.gorget");
    expect(used).toContain("clavicle_l");
    expect(used).toContain("clavicle_r");
  });

  /**
   * The v9 suit is cracked through across the back, so the hidden torso is cut
   * off the body and filled out to just under the steel: a crack shows steel.
   */
  it("ships a skinned backing plate under the cracked cuirass", () => {
    const used = jointsUsed("chest.ironsworn.backing");
    expect(used).toContain("spine_03");
    expect(used).toContain("pelvis");
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
  it.each([
    ["boots.ironsworn.sabaton_r", "boots.ironsworn.sabaton_l"],
    ["boots.stalker.boot_r", "boots.stalker.boot_l"],
    ["boots.ember.slipper_r", "boots.ember.slipper_l"],
  ])("stands %s and %s on opposite legs, same piece on both", (rightMesh, leftMesh) => {
    const bin = glb.subarray(20 + json.buffers0Len);
    const centres = [rightMesh, leftMesh].map((mesh) => {
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

  it("rides a 65-bone female and a male with 192 skirt joints under his pelvis", () => {
    expect(json.skins).toHaveLength(2);
    const chainCounts = json.skins.map((skin) => {
      const names = skin.joints.map((j) => json.nodes[j]!.name);
      const chains = names.filter((n) => n.startsWith("skirt_"));
      expect(names.length - chains.length).toBe(65);
      return chains.length;
    });
    expect(chainCounts.sort((a, b) => a - b)).toEqual([0, SKIRT_CHAINS * SKIRT_JOINTS]);
  });

  /**
   * The chain a piece of cloth hangs on has to run down the inside of that
   * cloth's own column. A ring hung at hip radius leaves a flared hem further
   * from its chain than any leg capsule is wide, so the solver collides a line
   * that lies inside the leg while the visible cloth trails behind the heel.
   *
   * Cloth already inside a capsule is the solver's to push out, so only what
   * hangs free of the legs is measured, and a garment has folds, so the bar is
   * the ninth decile rather than the worst vertex.
   */
  it.each(["chest.ember.robe", "chest.stalker.coat"])(
    "hangs %s on chains that run inside its own cloth", (meshName) => {
      const node = json.nodes.find((n) => n.name === meshName)!;
      const skin = json.skins[node.skin!]!;
      const at = bindPose(skin);
      const bin = glb.subarray(20 + json.buffers0Len);
      // The chain's line: its three joints, then one more segment on for the
      // last bone's tail, which no glTF node carries.
      const axis = new Map<number, number[][]>();
      for (let i = 0; i < SKIRT_CHAINS; i += 1) {
        const knots = Array.from({ length: SKIRT_JOINTS }, (_, n) =>
          at.get(`skirt_${i}_${String(n + 1).padStart(2, "0")}`)!);
        const last = knots[SKIRT_JOINTS - 1]!;
        axis.set(i, [...knots, last.map((v, k) => v + (v - knots[SKIRT_JOINTS - 2]![k]!))]);
      }
      const legs = SKIRT_COLLIDERS.map((c) =>
        ({ a: at.get(c.from)!, b: at.get(c.to)!, radius: c.radius }));

      const prim = json.meshes[node.mesh!]!.primitives[0]!;
      const pos = readAccessor(json, bin, prim.attributes["POSITION"]!);
      const joints = readAccessor(json, bin, prim.attributes["JOINTS_0"]!);
      const weights = readAccessor(json, bin, prim.attributes["WEIGHTS_0"]!);
      const free: number[] = [];
      for (let v = 0; v < pos.length / 3; v += 1) {
        let best = 0;
        for (let k = 1; k < 4; k += 1) {
          if (weights[v * 4 + k]! > weights[v * 4 + best]!) best = k;
        }
        const name = json.nodes[skin.joints[joints[v * 4 + best]!]!]!.name;
        const chain = /^skirt_(\d+)_/.exec(name);
        if (!chain) continue;
        const p = [pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!];
        if (legs.some((leg) => toSegment(p, leg.a, leg.b) <= leg.radius)) continue;
        const line = axis.get(Number(chain[1]))!;
        free.push(Math.min(...line.slice(1).map((k, i) => toSegment(p, line[i]!, k))));
      }
      expect(free.length, meshName).toBeGreaterThan(1000);
      free.sort((a, b) => a - b);
      const tightest = Math.min(...SKIRT_COLLIDERS.map((c) => c.radius));
      expect(free[Math.floor(free.length * 0.9)]!, meshName).toBeLessThanOrEqual(tightest);
    });

  /**
   * A chain sector is an ARC, so near the hip axis it is millimetres wide and
   * `atan2` no longer says which side of the ring a vertex is on: two vertices
   * a centimetre apart at the crotch seam land half a ring apart, and the 3 cm
   * triangle between them becomes a 40 cm spike the moment the ring swings.
   * `hoop()` holds chain i against i+1 only, so nothing in the solver can catch
   * a triangle bridging chain 0 to chain 27. The build pins cloth inside
   * `SKIRT_AXIS_*` to the pelvis instead, which is what this bar measures.
   */
  it.each(["chest.ember.robe", "chest.stalker.coat"])(
    "keeps every %s triangle inside chains the hoop can hold", (meshName) => {
      const node = json.nodes.find((n) => n.name === meshName)!;
      const skin = json.skins[node.skin!]!;
      const bin = glb.subarray(20 + json.buffers0Len);
      const prim = json.meshes[node.mesh!]!.primitives[0]!;
      const joints = readAccessor(json, bin, prim.attributes["JOINTS_0"]!);
      const weights = readAccessor(json, bin, prim.attributes["WEIGHTS_0"]!);
      const index = readAccessor(json, bin, prim.indices!);

      const chainOf = (v: number): number | null => {
        let best = 0;
        for (let k = 1; k < 4; k += 1) {
          if (weights[v * 4 + k]! > weights[v * 4 + best]!) best = k;
        }
        const name = json.nodes[skin.joints[joints[v * 4 + best]!]!]!.name;
        const chain = /^skirt_(\d+)_/.exec(name);
        return chain ? Number(chain[1]) : null;
      };

      let worst = 0;
      for (let t = 0; t < index.length; t += 3) {
        const cs = [...new Set([index[t]!, index[t + 1]!, index[t + 2]!]
          .map(chainOf).filter((c): c is number => c !== null))].sort((a, b) => a - b);
        if (cs.length < 2) continue;
        // The span is the short way round the ring, so 31 and 0 are neighbours.
        const gap = Math.max(...cs.map((c, i) =>
          ((cs[(i + 1) % cs.length]! - c) % SKIRT_CHAINS + SKIRT_CHAINS) % SKIRT_CHAINS));
        worst = Math.max(worst, SKIRT_CHAINS - gap);
      }
      expect(worst, meshName).toBeLessThanOrEqual(3);
    });

  /**
   * The robe's generated donor wears trousers under the skirt. Handed to the
   * chains they hang off the pelvis, so a leg steps out of its own trouser
   * tube and the hem ends beside the foot. Below the knee the two are 15-18 cm
   * apart at bind with nothing between, so no chained vertex may sit closer.
   * The coat's cloth stops at the knee, where its hem hugs the calf's head.
   */
  it("leaves the trousers under the robe on the legs", () => {
    const meshName = "chest.ember.robe";
    const node = json.nodes.find((n) => n.name === meshName)!;
    const skin = json.skins[node.skin!]!;
    const at = bindPose(skin);
    const bin = glb.subarray(20 + json.buffers0Len);
    const prim = json.meshes[node.mesh!]!.primitives[0]!;
    const pos = readAccessor(json, bin, prim.attributes["POSITION"]!);
    const joints = readAccessor(json, bin, prim.attributes["JOINTS_0"]!);
    const weights = readAccessor(json, bin, prim.attributes["WEIGHTS_0"]!);
    const shins = ["_l", "_r"].map((s) => [at.get(`calf${s}`)!, at.get(`foot${s}`)!] as const);

    let onShin = 0;
    for (let v = 0; v < pos.length / 3; v += 1) {
      let best = 0;
      for (let k = 1; k < 4; k += 1) {
        if (weights[v * 4 + k]! > weights[v * 4 + best]!) best = k;
      }
      if (!json.nodes[skin.joints[joints[v * 4 + best]!]!]!.name.startsWith("skirt_")) continue;
      const p = [pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!];
      if (shins.some(([a, b]) => toSegment(p, a, b) < 0.15)) onShin += 1;
    }
    expect(onShin, meshName).toBe(0);
  });

  /**
   * A capsule stands for what the eye sees on that leg, and once a boot is on,
   * that is the boot. Solved against bare-skin radii the chains press onto the
   * shin, the boot stands proud of the cloth, and the hem is drawn inside the
   * shaft. So `worn` has to swallow the whole boot - and has to be worth its
   * line, which the bare radius failing to is what says so.
   */
  it.each([
    ["boots.stalker.boot_r", "_r"],
    ["boots.ironsworn.sabaton_r", "_r"],
    ["boots.ember.slipper_r", "_r"],
    ["boots.stalker.boot_l", "_l"],
    ["boots.ironsworn.sabaton_l", "_l"],
    ["boots.ember.slipper_l", "_l"],
  ])("keeps %s inside the capsules the cloth is pushed out of", (meshName, side) => {
    const node = json.nodes.find((n) => n.name === meshName)!;
    const skin = json.skins[node.skin!]!;
    const at = bindPose(skin);
    const caps = SKIRT_COLLIDERS
      .filter((c) => c.worn !== undefined && c.from.endsWith(side))
      .map((c) => {
        const a = at.get(c.from)!;
        const b = at.get(c.to)!;
        // Worn, the capsule stands on the boots' shaft: a bind-frame shift at each end.
        const shift = c.shaft ? sub(bindPoint(skin, c.from, c.shaft), a) : [0, 0, 0];
        const toe = c.toe ? sub(bindPoint(skin, c.from, c.toe), a) : shift;
        return { a, b, wornA: a.map((v, i) => v + shift[i]!), wornB: b.map((v, i) => v + toe[i]!),
          bare: c.radius, worn: c.worn! };
      });
    const prim = json.meshes[node.mesh!]!.primitives[0]!;
    const pos = readAccessor(json, glb.subarray(20 + json.buffers0Len),
      prim.attributes["POSITION"]!);

    let worstWorn = -Infinity;
    let worstBare = -Infinity;
    for (let v = 0; v < pos.length / 3; v += 1) {
      const p = [pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!];
      worstWorn = Math.max(worstWorn, Math.min(...caps.map((c) => toSegment(p, c.wornA, c.wornB) - c.worn)));
      worstBare = Math.max(worstBare, Math.min(...caps.map((c) => toSegment(p, c.a, c.b) - c.bare)));
    }
    expect(worstWorn, meshName).toBeLessThanOrEqual(0);
    expect(worstBare, meshName).toBeGreaterThan(0.02);
  });

  /**
   * The shin is the calf capsule's. A foot capsule round the ankle joint, as fat
   * as heel to sole needs, stood 18cm up the shin and pushed the robe's side
   * panel out into a wing at idle; laid along the sole it stands 13cm.
   */
  it.each(["_l", "_r"])("keeps the worn foot%s capsule off the shin", (side) => {
    const node = json.nodes.find((n) => n.name === `boots.ember.slipper${side}`)!;
    const skin = json.skins[node.skin!]!;
    const c = SKIRT_COLLIDERS.find((k) => k.from === `foot${side}`)!;
    const ankle = bindPose(skin).get(`foot${side}`)!;
    // The tail end is the ball joint's own offset in the foot's frame, plus the toe shift.
    const ball = (json.nodes[skin.joints.find((j) => json.nodes[j]!.name === c.to)!] as
      unknown as { translation: number[] }).translation;
    const head = c.shaft ?? [0, 0, 0];
    const toe = c.toe ?? head;
    const ends = [bindPoint(skin, c.from, head), bindPoint(skin, c.from, ball.map((v, i) => v + toe[i]!))];
    expect(Math.max(...ends.map((p) => p[1]!)) + c.worn! - ankle[1]!).toBeLessThan(0.15);
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

  it("carries no buffer data a replaced clip left behind", () => {
    // The splice tools replace a clip by name; its old keys must go with it.
    const used = new Set<number>();
    for (const anim of json.animations) for (const s of anim.samplers) used.add(s.input).add(s.output);
    for (const mesh of json.meshes ?? []) {
      for (const prim of mesh.primitives) {
        for (const a of Object.values(prim.attributes) as number[]) used.add(a);
        if (prim.indices !== undefined) used.add(prim.indices);
        for (const target of prim.targets ?? []) for (const a of Object.values(target) as number[]) used.add(a);
      }
    }
    for (const skin of json.skins ?? []) if (skin.inverseBindMatrices !== undefined) used.add(skin.inverseBindMatrices);
    expect(json.accessors.length - used.size).toBe(0);
    const live = json.bufferViews.reduce((sum: number, v: { byteLength: number }) => sum + v.byteLength + (-v.byteLength & 3), 0);
    expect(json.bufferViews.length).toBe(used.size);
    expect(json.buffers[0].byteLength).toBeLessThanOrEqual(live);
  });

  it("chains UAL2's three regular sword takes and layers each over locomotion", () => {
    expect(STRIKE_CLIPS.map((clip) => CLIP_NAME[clip])).toEqual([
      "Rig|Sword_Regular_A", "Rig|Sword_Regular_B", "Rig|Sword_Regular_C",
    ]);
    for (const clip of STRIKE_CLIPS) {
      expect(isLayeredClip(clip)).toBe(true);
      const right = travel(CLIP_NAME[clip], "upperarm_r") + travel(CLIP_NAME[clip], "lowerarm_r");
      const left = travel(CLIP_NAME[clip], "upperarm_l") + travel(CLIP_NAME[clip], "lowerarm_l");
      // A sword take swings one arm and counterbalances with the other, and the
      // recovery walks both back to guard: the weapon arm leads, it does not own it.
      expect(right, clip).toBeGreaterThan(left * 1.2);
    }
  });

  it("plays UAL2's knockback, drink and chest-open takes over the legs", () => {
    expect([CLIP_NAME.hit, CLIP_NAME.drink, CLIP_NAME.open]).toEqual(["Rig|Hit_Knockback", "Rig|Consume", "Rig|Chest_Open"]);
    for (const clip of REACTION_CLIPS) expect(isLayeredClip(clip), clip).toBe(true);
  });

  /** Sideways position of the right hand, in the clip's root frame, at a share of the clip. */
  function handSide(clipName: string, frac: number): number {
    const clip = json.animations.find((a: { name: string }) => a.name === clipName);
    const floatsAt = (i: number): number[][] => {
      const a = json.accessors[i];
      const n = a.type === "SCALAR" ? 1 : a.type === "VEC3" ? 3 : 4;
      const start = bin + (json.bufferViews[a.bufferView].byteOffset ?? 0) + (a.byteOffset ?? 0);
      return Array.from({ length: a.count }, (_, k) =>
        Array.from({ length: n }, (_, c) => glb.readFloatLE(start + (k * n + c) * 4)));
    };
    const tracks = new Map<string, number[]>();
    let duration = 0;
    for (const ch of clip.channels) {
      const s = clip.samplers[ch.sampler];
      const t = floatsAt(s.input).map((r) => r[0]!);
      duration = Math.max(duration, t[t.length - 1]!);
      tracks.set(`${ch.target.node}.${ch.target.path}`, [s.input, s.output]);
    }
    const sample = (node: number, path: string, fallback: number[]): number[] => {
      const key = tracks.get(`${node}.${path}`);
      if (!key) return fallback;
      const t = floatsAt(key[0]!).map((r) => r[0]!);
      const v = floatsAt(key[1]!);
      const time = frac * duration;
      let i = 0;
      while (i < t.length - 2 && t[i + 1]! < time) i++;
      const f = Math.min(1, Math.max(0, (time - t[i]!) / (t[i + 1]! - t[i]!)));
      return v[i]!.map((x, c) => x + (v[i + 1]![c]! - x) * f);
    };
    const parent = new Map<number, number>();
    json.nodes.forEach((n: { children?: number[] }, i: number) => (n.children ?? []).forEach((c) => parent.set(c, i)));
    // Position of hand_r in the frame of the top node, by walking the chain up.
    let p = [0, 0, 0];
    for (let i = json.nodes.findIndex((n: { name: string }) => n.name === "hand_r"); i !== undefined; i = parent.get(i)!) {
      const node = json.nodes[i];
      const [x, y, z, w] = sample(i, "rotation", node.rotation ?? [0, 0, 0, 1]) as [number, number, number, number];
      const s = sample(i, "scale", node.scale ?? [1, 1, 1]);
      const t = sample(i, "translation", node.translation ?? [0, 0, 0]);
      const [px, py, pz] = [p[0]! * s[0]!, p[1]! * s[1]!, p[2]! * s[2]!];
      // q * v * q^-1, then the node's translation.
      const ix = w * px + y * pz - z * py, iy = w * py + z * px - x * pz;
      const iz = w * pz + x * py - y * px, iw = -x * px - y * py - z * pz;
      p = [
        ix * w + iw * -x + iy * -z - iz * -y + t[0]!,
        iy * w + iw * -y + iz * -x - ix * -z + t[1]!,
        iz * w + iw * -z + ix * -y - iy * -x + t[2]!,
      ];
      if (!parent.has(i)) break;
    }
    return p[0]!;
  }

  it("opens with a forehand and a backhand: the hand crosses the body in opposite directions", () => {
    const sweep = (["strikeA", "strikeB"] as const).map((clip) =>
      handSide(CLIP_NAME[clip], STRIKE_TIMING[clip].contact) - handSide(CLIP_NAME[clip], STRIKE_TIMING[clip].drop));
    const [a, b] = sweep as [number, number];
    expect(Math.sign(a), `sweeps ${sweep}`).not.toBe(Math.sign(b));
    // Both are real swings, not one swing and a twitch.
    expect(Math.min(Math.abs(a), Math.abs(b)), `sweeps ${sweep}`).toBeGreaterThan(Math.max(Math.abs(a), Math.abs(b)) * 0.4);
  });

  it("swings the right arm and not the left", () => {
    for (const bone of ["upperarm", "lowerarm"]) {
      const right = travel(CLIP_NAME.cast, `${bone}_r`);
      const left = travel(CLIP_NAME.cast, `${bone}_l`);
      expect(right, bone).toBeGreaterThan(left * 3);
    }
  });

  it("keys the bow as a layered rotation-only clip that hooks the string with the empty draw hand", () => {
    expect(isLayeredClip("bow")).toBe(true);
    const clip = json.animations.find((a: { name: string }) => a.name === CLIP_NAME.bow);
    const keyed = clip.channels.map((c: { target: { node: number; path: string } }) =>
      `${json.nodes[c.target.node].name}.${c.target.path}`);
    // Metre translations from the wardrobe skeleton would tear the centimetre rig.
    for (const k of keyed) expect(k).toMatch(/\.rotation$/);
    for (const bone of ["hand_l", "hand_r", "index_03_r", "middle_03_r", "ring_03_r"]) {
      expect(keyed).toContain(`${bone}.rotation`);
    }
    // The draw arm travels further than the bow arm, which only lifts and kicks.
    const draw = travel(CLIP_NAME.bow, "lowerarm_r");
    const bow = travel(CLIP_NAME.bow, "lowerarm_l");
    expect(draw).toBeGreaterThan(bow);
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

describe("indexRigSubtree against the real loader", () => {
  const MODELS = fileURLToPath(new URL("../../public/models/", import.meta.url));

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

      // A skinned piece's bounds are its bind pose: a hanging hand leaves the
      // T-pose box and the gauntlet is culled while the forearm is on screen.
      const skinned = [...byName.values()].filter(
        (n): n is Mesh => n instanceof Mesh && n.skeleton !== null,
      );
      expect(skinned.map((m) => m.name)).toContain("gloves.ironsworn.gauntlet_l");
      for (const mesh of skinned) {
        expect(mesh.alwaysSelectAsActiveMesh, mesh.name).toBe(true);
      }
    } finally {
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  });
});

describe("a bolt leaves the weapon's tip", () => {
  const MODELS = fileURLToPath(new URL("../../public/models/", import.meta.url));

  /** A fixed reach along the hand bone's own +Y put the Ember Bolt half a unit past the wand, out beside the fingers. */
  it("finds the wand's tip in the hand's frame", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    engine = new NullEngine();
    const { scene } = createScene(engine);
    try {
      const file = new File([readFileSync(`${MODELS}wardrobe.glb`)], "wardrobe.glb", { type: "model/gltf-binary" });
      const entries = (await LoadAssetContainerAsync(file, scene)).instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
      const byName = indexRigSubtree(entries.rootNodes);
      const hand = byName.get("hand_r") as TransformNode;
      const wand = byName.get("weapon1.emberwand.mesh") as Mesh;
      hand.computeWorldMatrix(true);
      wand.computeWorldMatrix(true);
      // The rest-pose tip: the wand vertex farthest from the hand holding it.
      const p = wand.getVerticesData("position")!;
      let tip = Vector3.Zero();
      let far = -1;
      for (let i = 0; i < p.length; i += 3) {
        const v = Vector3.TransformCoordinates(new Vector3(p[i]!, p[i + 1]!, p[i + 2]!), wand.getWorldMatrix());
        const d = Vector3.Distance(v, hand.absolutePosition);
        if (d > far) { far = d; tip = v; }
      }
      const drawn = Vector3.TransformCoordinates(weaponTipLocal(hand, [wand]), hand.getWorldMatrix());
      expect(Vector3.Distance(drawn, tip)).toBeLessThan(0.01);
    } finally {
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  });
});

/**
 * The bow's string is drawn at runtime between two nocks the wardrobe carries on
 * `hand_l`, so the rigid bow mesh must not carry one of its own, and the drawn
 * one must actually reach the draw hand. `Rig|Bow_Shoot` is posed onto the real
 * skeleton the way the runtime retargets it: node-local rotations by bone name.
 */
describe("the bow is drawn on a runtime string", () => {
  const MODELS = fileURLToPath(new URL("../../public/models/", import.meta.url));

  it("strings the bow between its nocks, draws it to the jaw and looses the arrow at release", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    engine = new NullEngine();
    const { scene } = createScene(engine);
    try {
      const load = (name: string) => LoadAssetContainerAsync(
        new File([readFileSync(`${MODELS}${name}`)], name, { type: "model/gltf-binary" }), scene);
      const wardrobe = await load("wardrobe.glb");
      const lib = await load("anim-library.glb");
      const entries = wardrobe.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
      const pivot = new TransformNode("bow-test", scene);
      for (const root of entries.rootNodes) root.parent = pivot;
      const byName = indexRigSubtree(entries.rootNodes);

      // No baked string: every bow triangle is stave, a few centimetres at most.
      const bow = byName.get("weapon1.stalkerbow.mesh") as Mesh;
      const p = bow.getVerticesData("position")!;
      const idx = bow.getIndices()!;
      let longest = 0;
      for (let t = 0; t < idx.length; t += 3) {
        for (let k = 0; k < 3; k++) {
          const a = idx[t + k]! * 3, b = idx[t + (k + 1) % 3]! * 3;
          longest = Math.max(longest, Math.hypot(p[a]! - p[b]!, p[a + 1]! - p[b + 1]!, p[a + 2]! - p[b + 2]!));
        }
      }
      expect(longest).toBeLessThan(0.1);
      for (const nock of ["stalkerbow_nock_top", "stalkerbow_nock_bottom"]) {
        expect(byName.get(nock)?.parent?.name, nock).toBe("hand_l");
      }

      const string = bowStringFor(scene, pivot, byName)!;
      expect(string).not.toBeNull();
      const clip = lib.animationGroups.find((g) => g.name === CLIP_NAME.bow)!;
      const node = (name: string) => byName.get(name) as TransformNode;
      const at = (name: string) => {
        node(name).computeWorldMatrix(true);
        return node(name).absolutePosition.clone();
      };
      const pose = (frac: number, group = clip) => {
        for (const t of group.targetedAnimations) {
          const target = byName.get((t.target as TransformNode).name);
          if (t.animation.targetProperty === "rotationQuaternion" && target instanceof TransformNode) {
            target.rotationQuaternion = t.animation.evaluate(clip.from + (clip.to - clip.from) * frac);
          }
        }
      };
      const nocks = () => Vector3.Center(at("stalkerbow_nock_top"), at("stalkerbow_nock_bottom"));
      // Roll of hand_l about the forearm, off its bind relation: a wrist does not twist.
      const handRest = node("hand_l").rotationQuaternion!.clone();
      const handRoll = () => {
        const d = node("hand_l").rotationQuaternion!.multiply(Quaternion.Inverse(handRest));
        const a = node("hand_l").position.normalizeToNew();
        const along = d.x * a.x + d.y * a.y + d.z * a.z;
        return Math.abs(Math.atan2(along, d.w) * 2 * 180 / Math.PI);
      };
      const fingers = () => ["index_02_r", "middle_02_r", "ring_02_r"]
        .reduce((sum, f) => sum.addInPlace(at(f)), Vector3.Zero()).scaleInPlace(1 / 3);

      // Not playing: straight nock to nock, no arrow.
      string.update(null);
      expect(Vector3.Distance(string.drawn, nocks())).toBeLessThan(1e-4);
      expect(string.arrow.isEnabled(false)).toBe(false);

      // Before the fingers hold the string the hands are not on the arrow line yet:
      // an arrow there sticks out sideways at the hip, so there is none.
      pose(BOW_HOOK[0] / 2);
      string.update(BOW_HOOK[0] / 2);
      expect(Vector3.Distance(string.drawn, nocks())).toBeLessThan(1e-4);
      expect(string.arrow.isEnabled(false)).toBe(false);
      pose((BOW_HOOK[0] + BOW_HOOK[1]) / 2);
      string.update((BOW_HOOK[0] + BOW_HOOK[1]) / 2);
      expect(string.arrow.isEnabled(false)).toBe(false);
      pose(BOW_HOOK[1]);
      string.update(BOW_HOOK[1]);
      expect(string.arrow.isEnabled(false)).toBe(true);

      // Full draw: the string is in the draw fingers, pulled well back off the
      // bow, and the arrow's nock sits on it.
      const full = BOW_RELEASE - 0.01;
      pose(full);
      string.update(full);
      expect(Vector3.Distance(string.drawn, fingers())).toBeLessThan(1e-4);
      expect(Vector3.Distance(string.drawn, nocks())).toBeGreaterThan(0.4);
      expect(string.arrow.isEnabled(false)).toBe(true);
      string.arrow.computeWorldMatrix(true);
      const back = Vector3.TransformCoordinates(new Vector3(0, 0, -ARROW_LENGTH / 2), string.arrow.getWorldMatrix());
      expect(Vector3.Distance(back, string.drawn)).toBeLessThan(0.01);
      // It points from the string across the bow fist.
      const tip = Vector3.TransformCoordinates(new Vector3(0, 0, ARROW_LENGTH / 2), string.arrow.getWorldMatrix());
      expect(Vector3.Distance(tip, at("middle_01_l"))).toBeLessThan(Vector3.Distance(back, at("middle_01_l")));
      // The nock is at the jaw, not down at the collarbone inside the chest armour.
      expect(Math.abs(string.drawn.y - at("Head").y)).toBeLessThan(0.05);
      // A real bow fist: index knuckle on top, thumb up, the wrist not rolled.
      expect(at("index_01_l").y).toBeGreaterThan(at("pinky_01_l").y + 0.04);
      expect(handRoll()).toBeLessThan(10);
      // The shaft lies across the top of the bow fist, never through the fingers.
      const axis = tip.subtract(back).normalize();
      for (const f of ["index", "middle", "ring", "pinky"]) {
        for (const i of [1, 2, 3]) {
          const off = at(`${f}_0${i}_l`).subtract(back);
          const gap = off.subtract(axis.scale(Vector3.Dot(off, axis))).length();
          expect(gap, `${f}_0${i}_l`).toBeGreaterThan(0.025);
        }
      }

      // The draw elbow rides up with the hand at the jaw: level with the draw
      // wrist so the forearm runs back along the arrow, never hanging at the chest.
      pose(BOW_RELEASE);
      expect(Math.abs(at("lowerarm_r").y - at("hand_r").y)).toBeLessThan(0.08);
      expect(at("lowerarm_r").y).toBeGreaterThan(at("upperarm_r").y);

      // Loosed: the sim's arrow takes over and the string snaps back straight.
      string.update(BOW_RELEASE);
      expect(string.arrow.isEnabled(false)).toBe(false);
      expect(Vector3.Distance(string.drawn, nocks())).toBeLessThan(1e-4);

      // Between shots the arm hangs and swings with the locomotion like the other one:
      // the carry holds the bow hand alone, and the relaxed fist tips the index-side
      // limb (the BIND-named bottom nock) forward and up, clear of the ground.
      const carry = lib.animationGroups.find((g) => g.name === BOW_CARRY)!;
      expect(carry.targetedAnimations.map((t) => (t.target as TransformNode).name)).toEqual(["hand_l"]);
      pose(0, lib.animationGroups.find((g) => g.name === CLIP_NAME.idle)!);
      pose(0, carry);
      const limb = at("stalkerbow_nock_bottom").subtract(at("stalkerbow_nock_top")).normalize();
      // Idle alone leaves it 8 deg up, the carried fist 14.
      expect(Math.asin(limb.y) * 180 / Math.PI).toBeGreaterThan(11);
      expect(Math.min(at("stalkerbow_nock_top").y, at("stalkerbow_nock_bottom").y)).toBeGreaterThan(0.3);
      expect(handRoll()).toBeLessThan(10);

      // Unworn, no string and no arrow, whatever the clip says.
      string.setEnabled(false);
      string.update(full);
      expect(string.string.isEnabled(false)).toBe(false);
      expect(string.arrow.isEnabled(false)).toBe(false);
      string.dispose();
    } finally {
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  }, 60_000);
});

/**
 * A robe's leg backing is the leg's skin pushed out to 3 mm under the trousers,
 * so it only stays hidden if both ride the legs the same way. The jog is posed
 * onto the real skeleton and both are skinned on the CPU; a backing vertex is
 * showing when no trouser lies over it and trouser lies just under it. The
 * skirt is left out because at a run it swings clear of the thigh.
 */
describe("the robe's leg backing stays under its trousers", () => {
  const MODELS = fileURLToPath(new URL("../../public/models/", import.meta.url));

  it("keeps both leg backings under the trousers at bind and through most of the jog", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    engine = new NullEngine();
    const { scene } = createScene(engine);
    try {
      const load = (name: string) => LoadAssetContainerAsync(
        new File([readFileSync(`${MODELS}${name}`)], name, { type: "model/gltf-binary" }), scene);
      const wardrobe = await load("wardrobe.glb");
      const lib = await load("anim-library.glb");
      const mesh = (name: string) => wardrobe.meshes.find((m) => m.name === name) as Mesh;
      const robe = mesh("chest.ember.robe");
      const nodes = new Map(robe.skeleton!.bones.map((b) => [b.name, b.getTransformNode()!]));
      const jog = lib.animationGroups.find((g) => g.name === CLIP_NAME.run)!;
      expect(jog, CLIP_NAME.run).toBeDefined();
      const tracks = jog.targetedAnimations.filter((t) =>
        t.animation.targetProperty === "rotationQuaternion" && nodes.has(t.target.name)
        && !t.target.name.startsWith("skirt_"));
      expect(tracks.length).toBeGreaterThan(10);

      const skirt = (() => {
        const bones = robe.skeleton!.bones;
        const idx = robe.getVerticesData("matricesIndices")!;
        const w = robe.getVerticesData("matricesWeights")!;
        return (v: number) => {
          let best = 0;
          for (let k = 1; k < 4; k++) if (w[v * 4 + k]! > w[v * 4 + best]!) best = k;
          return bones[idx[v * 4 + best]!]!.name.startsWith("skirt_");
        };
      })();
      const ri = robe.getIndices()!;
      const trousers: number[] = [];
      for (let t = 0; t < ri.length; t += 3) {
        if (!skirt(ri[t]!) && !skirt(ri[t + 1]!) && !skirt(ri[t + 2]!)) trousers.push(t);
      }

      /** Distance along a ray to a robe triangle, or -1. */
      const hit = (p: Float32Array | number[], o: number[], d: number[], t: number, max: number) => {
        const a = ri[t]! * 3, b = ri[t + 1]! * 3, c = ri[t + 2]! * 3;
        const e1 = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!];
        const e2 = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
        const q = [d[1]! * e2[2]! - d[2]! * e2[1]!, d[2]! * e2[0]! - d[0]! * e2[2]!,
          d[0]! * e2[1]! - d[1]! * e2[0]!];
        const det = e1[0]! * q[0]! + e1[1]! * q[1]! + e1[2]! * q[2]!;
        if (Math.abs(det) < 1e-12) return -1;
        const s = [o[0]! - p[a]!, o[1]! - p[a + 1]!, o[2]! - p[a + 2]!];
        const u = (s[0]! * q[0]! + s[1]! * q[1]! + s[2]! * q[2]!) / det;
        if (u < 0 || u > 1) return -1;
        const r = [s[1]! * e1[2]! - s[2]! * e1[1]!, s[2]! * e1[0]! - s[0]! * e1[2]!,
          s[0]! * e1[1]! - s[1]! * e1[0]!];
        const v = (d[0]! * r[0]! + d[1]! * r[1]! + d[2]! * r[2]!) / det;
        if (v < 0 || u + v > 1) return -1;
        const dist = (e2[0]! * r[0]! + e2[1]! * r[1]! + e2[2]! * r[2]!) / det;
        return dist > 1e-5 && dist < max ? dist : -1;
      };

      /** Backing vertices standing outside the trousers, in the current pose. */
      const showing = (side: "l" | "r") => {
        const backing = mesh(`chest.ember.backing_leg_${side}`);
        const bp = backing.getPositionData(true, true)!;
        const rp = robe.getPositionData(true, true)!;
        const bi = backing.getIndices()!;
        const n = new Float32Array(bp.length);
        for (let t = 0; t < bi.length; t += 3) {
          const [a, b, c] = [bi[t]! * 3, bi[t + 1]! * 3, bi[t + 2]! * 3];
          const e1 = [bp[b]! - bp[a]!, bp[b + 1]! - bp[a + 1]!, bp[b + 2]! - bp[a + 2]!];
          const e2 = [bp[c]! - bp[a]!, bp[c + 1]! - bp[a + 1]!, bp[c + 2]! - bp[a + 2]!];
          const f = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!,
            e1[0]! * e2[1]! - e1[1]! * e2[0]!];
          for (const k of [a, b, c]) for (let i = 0; i < 3; i++) n[k + i]! += f[i]!;
        }
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (let j = 0; j < bp.length; j += 3) {
          for (let i = 0; i < 3; i++) {
            lo[i] = Math.min(lo[i]!, bp[j + i]! - 0.07);
            hi[i] = Math.max(hi[i]!, bp[j + i]! + 0.07);
          }
        }
        const near = trousers.filter((t) => [0, 1, 2].some((k) => {
          const v = ri[t + k]! * 3;
          return [0, 1, 2].every((i) => rp[v + i]! > lo[i]! && rp[v + i]! < hi[i]!);
        }));
        let count = 0;
        for (let j = 0; j < bp.length; j += 3) {
          const len = Math.hypot(n[j]!, n[j + 1]!, n[j + 2]!) || 1;
          const out = [n[j]! / len, n[j + 1]! / len, n[j + 2]! / len];
          const into = out.map((x) => -x);
          const o = [bp[j]!, bp[j + 1]!, bp[j + 2]!];
          if (near.some((t) => hit(rp, o, out, t, 0.06) >= 0)) continue;
          if (near.some((t) => hit(rp, o, into, t, 0.03) >= 0)) count++;
        }
        return count;
      };

      const pose = (frame: number | null) => {
        for (const t of tracks) {
          const node = nodes.get(t.target.name)!;
          (node as unknown as { __rest?: unknown }).__rest ??= node.rotationQuaternion!.clone();
          node.rotationQuaternion = frame === null
            ? (node as unknown as { __rest: typeof node.rotationQuaternion }).__rest!.clone()
            : t.animation.evaluate(frame);
        }
        for (const root of wardrobe.rootNodes) root.computeWorldMatrix(true);
        for (const node of nodes.values()) node.computeWorldMatrix(true);
        robe.skeleton!.prepare(true);
      };

      pose(null);
      // 22 and 13 when the tear-rim fallback pushed with no air.
      expect(Math.max(showing("l"), showing("r"))).toBeLessThanOrEqual(1);
      const jogs: [number, number][] = [];
      for (let k = 0; k < 6; k++) {
        pose(jog.from + ((jog.to - jog.from) * k) / 6);
        jogs.push([showing("l"), showing("r")]);
      }
      // Body weights under the trousers: 16 to 83 per leg on every frame. The
      // frame with a knee raised still shows ~60 at the front of that knee.
      const clean = jogs.filter(([l, r]) => l <= 8 && r <= 8).length;
      expect(clean, JSON.stringify(jogs)).toBeGreaterThanOrEqual(4);
    } finally {
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  }, 60_000);
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

describe("a melee swing lands heavy and on the hit", () => {
  const WINDUP = 7 / 30;
  const BEAT = 21 / 30;
  const MODELS = fileURLToPath(new URL("../../public/models/", import.meta.url));
  const glb = readFileSync(`${MODELS}anim-library.glb`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8")) as any;
  const bin = 20 + glb.readUInt32LE(12) + 8;
  const floats = (i: number, width: number) => {
    const a = json.accessors[i];
    const start = bin + (json.bufferViews[a.bufferView].byteOffset ?? 0) + (a.byteOffset ?? 0);
    return (k: number, c: number) => glb.readFloatLE(start + (k * width + c) * 4);
  };
  const anim = (clip: StrikeClip) => json.animations.find((a: { name: string }) => a.name === CLIP_NAME[clip]);
  const seconds = (clip: StrikeClip) => Math.max(...anim(clip).samplers.map((s: { input: number }) => json.accessors[s.input].max[0]));

  it.each(STRIKE_CLIPS)("%s reaches the contact pose on the tick the sim resolves the swing", (clip) => {
    const t = STRIKE_TIMING[clip];
    const clipS = seconds(clip);
    const p = strikePace(clipS, t, WINDUP, BEAT);
    const toContact = (clipS * t.drop) / p.raise + (clipS * (t.contact - t.drop)) / p.drop;
    // Within a tick: the finisher's feint is a long raise and runs at the rate cap.
    expect(Math.abs(toContact - WINDUP)).toBeLessThan(1 / 30);
    // The follow-through fills the rest of the beat, so a held button chains swings.
    expect(toContact + (clipS * (1 - t.contact)) / p.follow).toBeCloseTo(BEAT, 1);
  });

  it("raises slow and drops fast", () => {
    for (const clip of ["strikeA", "strikeB"] as const) {
      const t = STRIKE_TIMING[clip];
      const p = strikePace(seconds(clip), t, WINDUP, BEAT);
      expect(p.drop, clip).toBeGreaterThan(p.raise * 1.5);
      expect(strikeRatioAt(t.drop / 2, p, t)).toBe(p.raise);
      expect(strikeRatioAt((t.drop + t.contact) / 2, p, t)).toBe(p.drop);
      expect(strikeRatioAt(0.9, p, t)).toBe(p.follow);
    }
  });

  it("falls back to one even rate when the sim sent no wind-up", () => {
    const r = actionRatio(1.4, BEAT);
    expect(strikePace(1.4, STRIKE_TIMING.strikeA, undefined, BEAT)).toEqual({ raise: r, drop: r, follow: r });
  });

  it.each(STRIKE_CLIPS)("%s drops and stops where its arm speed says", (clip) => {
    const a = anim(clip);
    let speed: number[] = [];
    let times: number[] = [];
    for (const ch of a.channels) {
      const bone = json.nodes[ch.target.node].name as string;
      if (ch.target.path !== "rotation" || !["upperarm_r", "lowerarm_r", "hand_r", "spine_03"].includes(bone)) continue;
      const smp = a.samplers[ch.sampler];
      const t = floats(smp.input, 1);
      const q = floats(smp.output, 4);
      const n = json.accessors[smp.input].count as number;
      if (times.length === 0) { times = Array.from({ length: n }, (_, k) => t(k, 0)); speed = new Array(n).fill(0); }
      for (let k = 1; k < n; k++) {
        let dot = 0;
        for (let c = 0; c < 4; c++) dot += q(k, c) * q(k - 1, c);
        speed[k]! += (2 * Math.acos(Math.min(1, Math.abs(dot)))) / (times[k]! - times[k - 1]!);
      }
    }
    const end = times[times.length - 1]!;
    const peak = speed.indexOf(Math.max(...speed));
    // The drop is the burst around the fastest frame: speed above half the peak.
    let drop = peak;
    while (drop > 1 && speed[drop - 1]! >= speed[peak]! * 0.5) drop--;
    // The contact is where the blade has all but stopped after it.
    let stop = peak;
    while (stop < speed.length - 1 && speed[stop]! > speed[peak]! * 0.1) stop++;
    expect(Math.abs(times[drop - 1]! / end - STRIKE_TIMING[clip].drop), "drop").toBeLessThan(0.02);
    expect(Math.abs(times[stop]! / end - STRIKE_TIMING[clip].contact), "contact").toBeLessThan(0.02);
  });
});
