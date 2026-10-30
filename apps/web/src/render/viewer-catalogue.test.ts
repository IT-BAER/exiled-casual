// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { CLASS_LIST, MONSTERS } from "@exiled/content-runtime";
import { CLIP_NAME, gaitOf, SLOTS, type RigClip } from "./rig";
import { SPAWNABLE } from "./gallery";
import { PET_ACTIONS, PET_CLIPS } from "./pet";
import { looksFromPartNames } from "./viewer-scene";
import {
  PET_SUBJECT,
  ONE_SHOTS,
  GAITS,
  DIRECTIONS_8,
  SUBJECT_GROUPS,
  classPreset,
  mainGroup,
  parseViewerState,
  viewerStateQuery,
  rawClipLabel,
  DEFAULT_VIEWER_STATE,
  FX_PREVIEWS,
  abilityLabel,
  bossSummon,
  bossTell,
  creatureActions,
  creatureTelegraph,
  shooterBolt,
  telegraphFrame,
} from "./viewer-catalogue";

function glbJson(path: string): { meshes?: { name?: string }[]; nodes?: { name?: string }[]; animations?: { name?: string }[] } {
  const glb = readFileSync(fileURLToPath(new URL(path, import.meta.url)));
  const n = glb.readUInt32LE(12);
  return JSON.parse(glb.subarray(20, 20 + n).toString("utf8"));
}

const WARDROBE = glbJson("../../public/models/wardrobe.glb");
const PART_NAMES = [...(WARDROBE.meshes ?? []), ...(WARDROBE.nodes ?? [])].map((n) => n.name ?? "");

describe("subject groups", () => {
  it("puts every spawnable in exactly one group, the character first", () => {
    const all = SUBJECT_GROUPS.flatMap((g) => g.subjects.map((s) => s.id));
    expect(all[0]).toBe("character");
    for (const s of SPAWNABLE) expect(all.filter((id) => id === s.id)).toHaveLength(1);
    expect(new Set(all).size).toBe(all.length);
  });

  it("never shows an empty group", () => {
    for (const g of SUBJECT_GROUPS) expect(g.subjects.length, g.label).toBeGreaterThan(0);
  });

  it("lists the companion cat under its own group with every action it has", () => {
    const pets = SUBJECT_GROUPS.find((g) => g.label === "Pet");
    expect(pets?.subjects.map((s) => s.id)).toEqual([PET_SUBJECT.id]);
    expect(PET_ACTIONS).toEqual(PET_CLIPS);
    expect(parseViewerState("?viewer&subject=pet&clip=pet:relaxed").subject).toBe("pet");
  });
});

describe("character clips", () => {
  it("reaches every clip the rig carries, as a one-shot or through a gait", () => {
    const shots = new Set<RigClip>(ONE_SHOTS.flatMap((s) => s.clips));
    for (const clip of Object.keys(CLIP_NAME) as RigClip[]) {
      const reached = shots.has(clip) || clip === "idle" || gaitOf(clip) !== null;
      expect(reached, clip).toBe(true);
    }
  });

  it("offers idle, walk and run and eight distinct directions", () => {
    expect(GAITS.map((g) => g.id)).toEqual(["idle", "walk", "run"]);
    expect(new Set(DIRECTIONS_8.map((d) => d.rel)).size).toBe(8);
  });
});

describe("class presets", () => {
  it("dresses each class in looks the wardrobe ships, every armour slot and the main hand", () => {
    const vocab = looksFromPartNames(PART_NAMES);
    for (const cls of CLASS_LIST) {
      const looks = classPreset(cls.id);
      for (const slot of ["helmet", "chest", "gloves", "boots", "weapon1"] as const) {
        expect(looks[slot], `${cls.id} ${slot}`).not.toBeNull();
        expect(vocab[slot], `${cls.id} ${slot}`).toContain(looks[slot]);
      }
      expect(looks.base).toBe(cls.body);
    }
  });
});

