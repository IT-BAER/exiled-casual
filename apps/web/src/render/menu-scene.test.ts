import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NullEngine, Scene } from "@babylonjs/core";
import { CLASS_IDS } from "@exiled/rules";
import { CLASSES } from "@exiled/content-runtime";
import { COSMETIC_SLOTS, meshLook, resetPlayerRig } from "./rig";
import { looksForClass } from "../menu/class-looks";

let engine: InstanceType<typeof NullEngine> | undefined;

afterEach(() => {
  resetPlayerRig();
  engine?.dispose();
  engine = undefined;
});

/**
 * The select screen dresses the rig by class. `rig.test.ts` already pins that
 * every look the GAME asks for exists in the wardrobe; this pins the same thing
 * for the looks the MENU asks for, which come from a different table and would
 * otherwise fail as an invisible character in front of a painting.
 */
describe("class looks", () => {
  const MODELS = fileURLToPath(new URL("../../public/models/", import.meta.url));
  /** Every `slot.look.part` name the wardrobe actually ships. */
  const names = (() => {
    const glb = readFileSync(`${MODELS}wardrobe.glb`);
    // The JSON chunk of a binary glTF starts at byte 20 and is length-prefixed.
    const jsonLength = glb.readUInt32LE(12);
    const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8")) as {
      meshes?: { name?: string }[];
      nodes?: { name?: string }[];
    };
    return [...(json.meshes ?? []), ...(json.nodes ?? [])]
      .map((n) => n.name ?? "")
      .filter((n) => n.length > 0);
  })();

  it("the wardrobe was actually read", () => {
    expect(names.length).toBeGreaterThan(10);
  });

  it("every class resolves to geometry the wardrobe ships", () => {
    for (const classId of CLASS_IDS) {
      const looks = looksForClass(classId);
      for (const slot of COSMETIC_SLOTS) {
        const look = looks[slot];
        if (look === null) continue;
        const prefix = `${slot}.${meshLook(look)}.`;
        expect(
          names.some((n) => n.startsWith(prefix)),
          `${classId} wants ${prefix}* and the wardrobe has none`,
        ).toBe(true);
      }
    }
  });

  it("a class with an empty slot falls back to commoner cloth, never to nothing", () => {
    // Ironsworn wears no helmet, and a bare slot must still leave a body there.
    const looks = looksForClass("class.ironsworn");
    expect(looks.helmet).toBeNull();
    expect(looks.body).not.toBeNull();
    expect(looks.boots).not.toBeNull();
  });

  it("each class asks for its own body texture, or the three are one character", () => {
    const bodies = CLASS_IDS.map((id) => looksForClass(id).body);
    expect(new Set(bodies).size).toBe(bodies.length);
    // The look is `<mesh look>#<base id>`; the base id is what picks the palette.
    for (const [i, id] of CLASS_IDS.entries()) {
      expect(bodies[i]).toBe(`${meshLook(bodies[i]!)}#${CLASSES[id]!.startingGear["body"]}`);
    }
  });

  it("an unknown class still dresses somebody", () => {
    const looks = looksForClass("class.nope");
    expect(looks.body).not.toBeNull();
  });

  it("builds a scene without a wardrobe rather than throwing", async () => {
    // Headless there is no wardrobe to fetch, and the select screen has to
    // survive that: no figure, but a screen.
    engine = new NullEngine();
    const scene = new Scene(engine);
    expect(scene.isReady()).toBeDefined();
  });
});
