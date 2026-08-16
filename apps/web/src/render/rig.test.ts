// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core";
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
  IDLE_SETTLE_SEC,
  IDLE_SETTLED,
  isRigReady,
  loadPlayerRig,
  resetPlayerRig,
  speedRatioFor,
  looksForEquipment,
  meshLook,
  COSMETIC_SLOTS,
  type CosmeticSlot,
  GEAR_TEXTURE_BASES,
  HIPS_BOB,
  SKIRT_CHAINS,
  SKIRT_JOINTS,
  STRIKE_CLIPS,
  isLayeredClip,
} from "./rig";
import { ITEM_POOLS, STARTER_BASE_IDS, baseOf } from "@exiled/content-runtime";
import { EQUIP_SLOTS_BY_CLASS } from "@exiled/simulation";

/**
 * Every base that can end up in an equipment slot, droppable or not.
 *
 * `ITEM_POOLS.bases` is the DROP pool, and the class starter armours are
 * deliberately outside it (they exist so a new character has a silhouette, not
 * so the loot table grows three entries). They are still worn, so they still
 * owe the rig a texture.
 */
const ITEM_BASES = [...ITEM_POOLS.bases, ...STARTER_BASE_IDS.map((id) => baseOf(id))];

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
    // `belt` is the exception and stays null: KayKit paints every outfit's belt
    // into its torso, so there is no separate mesh to show.
    const looks = looksForEquipment(
      Object.fromEntries(COSMETIC_SLOTS.map((slot) => [slot, { baseId: "base.whatever" }])),
    );
    for (const slot of COSMETIC_SLOTS) {
      if (slot === "belt") expect(looks[slot]).toBeNull();
      else expect(looks[slot], slot).not.toBeNull();
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

  it("sends a base to its own outfit rather than to a re-tint of one", () => {
    // What replaced the texture bake: plate, leather and robes are three
    // different KayKit outfits, so the look itself differs per base instead of
    // one coat arriving in three colours.
    const bodyFor = (baseId: string): string | null =>
      looksForEquipment({ body: { baseId } }).body;
    expect(bodyFor("base.ironsworn_plate")).toBe("knight");
    expect(bodyFor("base.stalker_leathers")).toBe("rogue");
    expect(bodyFor("base.emberbound_robe")).toBe("mage");
    // A base with no entry still gets dressed, in the slot's default.
    expect(bodyFor("base.something_new")).not.toBeNull();
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
    // Deliberately vacuous today: the old wardrobe had one outfit, so a base
    // could only differ by a re-palettized atlas, and this pinned that bake to
    // its files. The KayKit wardrobe gives each base its own GEOMETRY instead
    // (`LOOK_BY_BASE`), so the table is empty. The check stays so a future bake
    // against the new atlases cannot ship half-wired.
    for (const baseId of GEAR_TEXTURE_BASES) {
      const slug = baseId.split(".", 2)[1]!;
      expect(existsSync(`${GEAR}${slug}.png`)).toBe(true);
    }
  });

  it("names bases that content actually defines", () => {
    const defined = new Set(ITEM_BASES.map((b) => b.id));
    for (const baseId of GEAR_TEXTURE_BASES) expect(defined).toContain(baseId);
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
    nodes: { name: string; mesh?: number; skin?: number }[];
    skins: { joints: number[] }[];
    materials: { name: string }[];
  };
  const skinned = json.nodes.filter((n) => n.skin !== undefined).map((n) => n.name);

  it("rides one KayKit Rig_Medium skeleton and nothing else", () => {
    expect(json.skins).toHaveLength(1);
    const joints = json.skins[0]!.joints.map((j) => json.nodes[j]!.name);
    expect(joints).toHaveLength(23);
    // The bones the runtime names by hand. `handslot.*` is what makes held gear
    // a wardrobe slot rather than a per-frame attachment.
    for (const bone of ["root", "hips", "chest", "head", "hand.r", "handslot.r", "handslot.l"]) {
      expect(joints, bone).toContain(bone);
    }
  });

  it("has no skirt chains, so the cloth solver stays out of the way", () => {
    // KayKit skins its capes straight to the chest. `buildSkirt` finds no
    // `skirt_*` bones and leaves the sim null, which is the intended state on
    // this rig - pinned so a half-built chain cannot appear unnoticed.
    const chains = json.skins[0]!.joints.filter((j) => json.nodes[j]!.name.startsWith("skirt_"));
    expect(chains).toHaveLength(0);
    expect(SKIRT_CHAINS * SKIRT_JOINTS).toBeGreaterThan(0);
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
      expect(skinned.some((n) => n.startsWith(prefix)), `${prefix} missing`).toBe(true);
    }
  });

  it("carries a look for every base that can be worn or held", () => {
    // Every equippable base, not just the slot defaults: a mistyped entry in
    // `LOOK_BY_BASE` is not a wrong colour, it is a limb or a fist that renders
    // as nothing at all.
    const wanted: string[] = [];
    for (const base of ITEM_BASES) {
      for (const slot of EQUIP_SLOTS_BY_CLASS[base.itemClass ?? ""] ?? []) {
        if (!(COSMETIC_SLOTS as readonly string[]).includes(slot)) continue;
        const look = looksForEquipment({ [slot]: { baseId: base.id } })[slot as CosmeticSlot];
        // `belt` has no geometry in this pack and resolves to null on purpose.
        if (look === null) continue;
        wanted.push(`${slot}.${meshLook(look)}.`);
      }
    }
    expect(wanted.length).toBeGreaterThan(0);
    for (const prefix of wanted) {
      expect(skinned.some((n) => n.startsWith(prefix)), `${prefix} missing`).toBe(true);
    }
  });

  it("gives every armour look a whole figure, not a floating chest", () => {
    // An outfit's arms and legs ARE its gloves and boots slots, so a look that
    // shipped a torso and no limbs would render as a head over trousers the
    // moment its base was equipped.
    const looks = new Set(
      skinned.filter((n) => n.startsWith("body.")).map((n) => n.split(".")[1]!),
    );
    expect(looks.size).toBeGreaterThanOrEqual(6);
    for (const look of looks) {
      for (const part of [`body.${look}.torso`, `gloves.${look}.arms`, `boots.${look}.legs`]) {
        expect(skinned, part).toContain(part);
      }
    }
  });

  it("skins every part, so no piece floats free of the rig", () => {
    // Counted on `mesh`, not on a dot in the name: this rig's BONES are dotted
    // too (`hand.r`), and the old spelling of this test passed them off as
    // unskinned geometry.
    const meshNodes = json.nodes.filter((n) => n.mesh !== undefined);
    expect(meshNodes.length).toBeGreaterThan(40);
    expect(meshNodes.every((n) => n.skin !== undefined)).toBe(true);
  });

  it("ships one atlas per outfit rather than a copy per import", () => {
    // Every one of the 24 source files brings its own material; the builder
    // collapses them by name. Left alone the glb carried five duplicate atlases.
    expect(json.materials.length).toBeLessThanOrEqual(6);
  });
});

