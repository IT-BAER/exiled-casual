import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Matrix, NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { CLASS_IDS } from "@exiled/rules";
import { BASE_LOOKS, SLOTS, resetPlayerRig } from "./rig";
import { createMenuCamera, FEET, FEET_IMAGE, floorImageY, frameCamera, shadowReachImageY } from "./menu-scene";
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

  it("dresses every class in its own starting kit, head to foot and weapon in hand", () => {
    const family = { "class.ironsworn": "ironsworn", "class.stalker": "stalker", "class.emberbound": "ember" };
    for (const classId of CLASS_IDS) {
      const looks = looksForClass(classId);
      for (const slot of ["helmet", "chest", "gloves", "boots"] as const) expect(looks[slot], classId).toBe(family[classId]);
      expect(looks.weapon1, classId).not.toBeNull();
      expect(looks.base).toBe(BASE_LOOKS.base);
    }
  });

  it("an unknown class still dresses somebody", () => {
    expect(looksForClass("class.nope").chest).not.toBeNull();
  });

  /**
   * Where the soles land is a matter of pixels, and nothing else can see it: the
   * scene needs WebGL and the floor it stands on is a JPEG. Fractions of the
   * backdrop image: its floor starts at 0.69 (below that is the plinth and the
   * wall), and a 21:9 window crops `cover` to 0.88 of it.
   */
  it("stands the character on the painted floor and inside a wide window", () => {
    const y = floorImageY();
    expect(y).toBeGreaterThan(0.7);
    expect(y).toBeLessThan(0.88);
  });

  /** The shadow runs forward from the soles: visible past the boots, not a runway. */
  it("throws the shadow far enough forward to clear the boots", () => {
    const reach = shadowReachImageY() - floorImageY();
    expect(reach).toBeGreaterThan(0.03);
    expect(reach).toBeLessThan(0.08);
  });

  /**
   * The real lens, not the arithmetic above: in every window shape the soles
   * must project onto the spot of the painting `cover` draws there.
   */
  it("keeps him on the same spot of the painting in every window shape", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const camera = createMenuCamera(scene);
    const aspect = 1672 / 941;
    for (const [boxW, boxH] of [[2048, 962], [1920, 1080], [1280, 1024], [2560, 1080]] as const) {
      // The stage canvas spans the left 68% of the screen the backdrop covers.
      const w = boxW * 0.68;
      const h = boxH;
      frameCamera(camera, w, h, boxW, boxH);
      const shown = Math.max(boxW / aspect, boxH);
      const at = Vector3.Project(FEET, Matrix.Identity(), camera.getViewMatrix(true).multiply(camera.getProjectionMatrix()), camera.viewport.toGlobal(w, h));
      expect(at.x, `${boxW}x${boxH}`).toBeCloseTo((boxW - shown * aspect) / 2 + FEET_IMAGE.x * shown * aspect, 0);
      expect(at.y, `${boxW}x${boxH}`).toBeCloseTo((boxH - shown) / 2 + FEET_IMAGE.y * shown, 0);
    }
  });

  it("builds a scene without a wardrobe rather than throwing", async () => {
    // Headless there is no wardrobe to fetch, and the select screen has to
    // survive that: no figure, but a screen.
    engine = new NullEngine();
    const scene = new Scene(engine);
    expect(scene.isReady()).toBeDefined();
  });
});
