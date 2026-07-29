import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NullEngine, Scene } from "@babylonjs/core";
import { CLASS_IDS } from "@exiled/rules";
import { CLASSES } from "@exiled/content-runtime";
import { COSMETIC_SLOTS, meshLook, resetPlayerRig } from "./rig";
import { floorScreenY, shadowReachScreenY } from "./menu-scene";
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

  /**
   * Where the soles land is a matter of pixels, and nothing else can see it: the
   * scene needs WebGL and the floor it stands on is a JPEG. Every knob that moves
   * the figure (camera height, distance, look-at, fov, the floor's own height)
   * moves it silently.
   *
   * The painted hall's floor runs from about 0.73 of the canvas down to the
   * bottom edge; its far edge is where it meets the throne's plinth. Above 0.73
   * is wall, and soles against a wall is exactly what floating looked like.
   */
  it("stands the character on the painted floor, not above its far edge", () => {
    const y = floorScreenY();
    expect(y).toBeGreaterThan(0.73);
    expect(y).toBeLessThan(0.82);
  });

  /**
   * The shadow starts at the soles and runs forward, so the failure left is the
   * one the eye cannot argue with: too short to see. The floor is nearly edge-on
   * at this camera, where world units buy very little canvas — three units of
   * ground is a twentieth of the frame — so the length has to be checked where it
   * is actually looked at, on screen, not in the scene.
   */
  it("throws the shadow far enough forward to clear the boots", () => {
    const reach = shadowReachScreenY() - floorScreenY();
    expect(reach).toBeGreaterThan(0.04); // forward, and past his own feet
    expect(reach).toBeLessThan(0.2); // still a shadow, not a runway
  });

  it("builds a scene without a wardrobe rather than throwing", async () => {
    // Headless there is no wardrobe to fetch, and the select screen has to
    // survive that: no figure, but a screen.
    engine = new NullEngine();
    const scene = new Scene(engine);
    expect(scene.isReady()).toBeDefined();
  });
});
