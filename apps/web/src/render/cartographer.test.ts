import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach } from "vitest";
import {
  LoadAssetContainerAsync, Material, Mesh, NullEngine, PBRMaterial, StandardMaterial,
  type AnimationGroup, type Node, type Quaternion,
} from "@babylonjs/core";
import { createScene } from "./engine";
import { makeMesh, CARTOGRAPHER_BOOTS, CARTOGRAPHER_SKIN } from "./meshes";
import { attachRig, loadPlayerRig, resetPlayerRig, rigOf } from "./rig";

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

  it("is the female body in her own gown, long hair and face, the pack's head and buns hidden with their brows and eyes", async () => {
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
      // Her long hair, her face and her gown are drawn; the pack's buns are hidden under the helmet slot.
      for (const name of ["helmet.maren.face", "helmet.maren.tresses", "helmet.maren.scalp", "chest.maren.gown"]) {
        expect(shown(name).length, name).toBeGreaterThan(0);
        for (const m of shown(name)) expect(m.isEnabled(), name).toBe(true);
      }
      // Her hair is strand cards: cut out by alpha test (blending would sort card against card), seen from both sides.
      for (const m of shown("helmet.maren.tresses")) {
        const mat = m.material as PBRMaterial;
        expect(mat.transparencyMode).toBe(Material.MATERIAL_ALPHATEST);
        expect(mat.alphaCutOff).toBeCloseTo(0.3);
        expect(mat.backFaceCulling).toBe(false);
      }
      // Her face piece carries its own brows, eyes and neck: the pack's would stand through it.
      for (const name of ["hair", "body", "brows", "eyes", "neck"]) {
        expect(shown(`base.female.${name}`).length, name).toBeGreaterThan(0);
        for (const m of shown(`base.female.${name}`)) expect(m.isEnabled(), name).toBe(false);
      }
      // Her knee boots are the Stalker's, near-black on clones of their own, so the player's stay tan.
      const boots = root.getChildMeshes().filter((m) => m.name.startsWith("boots.") && m.isEnabled());
      expect(boots.length).toBeGreaterThan(0);
      for (const m of boots) {
        expect(m.name.startsWith("boots.stalker.")).toBe(true);
        expect(shared.has(m.material!)).toBe(false);
        expect(albedo(m.material)[0]).toBeCloseTo(CARTOGRAPHER_BOOTS.r);
      }
      // Her bare hands lie beside a face paler than the pack's skin: they take its tone, on clones of their own.
      const skin = (of: Mesh) => of.getChildMeshes().filter((m) => m.name.startsWith("base.female.hand_") && m.isEnabled());
      expect(skin(root).length).toBeGreaterThan(0);
      for (const m of skin(root)) {
        expect(shared.has(m.material!)).toBe(false);
        expect(albedo(m.material)).toEqual(CARTOGRAPHER_SKIN.asArray());
      }
      // A second body on the same wardrobe keeps the pack's own brown hair and its own skin.
      const her = new Mesh("other", scene);
      const plain = (await import("./rig")).attachRig(scene, her, "female")!;
      plain.setLooks({ base: "female", helmet: null, chest: null, boots: null, gloves: null, weapon1: null, weapon2: null });
      const otherHair = her.getChildMeshes().filter((m) => m.name.split(".")[2] === "hair");
      for (const m of otherHair) expect(albedo(m.material)[0]).toBeLessThan(0.4);
      expect(skin(her).length).toBeGreaterThan(0);
      for (const m of skin(her)) expect(albedo(m.material)).toEqual([1, 1, 1]);
    } finally {
      (globalThis as { FileReader?: unknown }).FileReader = original;
      resetPlayerRig();
    }
  }, 60_000);

  it("stands on the talking idle, where her hands never sink into her thighs, while another body keeps the plain idle", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    try {
      engine = new NullEngine();
      const { scene } = createScene(engine);
      await loadPlayerRig(scene, ["female"], { anims: file("anim-library.glb"), wardrobes: { female: file("wardrobe-female.glb") } });
      const library = await LoadAssetContainerAsync(file("anim-library.glb"), scene);
      const take = (name: string) => library.animationGroups.find((g) => g.name === name);
      const forearm = (g: AnimationGroup) => g.targetedAnimations
        .find((t) => (t.target as Node).name === "lowerarm_r" && t.animation.targetProperty === "rotationQuaternion")!
        .animation.getKeys().map((k) => (k.value as Quaternion).asArray());
      // What the rig under `root` is playing on its right forearm.
      const playedBy = (root: Mesh) => {
        const mine = new Set(root.getDescendants(false));
        const playing = scene.animationGroups.filter((g) => g.isPlaying
          && g.targetedAnimations.some((t) => mine.has(t.target as Node) && (t.target as Node).name === "lowerarm_r"));
        expect(playing.length).toBe(1);
        return forearm(playing[0]!);
      };
      expect(take("Rig|Idle_Talking_Loop")).toBeDefined();
      expect(playedBy(makeMesh(scene, "cartographer", "maren"))).toEqual(forearm(take("Rig|Idle_Talking_Loop")!));
      const other = new Mesh("other", scene);
      attachRig(scene, other, "female")!.setLocomotion(0);
      expect(playedBy(other)).toEqual(forearm(take("Rig|Idle_Loop")!));
    } finally {
      (globalThis as { FileReader?: unknown }).FileReader = original;
      resetPlayerRig();
    }
  }, 60_000);

  it("wears sheer lace over her own drawn arms and legs, alpha-blended and single-sided, with opaque cuffs at the wrists", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    try {
      engine = new NullEngine();
      const { scene } = createScene(engine);
      await loadPlayerRig(scene, ["female"], { anims: file("anim-library.glb"), wardrobes: { female: file("wardrobe-female.glb") } });
      const root = makeMesh(scene, "cartographer", "maren");
      const part = (m: { name: string }) => m.name.split(".").slice(0, 3).join(".");
      const shown = (name: string) => root.getChildMeshes().filter((m) => part(m) === name && m.isEnabled());
      const lace = shown("chest.maren.lace");
      expect(lace.length).toBeGreaterThan(0);
      for (const m of lace) {
        const mat = m.material as PBRMaterial;
        expect(mat.transparencyMode).toBe(Material.MATERIAL_ALPHABLEND);
        expect(mat.albedoTexture?.hasAlpha).toBe(true);
        expect(mat.backFaceCulling).toBe(true);
      }
      const cuffs = shown("chest.maren.cuffs");
      expect(cuffs.length).toBeGreaterThan(0);
      for (const m of cuffs) expect((m.material as PBRMaterial).transparencyMode ?? Material.MATERIAL_OPAQUE).toBe(Material.MATERIAL_OPAQUE);
      // The skin the lace is sheer over stays drawn.
      for (const name of ["arm_l", "arm_r", "leg_l", "leg_r"]) expect(shown(`base.female.${name}`).length, name).toBeGreaterThan(0);
    } finally {
      (globalThis as { FileReader?: unknown }).FileReader = original;
      resetPlayerRig();
    }
  }, 60_000);
});
