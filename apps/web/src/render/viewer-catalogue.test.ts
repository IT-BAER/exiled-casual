// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { CLASS_LIST } from "@exiled/content-runtime";
import { CLIP_NAME, gaitOf, SLOTS, type RigClip } from "./rig";
import { SPAWNABLE } from "./gallery";
import { looksFromPartNames } from "./viewer-scene";
import {
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
      expect(looks.base).toBe("male");
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
