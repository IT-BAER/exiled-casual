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
  partShown,
  COSMETIC_SLOTS,
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

/**
 * The generated iron cap is pinned to the atlas's brightest texel so a helmet
 * base's palette puts it at the light end of its own ramp. Worn with nothing in
 * the slot there is no palette, so that texel is the raw atlas grey and the cowl
 * got a white skullcap on green cloth.
 */
describe("partShown", () => {
  it("keeps the generated helm off a hood worn with no helmet base", () => {
    expect(partShown("helmet.hood.helm", true, undefined)).toBe(false);
    expect(partShown("helmet.hood.helm", true, "base.cinder_cap")).toBe(true);
  });

  it("leaves every other part to its look alone", () => {
    expect(partShown("helmet.hood.hood", true, undefined)).toBe(true);
    expect(partShown("body.ranger.coat", true, undefined)).toBe(true);
    expect(partShown("helmet.hood.hood", false, "base.cinder_cap")).toBe(false);
  });

  it("only ever hides a look the wardrobe really ships", () => {
    // A rule keyed on a name is a rule that a rename silently disables.
    const parts = readFileSync(fileURLToPath(new URL("../../public/models/wardrobe.glb", import.meta.url)));
    expect(parts.includes("helmet.hood.helm")).toBe(true);
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
    // exists to remove. Held gear is worse than wrong-coloured: its meshes carry
    // either one pinned texel or a projection of their own icon, so an unmapped
    // hand base smears the clothing atlas along a wand.
    //
    // The class is NOT the slot name — a `wand` fills `weapon1` and a `shield`
    // fills `weapon2` — so the two are mapped through the sim's own table rather
    // than compared as strings, which silently skipped every held class.
    const cosmetic = new Set<string>(COSMETIC_SLOTS);
    const worn = (itemClass: string) =>
      (EQUIP_SLOTS_BY_CLASS[itemClass] ?? []).some((slot) => cosmetic.has(slot));
    const missing = ITEM_BASES.filter(
      (b) => b.itemClass !== undefined && worn(b.itemClass) && !GEAR_TEXTURE_BASES.includes(b.id),
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
    // Against the constants, not against a literal: both the chain count and the
    // joints per chain live in the builder and in `rig.ts`, and a rebuild with
    // either of them changed drops bones out of the coat silently.
    expect(skirt.length).toBe(SKIRT_CHAINS * SKIRT_JOINTS);
  });

  it("hangs every skirt chain on effectively one segment length", () => {
    // `rig.ts` measures one bone of one chain and solves every bone of every
    // chain against it, so this covers all of them below the first — the first
    // carries its offset from the pelvis rather than a segment length. They are
    // not bit-identical, because the coat is an ellipse and a chain at the hip
    // travels further out than one at the belly, but that spread is 0.2% - a
    // millimetre on this character. A ring that drifted past 1% would render as
    // cloth of the wrong length on seven chains out of eight.
    const lengths = json.nodes
      .filter((n) => /^skirt_\d+_\d+$/.test(n.name) && !/_01$/.test(n.name))
      .map((n) => Math.hypot(...(n.translation ?? [0, 0, 0])));
    expect(lengths).toHaveLength(SKIRT_CHAINS * (SKIRT_JOINTS - 1));
    expect(lengths[0]).toBeGreaterThan(0.1);
    for (const length of lengths) {
      expect(Math.abs(length - lengths[0]!) / lengths[0]!).toBeLessThan(0.01);
    }
  });

  it("binds every coat vertex to a single chain, so collision can reach it", () => {
    // The solver collides the chains and nothing else: `SKIRT_JOINTS` particles
    // per chain, pushed out of the leg capsules. A vertex weighted half to one chain and
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
    // Every body look is its own coat and each must satisfy this, not only the
    // ranger: a bulkier plate or a slimmer leather profile that re-opened the
    // between-chains gap would be a leg through cloth on that look alone.
    const coats = json.nodes
      .filter((n) => /^body\.[^.]+\.coat$/.test(n.name) && n.mesh !== undefined)
      .map((n) => n.name);
    expect(coats.length).toBeGreaterThan(1);

    for (const coat of coats) {
      const { data: index } = attribute(coat, "JOINTS_0");
      const { data: weight } = attribute(coat, "WEIGHTS_0");
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
      expect(worst, `${coat} splits a vertex across chains`).toBeLessThan(0.01);
    }
  });

  it("carries a head that is unwrapped onto the painted face, not pinned to one texel", () => {
    // Neither outfit pack ships a head, but both ship the *texture* for one: a
    // face painted into the top-left of `T_Regular_Male_Dark_BaseColor.png` that
    // each pack references and neither uses, because the head it was unwrapped
    // for lives in the author's separate base-character pack. The head is cut
    // out of that base male so it arrives already carrying those uvs.
    //
    // What this pins is that the head is UNWRAPPED, which a name test cannot
    // see. The head this replaced was a uv sphere with every loop pinned to one
    // flat skin texel — correctly shaped, correctly animated, and completely
    // blank — so "a part called base.head.* exists" passed all the way through
    // it. Hair is still pinned on purpose, which makes it the control: if the
    // pin ever came back for the head, hair is what it would look like.
    for (const part of ["base.head.head", "base.head.eyes", "base.head.brows", "base.head.hair"]) {
      expect(skinned).toContain(part);
    }

    const uvSpread = (part: string) => {
      const { data } = attribute(part, "TEXCOORD_0");
      const lo = [Infinity, Infinity];
      const hi = [-Infinity, -Infinity];
      for (let i = 0; i < data.length; i += 2) {
        for (const k of [0, 1]) {
          lo[k] = Math.min(lo[k]!, data[i + k]!);
          hi[k] = Math.max(hi[k]!, data[i + k]!);
        }
      }
      return Math.min(hi[0]! - lo[0]!, hi[1]! - lo[1]!);
    };

    // A face island is a good fraction of the atlas in both directions.
    expect(uvSpread("base.head.head")).toBeGreaterThan(0.1);
    expect(uvSpread("base.head.eyes")).toBeGreaterThan(0.1);
    expect(uvSpread("base.head.hair")).toBe(0);
  });

  it("carries the coat, which is the armoured body's silhouette", () => {
    // Generated, not cut from a pack: every body base is drawn as a long coat
    // and the ranger's authored body stops at the hip. Lose this part in a
    // rebuild and the character silently goes back to wearing a tunic, which
    // the look-prefix tests above would not notice.
    expect(skinned).toContain("body.ranger.coat");
  });

  it("gives every armour body look a whole body, not just a coat", () => {
    // The runtime dresses by showing `body.<look>.*` and hiding the rest of the
    // slot, so a look that owns only a coat renders as a floating skirt with no
    // torso, arms or legs. Every armour look (anything past the commoner default)
    // must carry the same body parts the ranger does, plus its own coat.
    const partsOf = (look: string) =>
      new Set(
        skinned
          .filter((n) => n.startsWith(`body.${look}.`))
          .map((n) => n.split(".")[2]!),
      );
    const need = ["torso", "legs", "sleeves", "hands", "coat"];
    const looks = new Set(
      skinned
        .filter((n) => n.startsWith("body.") && !n.startsWith("body.commoner."))
        .map((n) => n.split(".")[1]!),
    );
    expect(looks.size).toBeGreaterThan(1); // ranger plus at least one armour look
    for (const look of looks) {
      const parts = partsOf(look);
      for (const part of need) {
        expect(parts.has(part), `body.${look} is missing ${part}`).toBe(true);
      }
    }
  });

  it("hangs a pauldron on the arm it belongs to, on both sides", () => {
    // Plate's caps are the pack's single left-hand pauldron, copied and mirrored
    // (`build_pauldrons`). The mesh carries a vertex group per skeleton joint
    // rather than only the one it uses, so moving the bind is moving WEIGHTS,
    // and the first attempt renamed groups instead: every group took the same
    // name, Blender suffixed the collisions, and the group holding the weights
    // matched no bone. glTF answers that with `neutral_bone`, which is silent -
    // the cap loads, binds to the root, and hangs at the character's feet. A
    // name test cannot see it; only where the weights point can.
    const joints = json.skins[0]!.joints.map((j) => json.nodes[j]!.name);
    const caps = json.nodes
      .filter((n) => /^body\.[^.]+\.pauldron_[lr]$/.test(n.name) && n.mesh !== undefined)
      .map((n) => n.name);
    expect(caps.length).toBeGreaterThanOrEqual(2);

    for (const cap of caps) {
      const side = cap.endsWith("_l") ? "l" : "r";
      const { data: index } = attribute(cap, "JOINTS_0");
      const { data: weight } = attribute(cap, "WEIGHTS_0");
      const perBone = new Map<string, number>();
      for (let k = 0; k < weight.length; k++) {
        if (weight[k]! <= 0) continue;
        const bone = joints[index[k]!]!;
        perBone.set(bone, (perBone.get(bone) ?? 0) + weight[k]!);
      }
      // A shoulder cap follows the arm and nothing else: bound to the cloth
      // chains it would swing with the skirt and shear off the shoulder.
      expect([...perBone.keys()], `${cap} is not bound to its own arm alone`)
        .toEqual([`upperarm_${side}`]);
    }
  });

  it("bends a cuirass with the body, not against it", () => {
    // The shell over the chest takes its weights from the nearest torso vertex
    // (`build_cuirass`) precisely so it deforms with the tunic under it. Bound
    // to one spine bone instead it would be rigid and shear at the waist, and
    // bound to the coat's chains it would swing with the skirt. Either reads as
    // a bug only in motion, so the bind is pinned rather than the look.
    const joints = json.skins[0]!.joints.map((j) => json.nodes[j]!.name);
    const bonesOf = (name: string) => {
      const { data: index } = attribute(name, "JOINTS_0");
      const { data: weight } = attribute(name, "WEIGHTS_0");
      const used = new Set<string>();
      for (let k = 0; k < weight.length; k++) {
        if (weight[k]! > 0) used.add(joints[index[k]!]!);
      }
      return [...used].sort();
    };
    const shells = json.nodes
      .filter((n) => /^body\.[^.]+\.cuirass$/.test(n.name) && n.mesh !== undefined)
      .map((n) => n.name);
    expect(shells.length).toBeGreaterThan(0);
    for (const shell of shells) {
      expect(bonesOf(shell), `${shell} does not bend with the torso`)
        .toEqual(bonesOf("body.ranger.torso"));
    }
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

  it("carries a look for every base that can be held", () => {
    // The hands are the one place a *base* names its own mesh rather than
    // inheriting its slot's, so a mistyped look here is not a wrong colour, it
    // is an empty fist - and the test above cannot see it, because it only ever
    // asks for the slot default.
    const held: string[] = [];
    for (const base of ITEM_BASES) {
      for (const slot of EQUIP_SLOTS_BY_CLASS[base.itemClass ?? ""] ?? []) {
        if (slot !== "weapon1" && slot !== "weapon2") continue;
        const look = looksForEquipment({ [slot]: { baseId: base.id } })[slot];
        expect(look, `${base.id} has no look`).not.toBeNull();
        held.push(`${slot}.${meshLook(look!)}.`);
      }
    }
    expect(held.length).toBeGreaterThan(0);
    for (const prefix of held) {
      expect(skinned.some((n) => n.startsWith(prefix)), `${prefix} missing`).toBe(true);
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
