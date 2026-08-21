// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { BASE_LOOKS, CLIP_NAME, SLOTS, type RigClip } from "./rig";
import { SPAWNABLE } from "./gallery";
import {
  VIEWER_CLIPS,
  VIEWER_SUBJECTS,
  CHARACTER_SUBJECT,
  dressedFromVocabulary,
  looksFromPartNames,
} from "./viewer-scene";

/** Every `slot.look.part` name the wardrobe actually ships. */
const PART_NAMES = (() => {
  const glb = readFileSync(
    fileURLToPath(new URL("../../public/models/wardrobe.glb", import.meta.url)),
  );
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8")) as {
    meshes?: { name?: string }[];
    nodes?: { name?: string }[];
  };
  return [...(json.meshes ?? []), ...(json.nodes ?? [])]
    .map((n) => n.name ?? "")
    .filter((n) => n.length > 0);
})();

describe("viewer subjects", () => {
  it("offers the character plus every prop and creature the gallery knows", () => {
    expect(VIEWER_SUBJECTS[0]).toBe(CHARACTER_SUBJECT);
    for (const s of SPAWNABLE) {
      expect(VIEWER_SUBJECTS.some((v) => v.id === s.id)).toBe(true);
    }
  });

  it("gives every subject a distinct id", () => {
    const ids = VIEWER_SUBJECTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("viewer clips", () => {
  it("binds each hotkey to a clip the rig actually has", () => {
    for (const entry of VIEWER_CLIPS) {
      expect(Object.keys(CLIP_NAME)).toContain(entry.clip satisfies RigClip);
    }
  });

  it("uses distinct digit keys", () => {
    const keys = VIEWER_CLIPS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[0-9]$/);
  });
});

describe("opening look", () => {
  /**
   * The body is the wired one and the gear is whatever ships. A workshop screen
   * that opened on the bare body would hide every piece it exists to show, and
   * an unwired FEMALE body picked the same way would show a body the game never
   * draws - hence the two rules rather than one.
   */
  it("opens on the wired body wearing the gear the wardrobe ships", () => {
    const vocab = looksFromPartNames(PART_NAMES);
    const looks = dressedFromVocabulary(vocab);
    expect(looks.base).toBe(BASE_LOOKS.base);
    for (const slot of ["helmet", "weapon1", "weapon2"] as const) {
      expect(vocab[slot], `wardrobe ships no ${slot}`).toBeDefined();
      expect(looks[slot]).toBe(vocab[slot]![0]);
    }
  });

  it("leaves a slot the wardrobe has nothing for empty", () => {
    expect(dressedFromVocabulary({ base: ["female"] }).base).toBeNull();
  });

  it("picks a look that exists in that slot", () => {
    const vocab = looksFromPartNames(PART_NAMES);
    const looks = dressedFromVocabulary(vocab);
    for (const slot of SLOTS) {
      const look = looks[slot];
      if (look === null) continue;
      expect(vocab[slot]).toContain(look);
    }
  });
});

describe("look vocabulary", () => {
  it("reads the wardrobe's own part names, not a hand-typed list", () => {
    const bySlot = looksFromPartNames(PART_NAMES);
    expect(bySlot.base?.length ?? 0).toBeGreaterThan(0);
  });

  it("finds both bodies the wardrobe ships", () => {
    const bySlot = looksFromPartNames(PART_NAMES);
    expect(bySlot.base).toContain("male");
    expect(bySlot.base).toContain("female");
  });

  it("keeps a look once however many parts carry it", () => {
    const bySlot = looksFromPartNames(["base.male.body", "base.male.hair", "base.female.body"]);
    expect(bySlot.base).toEqual(["male", "female"]);
  });
});