describe("main group", () => {
  const g = (name: string, isPlaying: boolean, playOrder = 0) => ({ name, isPlaying, playOrder });

  it("shows the one-shot over the locomotion under it", () => {
    expect(mainGroup([g("walk", true), g("cast", true, 1)])?.name).toBe("cast");
  });

  it("falls back to the playing locomotion, and to nothing", () => {
    expect(mainGroup([g("walk", true), g("cast", false, 1)])?.name).toBe("walk");
    expect(mainGroup([g("walk", false)])).toBeNull();
  });
});

describe("viewer URL state", () => {
  it("round-trips a full view", () => {
    const state = {
      subject: "monster.cinder_imp.v1",
      looks: { helmet: "ember", weapon1: "broadsword", weapon2: null },
      clip: "attack",
      light: "game" as const,
      camera: "side" as const,
    };
    expect(parseViewerState(`?viewer&${viewerStateQuery(state)}`)).toEqual(state);
  });

  it("opens on the defaults when the query says nothing", () => {
    expect(parseViewerState("?viewer")).toEqual(DEFAULT_VIEWER_STATE);
  });

  it("drops a look for a slot that does not exist and an unknown light", () => {
    const parsed = parseViewerState("?viewer&looks=wings:angel,helmet:ember&light=disco");
    expect(parsed.looks).toEqual({ helmet: "ember" });
    expect(parsed.light).toBe(DEFAULT_VIEWER_STATE.light);
    for (const slot of Object.keys(parsed.looks)) expect(SLOTS).toContain(slot);
  });
});

describe("skill FX previews", () => {
  it("previews every skill that draws something, arrows as arrows", () => {
    const ids = FX_PREVIEWS.map((f) => f.skillId);
    for (const id of ["skill.ember_bolt.v1", "skill.strike.v1", "skill.cinder_ground.v1", "skill.blink.v1"]) {
      expect(ids).toContain(id);
    }
    expect(FX_PREVIEWS.find((f) => f.skillId === "skill.snap_shot.v1")?.kind).toBe("arrow");
    expect(ids).not.toContain("skill.town_portal.v1");
  });
});

