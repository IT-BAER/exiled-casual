// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { COSMETIC_SLOTS, CLIP_NAME, type RigClip } from "./rig";
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

describe("opening outfit", () => {
  /**
   * The bug this pins: with every slot null the wardrobe leaves only the head
   * enabled, so a camera correctly framed on the whole body showed a head alone.
   */
  it("fills every slot the wardrobe ships geometry for", () => {
    const vocab = looksFromPartNames(PART_NAMES);
    const looks = dressedFromVocabulary(vocab);
    for (const slot of COSMETIC_SLOTS) {
      if ((vocab[slot]?.length ?? 0) === 0) continue;
      expect(looks[slot], `${slot} opened empty`).not.toBeNull();
    }
  });

  it("leaves a slot the wardrobe has nothing for empty", () => {
    expect(dressedFromVocabulary({ body: ["knight"] }).helmet).toBeNull();
  });

  it("picks looks that exist in that slot", () => {
    const vocab = looksFromPartNames(PART_NAMES);
    const looks = dressedFromVocabulary(vocab);
    for (const slot of COSMETIC_SLOTS) {
      const look = looks[slot];
      if (look === null) continue;
      expect(vocab[slot]).toContain(look);
    }
  });
});

describe("look vocabulary", () => {
  it("reads the wardrobe's own part names, not a hand-typed list", () => {
    const bySlot = looksFromPartNames(PART_NAMES);
    // The panel exists to swap gear: a slot the wardrobe ships geometry for must
    // arrive with at least one look, or its row is a dead heading.
    for (const slot of COSMETIC_SLOTS) {
      if (!PART_NAMES.some((n) => n.startsWith(`${slot}.`))) continue;
      expect(bySlot[slot]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("finds the armour silhouettes the wardrobe was just given", () => {
    // Six separately authored outfits, not one coat in three palettes.
    const bySlot = looksFromPartNames(PART_NAMES);
    for (const look of ["knight", "barbarian", "mage", "ranger", "rogue", "hooded"]) {
      expect(bySlot.body, look).toContain(look);
    }
  });

  it("keeps a look once however many parts carry it", () => {
    const bySlot = looksFromPartNames(["body.knight.torso", "body.knight.cape", "body.ranger.torso"]);
    expect(bySlot.body).toEqual(["knight", "ranger"]);
  });

  it("ignores the head, which is not a swappable look", () => {
    const bySlot = looksFromPartNames(["base.head.face", "body.knight.torso"]);
    expect(bySlot.base).toBeUndefined();
  });
});