/**
 * The wardrobe rests on the six KayKit characters being skin-compatible: a mesh
 * from one binds to another's skeleton by assignment alone, no retargeting.
 * That holds only while they all list the same joints at the same rest pose. It
 * is an asset invariant, not a code one, so it is checked against the source
 * files a seventh outfit would have to join.
 */
describe("pack skin compatibility", () => {
  const PACK = fileURLToPath(
    new URL(
      "../../../../assets/props/source/kaykit_adventurers/KayKit_Adventurers_2.0_FREE/Characters/gltf/",
      import.meta.url,
    ),
  );
  const FILES = ["Knight", "Barbarian", "Mage", "Ranger", "Rogue", "Rogue_Hooded"];

  /** Joint names and their inverse bind matrices, out of one character glb. */
  function readSkin(file: string): { joints: string[]; ibm: number[] } {
    const glb = readFileSync(`${PACK}${file}.glb`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8")) as any;
    const bin = 20 + glb.readUInt32LE(12) + 8;
    const accessor = doc.accessors[doc.skins[0].inverseBindMatrices];
    const view = doc.bufferViews[accessor.bufferView];
    const start = bin + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const ibm: number[] = [];
    for (let i = 0; i < accessor.count * 16; i++) ibm.push(glb.readFloatLE(start + i * 4));
    const joints: string[] = doc.skins[0].joints.map((j: number) => doc.nodes[j].name as string);
    return { joints, ibm };
  }

  const skins = new Map(FILES.map((f) => [f, readSkin(f)]));

  it("lists the same 23 joints", () => {
    const reference = new Set(skins.get("Knight")!.joints);
    expect(reference.size).toBe(23);
    for (const file of FILES) {
      expect(new Set(skins.get(file)!.joints), file).toEqual(reference);
    }
  });

  it("binds those joints at the same rest pose", () => {
    // Compared BY JOINT, not by index: the six files list the same skeleton in
    // different orders, which is free (a joint binds by name) as long as each
    // one's bind matrix agrees. Millimetre tolerance, because the exports differ
    // in float noise rather than in shape.
    const reference = skins.get("Knight")!;
    for (const file of FILES) {
      const skin = skins.get(file)!;
      for (const [i, joint] of skin.joints.entries()) {
        const j = reference.joints.indexOf(joint);
        for (let c = 0; c < 16; c++) {
          expect(
            Math.abs(skin.ibm[i * 16 + c]! - reference.ibm[j * 16 + c]!),
            `${file} ${joint}[${c}]`,
          ).toBeLessThan(1e-3);
        }
      }
    }
  });

  it("keeps the pieces the builder cuts up", () => {
    const glb = readFileSync(`${PACK}Knight.glb`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8")) as any;
    const names = doc.meshes.map((m: { name: string }) => m.name);
    for (const part of ["Knight_Body", "Knight_ArmLeft", "Knight_LegRight", "Knight_Helmet"]) {
      expect(names, part).toContain(part);
    }
  });
});

/**
 * The cast leaves the weapon hand, and the two strikes are different swings.
 *
 * Nothing else pins that: a clip is a name the loader looks up, and a library
 * rebuilt from the wrong takes still loads and still animates - it just casts
 * from the empty hand, or plays one swing twice. So this measures which arm
 * actually moves, per bone, straight out of the glb.
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
      // q and -q are the same rotation, and authored takes do flip sign
      // mid-clip. Align each frame to the one before it, or the measure says
      // more about the encoding than about the arm.
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

  it("animates the same skeleton the wardrobe is built on", () => {
    // Same rig, so the library is a copy rather than a retarget - the whole
    // reason `remapHips` has nothing left to correct.
    const wardrobe = readFileSync(`${MODELS}wardrobe.glb`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const other = JSON.parse(
      wardrobe.subarray(20, 20 + wardrobe.readUInt32LE(12)).toString("utf8"),
    ) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jointsOf = (doc: any): Set<string> =>
      new Set(doc.skins[0].joints.map((j: number) => doc.nodes[j].name as string));
    expect(jointsOf(json)).toEqual(jointsOf(other));
  });

  it("ships two distinct weapon-arm attacks and layers both over locomotion", () => {
    expect(STRIKE_CLIPS).toHaveLength(2);
    expect(new Set(STRIKE_CLIPS.map((clip) => CLIP_NAME[clip])).size).toBe(2);
    // Different swings, not one take twice: the diagonal slice and the overhead
    // chop move the weapon arm by measurably different amounts.
    const [a, b] = STRIKE_CLIPS.map((clip) => travel(CLIP_NAME[clip], "upperarm.r"));
    expect(Math.abs(a! - b!)).toBeGreaterThan(0.1);
    for (const clip of STRIKE_CLIPS) {
      expect(isLayeredClip(clip)).toBe(true);
      // Both arms move in a KayKit swing - the off hand counterbalances hard
      // enough to out-travel the sword arm in the diagonal slice - so what is
      // worth pinning is that the weapon arm is driven at all, and that the two
      // takes are not the same motion.
      const right = travel(CLIP_NAME[clip], "upperarm.r") + travel(CLIP_NAME[clip], "lowerarm.r");
      expect(right, clip).toBeGreaterThan(1);
    }
  });

  it("casts from the right arm, the one `weapon1` skins to", () => {
    for (const bone of ["upperarm", "lowerarm"]) {
      const right = travel(CLIP_NAME.cast, `${bone}.r`);
      const left = travel(CLIP_NAME.cast, `${bone}.l`);
      expect(right, bone).toBeGreaterThan(left);
    }
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
  const clip = lib.json.animations.find((a: { name: string }) => a.name === CLIP_NAME.idle);
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
  const HIPS = "hips";
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
    expect(travel("foot.l", HIPS_BOB.idle)).toBeLessThan(0.0025);
    expect(travel("foot.r", HIPS_BOB.idle)).toBeLessThan(0.0025);
  });

  it("floats him again if the hips curve is compressed", () => {
    // The mechanism, pinned as a comparison rather than as absolute millimetres:
    // KayKit's idle breathes less than the old pack's, so the numbers moved even
    // though the failure mode did not. Take any of the hips curve away and the
    // legs are over-rotated against it, and the residual comes out at the soles.
    const planted = travel("foot.l", HIPS_BOB.idle);
    expect(travel("foot.l", 0.65)).toBeGreaterThan(planted * 1.5);
    expect(travel("foot.l", 0)).toBeGreaterThan(travel("foot.l", 0.65));
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
