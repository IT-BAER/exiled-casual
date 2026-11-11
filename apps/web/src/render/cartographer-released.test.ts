import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach, vi } from "vitest";
import { Mesh, NullEngine, PBRMaterial, type Material, type StandardMaterial } from "@babylonjs/core";

// A release: Maren's new look is not signed off, so the game keeps the one v0.7.8 shipped.
vi.mock("../preview", async (importOriginal) => {
  const real = await importOriginal<typeof import("../preview")>();
  return { ...real, PREVIEW_MAREN: false, FEMALE_WARDROBE: real.femaleWardrobe(false) };
});

const { createScene } = await import("./engine");
const { makeMesh, RELEASED_CARTOGRAPHER_LOOKS, RELEASED_CARTOGRAPHER_HAIR, RELEASED_CARTOGRAPHER_SLIPPERS } = await import("./meshes");
const { hiddenBaseParts, loadPlayerRig, resetPlayerRig, rigOf, BASE_LOOKS, NO_LOOKS, SLOTS } = await import("./rig");
const { GEAR_LOOKS } = await import("./gear-looks");
const { MENU_STAGE_MODELS } = await import("../menu/warm-stage");
const { modelUrl } = await import("./model-url");

/** Babylon reads a File through FileReader, which node does not ship. */
class NodeFileReader {
  result: unknown;
  error: unknown;
  onload?: (e: { target: NodeFileReader }) => void;
  onerror?: (e: { target: NodeFileReader }) => void;
  onloadend?: (e: { target: NodeFileReader }) => void;
  abort(): void {}
  readAsArrayBuffer(blob: Blob): void { this.finish(blob.arrayBuffer()); }
  readAsText(blob: Blob): void { this.finish(blob.text()); }
  private finish(promise: Promise<unknown>): void {
    promise.then((result) => {
      this.result = result;
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    }).catch((error: unknown) => {
      this.error = error;
      this.onerror?.({ target: this });
      this.onloadend?.({ target: this });
    });
  }
}

const MODELS = fileURLToPath(new URL("../../public/models/", import.meta.url));
const RELEASED = "wardrobe-female-released.glb";
const file = (name: string) => new File([readFileSync(`${MODELS}${name}`)], name, { type: "model/gltf-binary" });
const albedo = (m: Material | null): [number, number, number] => {
  const c = m instanceof PBRMaterial ? m.albedoColor : (m as StandardMaterial).diffuseColor;
  return [c.r, c.g, c.b];
};

let engine: InstanceType<typeof NullEngine> | null = null;
afterEach(() => { engine?.dispose(); engine = null; });

describe("Maren in a release", () => {
  it("is fetched by the menu and the game as the same released female wardrobe", () => {
    expect(MENU_STAGE_MODELS).toContain(modelUrl(`/models/${RELEASED}`));
    expect(MENU_STAGE_MODELS).not.toContain(modelUrl("/models/wardrobe-female.glb"));
  });

  it("is the released wardrobe, carrying every look a release asks for and none of her new pieces", () => {
    const glb = readFileSync(`${MODELS}${RELEASED}`);
    const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8")) as { nodes: { name: string; skin?: number }[] };
    const skinned = json.nodes.filter((n) => n.skin !== undefined).map((n) => n.name);
    const gear = Object.values(GEAR_LOOKS).map(({ slot, look }) => ({ ...NO_LOOKS, [slot]: look }));
    for (const looks of [{ ...BASE_LOOKS, base: "female" }, NO_LOOKS, RELEASED_CARTOGRAPHER_LOOKS, ...gear]) {
      for (const slot of SLOTS) {
        const look = looks[slot];
        if (look === null) continue;
        expect(skinned.some((n) => n.startsWith(`${slot}.${look}.`)), `${RELEASED} has no ${slot}.${look}.*`).toBe(true);
      }
    }
    for (const piece of ["helmet.maren.face", "helmet.maren.scalp", "chest.maren.lace"]) {
      expect(skinned.some((n) => n.startsWith(piece)), piece).toBe(false);
    }
  });

  it("hides only what each slot covers, so the pack's own head stays drawn under her old hair", () => {
    const hidden = hiddenBaseParts(RELEASED_CARTOGRAPHER_LOOKS);
    for (const part of ["hair", "torso", "collar", "leg_l", "leg_r"]) expect(hidden.has(part), part).toBe(true);
    for (const part of ["body", "eyes", "brows", "neck"]) expect(hidden.has(part), part).toBe(false);
  });

  it("wears the v0.7.8 look: her gown and hair over the pack's head, red brows, dark Ember slippers", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    try {
      engine = new NullEngine();
      const { scene } = createScene(engine);
      await loadPlayerRig(scene, ["female"], { anims: file("anim-library.glb"), wardrobes: { female: file(RELEASED) } });
      const shared = new Set(scene.materials);
      const root = makeMesh(scene, "cartographer", "maren");
      expect(rigOf(root)!.currentLooks).toMatchObject({ base: "female", helmet: "maren", chest: "maren", boots: "ember" });
      const part = (m: { name: string }) => m.name.split(".").slice(0, 3).join(".");
      const shown = (name: string) => root.getChildMeshes().filter((m) => part(m) === name && m.isEnabled());
      for (const name of ["helmet.maren.tresses", "chest.maren.gown", "base.female.body", "base.female.eyes", "base.female.brows"]) {
        expect(shown(name).length, name).toBeGreaterThan(0);
      }
      expect(shown("base.female.hair").length).toBe(0);
      for (const m of shown("base.female.brows")) {
        expect(shared.has(m.material!)).toBe(false);
        expect(albedo(m.material)).toEqual(RELEASED_CARTOGRAPHER_HAIR.asArray());
      }
      const slippers = root.getChildMeshes().filter((m) => m.name.startsWith("boots.") && m.isEnabled());
      expect(slippers.length).toBeGreaterThan(0);
      for (const m of slippers) {
        expect(m.name.startsWith("boots.ember.")).toBe(true);
        expect(albedo(m.material)).toEqual(RELEASED_CARTOGRAPHER_SLIPPERS.asArray());
      }
      // A second body on the same wardrobe keeps the pack's own skin.
      const her = new Mesh("other", scene);
      (await import("./rig")).attachRig(scene, her, "female")!;
      const hands = her.getChildMeshes().filter((m) => m.name.startsWith("base.female.hand_") && m.isEnabled());
      for (const m of hands) expect(albedo(m.material)).toEqual([1, 1, 1]);
    } finally {
      (globalThis as { FileReader?: unknown }).FileReader = original;
      resetPlayerRig();
    }
  }, 60_000);
});
