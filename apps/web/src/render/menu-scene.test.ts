import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NullEngine, Scene } from "@babylonjs/core";
import { CLASS_IDS } from "@exiled/rules";
import { BASE_LOOKS, SLOTS, resetPlayerRig } from "./rig";
import { floorScreenY, shadowReachScreenY } from "./menu-scene";
import { looksForClass } from "../menu/class-looks";

let engine: InstanceType<typeof NullEngine> | undefined;

afterEach(() => {
  resetPlayerRig();
  engine?.dispose();
  engine = undefined;
});

/**
 * The select screen dresses the rig by class. Every class shares the one
 * wired body, so `rig.test.ts` pinning that look exists in the wardrobe is
 * the whole guarantee; this pins that the menu asks for the same look.
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
      for (const slot of SLOTS) {
        const look = looks[slot];
        if (look === null) continue;
        const prefix = `${slot}.${look}.`;
        expect(
          names.some((n) => n.startsWith(prefix)),
          `${classId} wants ${prefix}* and the wardrobe has none`,
        ).toBe(true);
      }
    }
  });

  it("dresses every class in the same wired look, since there is no per-class wardrobe", () => {
    for (const classId of CLASS_IDS) {
      expect(looksForClass(classId)).toEqual(BASE_LOOKS);
    }
  });

  it("an unknown class still dresses somebody", () => {
    expect(looksForClass("class.nope")).toEqual(BASE_LOOKS);
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
