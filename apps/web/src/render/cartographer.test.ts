import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach } from "vitest";
import { Mesh, NullEngine, PBRMaterial, StandardMaterial, type Material } from "@babylonjs/core";
import { createScene } from "./engine";
import { makeMesh, CARTOGRAPHER_HAIR } from "./meshes";
import { loadPlayerRig, resetPlayerRig, rigOf } from "./rig";

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
const file = (name: string) => new File([readFileSync(`${MODELS}${name}`)], name, { type: "model/gltf-binary" });
const albedo = (m: Material | null): [number, number, number] => {
  const c = m instanceof PBRMaterial ? m.albedoColor : (m as StandardMaterial).diffuseColor;
  return [c.r, c.g, c.b];
};

let engine: InstanceType<typeof NullEngine> | null = null;
afterEach(() => { engine?.dispose(); engine = null; });

describe("Maren's body", () => {
  it("stands headless as a pickable mark when no rig has loaded", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const root = makeMesh(scene, "cartographer", "maren");
    expect((root.metadata as { interactKind?: string }).interactKind).toBe("cartographer");
    expect(rigOf(root)).toBeNull();
  });

  it("is the female body in her own gown and long hair, the buns hidden, her brows red on her own material and nobody else's", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    try {
      engine = new NullEngine();
      const { scene } = createScene(engine);
      await loadPlayerRig(scene, ["female"], { anims: file("anim-library.glb"), wardrobes: { female: file("wardrobe-female.glb") } });
      const shared = new Set(scene.materials);
      const root = makeMesh(scene, "cartographer", "maren");
      const rig = rigOf(root)!;
      expect(rig.currentLooks).toMatchObject({ base: "female", helmet: "maren", chest: "maren" });
      const part = (m: { name: string }) => m.name.split(".").slice(0, 3).join(".");
      const shown = (name: string) => root.getChildMeshes().filter((m) => part(m) === name);
      // Her long hair and her gown are drawn; the pack's buns are hidden under the helmet slot.
      for (const name of ["helmet.maren.tresses", "chest.maren.gown"]) {
        expect(shown(name).length, name).toBeGreaterThan(0);
        for (const m of shown(name)) expect(m.isEnabled(), name).toBe(true);
      }
      for (const m of shown("base.female.hair")) expect(m.isEnabled()).toBe(false);
      const brows = shown("base.female.brows");
      expect(brows.length).toBeGreaterThan(0);
      for (const m of brows) {
        expect(m.isEnabled()).toBe(true);
        expect(shared.has(m.material!)).toBe(false);
        const [r, g, b] = albedo(m.material);
        expect(r).toBeCloseTo(CARTOGRAPHER_HAIR.r);
        expect(r).toBeGreaterThan(3 * Math.max(g, b));
      }
      // A second body on the same wardrobe keeps the pack's own brown.
      const her = new Mesh("other", scene);
      const plain = (await import("./rig")).attachRig(scene, her, "female")!;
      plain.setLooks({ base: "female", helmet: null, chest: null, boots: null, gloves: null, weapon1: null, weapon2: null });
      const otherHair = her.getChildMeshes().filter((m) => m.name.split(".")[2] === "hair");
      for (const m of otherHair) expect(albedo(m.material)[0]).toBeLessThan(0.4);
    } finally {
      (globalThis as { FileReader?: unknown }).FileReader = original;
      resetPlayerRig();
    }
  }, 60_000);
});