describe("creature telegraphs", () => {
  it("offers Charge to the brutes, Slam to the heavies and bosses, phase 2 and Summon to bosses alone", () => {
    for (const [id, def] of MONSTERS) {
      const actions = creatureActions(id);
      expect(actions.slice(0, 5)).toEqual(["idle", "walk", "attack", "hit", "death"]);
      expect(actions.includes("charge"), id).toBe(def.charge !== undefined);
      expect(actions.includes("slam"), id).toBe(def.heavy !== undefined || def.boss?.slam !== undefined);
      expect(actions.includes("slam2"), id).toBe(def.boss !== undefined);
      expect(actions.includes("summon"), id).toBe(def.boss !== undefined);
    }
    expect(creatureActions("monster.vaal_construct.v1")).toContain("charge");
    expect(creatureActions("monster.blood_sentinel.v1")).toContain("slam");
    expect(creatureActions("monster.cinder_warden.v1")).toContain("slam");
    expect(creatureActions("monster.vaal_husk.v1")).toEqual(["idle", "walk", "attack", "hit", "death"]);
  });

  it("leaves a boss's phase-2 slam burning for its patch's lifetime, and gives a trash heavy none", () => {
    const tg = creatureTelegraph("monster.cinder_warden.v1", "slam2")!;
    expect(tg.radius).toBeCloseTo(3.5, 5);
    expect(tg.windupS).toBeCloseTo(1, 5);
    expect(tg.groundS).toBeCloseTo(4, 5);
    expect(creatureTelegraph("monster.cinder_warden.v1", "slam")!.groundS).toBe(0);
    expect(creatureTelegraph("monster.blood_sentinel.v1", "slam2")).toBeNull();
  });

  it("offers each boss its own abilities and its last phase, and nobody else either", () => {
    for (const [id, def] of MONSTERS) {
      const actions = creatureActions(id);
      for (const a of def.boss?.abilities ?? []) expect(actions, id).toContain(`ability:${a.id}`);
      expect(actions.filter((a) => a.startsWith("ability:")).length, id).toBe(def.boss?.abilities?.length ?? 0);
      expect(actions.includes("phase3"), id).toBe(def.boss?.phase3AtLifePct !== undefined);
    }
    expect(abilityLabel("magma_rift")).toBe("Magma Rift");
  });

  it("plays a heavy as the sim casts it: one rooted mark from the boss toward the player", () => {
    const rift = bossTell("monster.cinder_warden.v1", "magma_rift")!;
    expect(rift.heavy).toBe(true);
    expect(rift.marks).toHaveLength(1);
    expect(rift.marks[0]!.landS).toBeCloseTo(1, 5);
    expect(rift.marks[0]!.mark).toMatchObject({ x: 0, y: 0, shape: "line", dirX: 0, dirY: 1, length: 9, radius: 0.9, heavy: true });
    // Ghaltrek's lane runs 2 past the player (5 out) and he dashes it at 14 a second.
    const charge = bossTell("monster.ghaltrek.v1", "bramble_charge")!;
    expect(charge.marks[0]!.mark.length).toBeCloseTo(7, 5);
    expect(charge.dashSpeed).toBeCloseTo(14, 5);
    expect(bossTell("monster.sirrath.v1", "kiln_ring")!.marks[0]!.mark).toMatchObject({ shape: "ring", inner: 2.4, radius: 7 });
    expect(bossTell("monster.ghaltrek.v1", "briar_nova")!.marks[0]!.mark).toMatchObject({ x: 0, y: 0, radius: 3 });
  });

  it("drops Cinder Rain round the player all at once, landing one after another", () => {
    const rain = bossTell("monster.cinder_warden.v1", "cinder_rain")!;
    expect(rain.heavy).toBe(false);
    expect(rain.marks).toHaveLength(5);
    rain.marks.forEach((m, k) => {
      expect(m.showS).toBe(0);
      expect(m.landS).toBeCloseTo((36 + k * 5) / 30, 5);
      expect(Math.hypot(m.mark.x, m.mark.y - 5)).toBeLessThanOrEqual(1.6);
    });
    expect(rain.marks[0]!.mark).toMatchObject({ x: 0, y: 5, radius: 1.3 });
  });

  it("aims each lance and geyser as it shows, and raises the brood on the summon ring", () => {
    const lance = bossTell("monster.sirrath.v1", "sunlance")!;
    expect(lance.marks).toHaveLength(3);
    lance.marks.forEach((m, k) => {
      expect(m.showS).toBeCloseTo((k * 9) / 30, 5);
      expect(m.landS - m.showS).toBeCloseTo(27 / 30, 5);
      expect(m.mark).toMatchObject({ x: 0, y: 0, shape: "line", length: 12 });
      expect(Math.hypot(m.mark.dirX!, m.mark.dirY!)).toBeCloseTo(1, 5);
    });
    const geyser = bossTell("monster.mother_vhal.v1", "bog_geyser")!;
    expect(geyser.marks).toHaveLength(3);
    geyser.marks.forEach((m, k) => expect(m.showS).toBeCloseTo(k * 0.4, 5));
    const brood = bossTell("monster.mother_vhal.v1", "brood")!;
    expect(brood.marks.map((m) => [m.mark.x, m.mark.y])).toEqual([[2.5, 0], [-2.5, 0]]);
    expect(brood.marks.every((m) => m.mark.radius === 1 && m.mark.heavy === undefined)).toBe(true);
    expect(bossTell("monster.cinder_warden.v1", "brood")).toBeNull();
  });

  it("summons a boss's adds on the sim's ring, its count capped by the ring", () => {
    const s = bossSummon("monster.cinder_warden.v1")!;
    expect(s.addDefId).toBe("monster.cinder_imp.v1");
    expect(s.spots).toEqual([{ x: 2.5, z: 0 }, { x: -2.5, z: 0 }]);
    for (const [id, def] of MONSTERS) {
      if (!def.boss) { expect(bossSummon(id)).toBeNull(); continue; }
      expect(bossSummon(id)!.spots.length).toBe(Math.min(def.boss.phase2.addCount, 6));
    }
  });

  it("gives a shooter's attack its bolt, at its speed, size and reach", () => {
    const b = shooterBolt("monster.dune_spitter.v1")!;
    expect(b.speed).toBeCloseTo(9, 5);
    expect(b.radius).toBeCloseTo(0.22, 5);
    expect(b.range).toBeCloseTo(5, 5);
    expect(shooterBolt("monster.vaal_construct.v1")).toBeNull();
  });

  it("reads a brute's charge in seconds and units: 0.6s rooted, 5.4/s, halfway through its 3..7 reach", () => {
    const tg = creatureTelegraph("monster.vaal_construct.v1", "charge")!;
    expect(tg.windupS).toBeCloseTo(0.6, 5);
    expect(tg.speed).toBeCloseTo(5.4, 5);
    expect(tg.distance).toBeCloseTo(5, 5);
    expect(tg.radius).toBeCloseTo(1.1, 5);
    expect(tg.durationS).toBeCloseTo(0.6 + 5 / 5.4, 5);
  });

  it("reads a trash heavy's slam and a boss's slam off their own specs", () => {
    const heavy = creatureTelegraph("monster.blood_sentinel.v1", "slam")!;
    expect(heavy.windupS).toBeCloseTo(1, 5);
    expect(heavy.radius).toBeCloseTo(2.6, 5);
    expect(heavy.durationS).toBeCloseTo(1, 5);
    const boss = creatureTelegraph("monster.cinder_warden.v1", "slam")!;
    expect(boss.radius).toBeCloseTo(3.5, 5);
    expect(boss.windupS).toBeCloseTo(1, 5);
    expect(creatureTelegraph("monster.vaal_husk.v1", "slam")).toBeNull();
    expect(creatureTelegraph("monster.blood_sentinel.v1", "charge")).toBeNull();
  });

  it("roots the brute through the wind-up, then runs it to the landing point at its speed", () => {
    const tg = creatureTelegraph("monster.vaal_construct.v1", "charge")!;
    expect(telegraphFrame(tg, 0)).toEqual({ progress: 0, travelled: 0, done: false });
    expect(telegraphFrame(tg, 0.5).travelled).toBe(0);
    expect(telegraphFrame(tg, 0.6 + 0.5).travelled).toBeCloseTo(2.7, 5);
    expect(telegraphFrame(tg, 0.6 + 0.5).progress).toBeCloseTo(1.1 / tg.durationS, 5);
    expect(telegraphFrame(tg, 9)).toEqual({ progress: 1, travelled: 5, done: true });
  });

  it("never moves a slammer", () => {
    const tg = creatureTelegraph("monster.cinder_warden.v1", "slam")!;
    expect(telegraphFrame(tg, 0.5)).toEqual({ progress: 0.5, travelled: 0, done: false });
    expect(telegraphFrame(tg, 1).done).toBe(true);
  });
});

describe("raw library clips", () => {
  it("labels a take without the exporter's prefix", () => {
    expect(rawClipLabel("Rig|Dance_Loop")).toBe("Dance Loop");
  });

  it("finds takes in the library the game never plays", () => {
    const names = (glbJson("../../public/models/anim-library.glb").animations ?? []).map((a) => a.name ?? "");
    const used = new Set(Object.values(CLIP_NAME));
    expect(names.filter((n) => !used.has(n)).length).toBeGreaterThan(0);
  });
});
