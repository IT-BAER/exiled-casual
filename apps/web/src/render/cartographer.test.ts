import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  FreeCamera, LoadAssetContainerAsync, Material, Mesh, NullEngine, PBRMaterial, Quaternion, StandardMaterial,
  TransformNode, Vector3, type AnimationGroup, type Node,
} from "@babylonjs/core";
import { createScene } from "./engine";
import { makeMesh, CARTOGRAPHER_BOOTS, CARTOGRAPHER_IDLE, CARTOGRAPHER_SKIN } from "./meshes";
import { attachRig, loadPlayerRig, resetPlayerRig, rigOf } from "./rig";
import { SnapshotRenderer } from "./renderer";
import type { Snapshot } from "@exiled/protocol";
import { testStats } from "../test-fixtures";

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

  it("stands on her own clasped-hands idle, keyed like the plain idle, while another body keeps the plain idle", async () => {
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
      expect(CARTOGRAPHER_IDLE).toBe("Rig|Idle_Lady_Loop");
      const lady = take("Rig|Idle_Lady_Loop");
      expect(lady).toBeDefined();
      // The same 49 bones Idle_Loop keys on the 65-joint skeleton, its breathing pelvis with them.
      const keyed = (g: AnimationGroup, property: string) => g.targetedAnimations
        .filter((t) => t.animation.targetProperty === property).map((t) => (t.target as Node).name).sort();
      expect(keyed(lady!, "rotationQuaternion")).toEqual(keyed(take("Rig|Idle_Loop")!, "rotationQuaternion"));
      expect(keyed(lady!, "rotationQuaternion").length).toBe(49);
      expect(keyed(lady!, "position")).toEqual(["pelvis"]);
      expect(library.skeletons[0]!.bones.length).toBe(65);
      expect(playedBy(makeMesh(scene, "cartographer", "maren"))).toEqual(forearm(lady!));
      const other = new Mesh("other", scene);
      attachRig(scene, other, "female")!.setLocomotion(0);
      expect(playedBy(other)).toEqual(forearm(take("Rig|Idle_Loop")!));
    } finally {
      (globalThis as { FileReader?: unknown }).FileReader = original;
      resetPlayerRig();
    }
  }, 60_000);

  /**
   * Depth of each hand's skinned vertices behind the nearest face (within 3 cm) of what she wears and
   * of the other hand, over a whole loop with her cloth solving. A sleeve encloses its own wrist by
   * design, so lace and cuffs are scored without the faces skinned to that hand's own arm.
   */
  it("keeps her folded hands out of her gown, lace, cuffs, legs and each other over a whole breath, her skirt calm", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    try {
      engine = new NullEngine();
      engine.getDeltaTime = () => 16;
      const { scene } = createScene(engine);
      scene.useConstantAnimationDeltaTime = true;
      new FreeCamera("eye", new Vector3(0, 2, -6), scene);
      await loadPlayerRig(scene, ["female"], { anims: file("anim-library.glb"), wardrobes: { female: file("wardrobe-female.glb") } });
      const root = makeMesh(scene, "cartographer", "maren");
      const rig = rigOf(root)!;
      const frame = () => { rig.setLocomotion(0); scene.render(); };
      for (let i = 0; i < 60; i++) frame();

      const part = (m: { name: string }) => m.name.split(".").slice(0, 3).join(".");
      const meshes = (name: string) => root.getChildMeshes().filter((m): m is Mesh => m instanceof Mesh && part(m) === name && m.isEnabled());
      const SLEEVES = ["chest.maren.lace", "chest.maren.cuffs"];
      const OBSTACLES = ["chest.maren.gown", "chest.maren.backing", "chest.maren.gorget", ...SLEEVES,
        "base.female.leg_l", "base.female.leg_r", "base.female.torso"];
      const ARM = /^(clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)_/;
      /** World-space triangles of `name`, each with its outward unit normal, less those skinned to `skip`'s arm. */
      const triangles = (name: string, skip?: "l" | "r") => {
        const out: { a: Vector3; b: Vector3; c: Vector3; n: Vector3 }[] = [];
        for (const m of meshes(name)) {
          const p = m.getPositionData(true, true)!;
          const idx = m.getIndices()!;
          const w = m.getWorldMatrix();
          const flip = w.determinant() < 0 ? -1 : 1;
          const at = (i: number) => Vector3.TransformCoordinatesFromFloatsToRef(p[3 * i]!, p[3 * i + 1]!, p[3 * i + 2]!, w, new Vector3());
          const bones = m.skeleton?.bones ?? [];
          const bi = m.getVerticesData("matricesIndices"), bw = m.getVerticesData("matricesWeights");
          const own = (i: number) => {
            if (!skip || !bi || !bw) return false;
            let best = 0;
            for (let k = 1; k < 4; k++) if (bw[4 * i + k]! > bw[4 * i + best]!) best = k;
            const bone = bones[bi[4 * i + best]!]?.name ?? "";
            return ARM.test(bone) && bone.endsWith(`_${skip}`);
          };
          for (let t = 0; t < idx.length; t += 3) {
            const [i, j, k] = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
            if ((own(i) ? 1 : 0) + (own(j) ? 1 : 0) + (own(k) ? 1 : 0) >= 2) continue;
            const a = at(i), b = at(j), c = at(k);
            const n = Vector3.Cross(b.subtract(a), c.subtract(a));
            if (n.lengthSquared() < 1e-14) continue;
            out.push({ a, b, c, n: n.normalize().scaleInPlace(flip) });
          }
        }
        return out;
      };
      const points = (name: string) => meshes(name).flatMap((m) => {
        const p = m.getPositionData(true, true)!;
        const out: Vector3[] = [];
        for (let i = 0; i < p.length; i += 3) out.push(Vector3.TransformCoordinatesFromFloatsToRef(p[i]!, p[i + 1]!, p[i + 2]!, m.getWorldMatrix(), new Vector3()));
        return out;
      });
      /** Closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5). */
      const closest = (p: Vector3, a: Vector3, b: Vector3, c: Vector3): Vector3 => {
        const ab = b.subtract(a), ac = c.subtract(a), ap = p.subtract(a);
        const d1 = Vector3.Dot(ab, ap), d2 = Vector3.Dot(ac, ap);
        if (d1 <= 0 && d2 <= 0) return a;
        const bp = p.subtract(b), d3 = Vector3.Dot(ab, bp), d4 = Vector3.Dot(ac, bp);
        if (d3 >= 0 && d4 <= d3) return b;
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) return a.add(ab.scale(d1 / (d1 - d3)));
        const cp = p.subtract(c), d5 = Vector3.Dot(ab, cp), d6 = Vector3.Dot(ac, cp);
        if (d6 >= 0 && d5 <= d6) return c;
        const vb = d5 * d2 - d1 * d6;
        if (vb <= 0 && d2 >= 0 && d6 <= 0) return a.add(ac.scale(d2 / (d2 - d6)));
        const va = d3 * d6 - d5 * d4;
        if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return b.add(c.subtract(b).scale((d4 - d3) / (d4 - d3 + (d5 - d6))));
        const denom = 1 / (va + vb + vc);
        return a.add(ab.scale(vb * denom)).add(ac.scale(vc * denom));
      };
      /** Deepest hand vertex behind its nearest face, metres. */
      const depth = (hand: Vector3[], tris: ReturnType<typeof triangles>) => {
        const lo = hand.reduce((m, p) => Vector3.Minimize(m, p), hand[0]!).subtractFromFloats(0.03, 0.03, 0.03);
        const hi = hand.reduce((m, p) => Vector3.Maximize(m, p), hand[0]!).addInPlaceFromFloats(0.03, 0.03, 0.03);
        const near = tris.filter(({ a, b, c }) => [0, 1, 2].every((ax) => {
          const v = [a, b, c].map((q) => q.asArray()[ax]!);
          return Math.max(...v) >= lo.asArray()[ax]! && Math.min(...v) <= hi.asArray()[ax]!;
        }));
        let worst = 0;
        for (const p of hand) {
          let best = 0.03, inside = 0;
          for (const { a, b, c, n } of near) {
            const q = closest(p, a, b, c);
            const d = Vector3.Distance(p, q);
            if (d < best) { best = d; inside = Vector3.Dot(q.subtract(p), n); }
          }
          worst = Math.max(worst, inside);
        }
        return worst;
      };

      const skirt = scene.transformNodes.filter((n) => /^skirt_\d+_0[2-6]$/.test(n.name) && root.getDescendants(false).includes(n));
      expect(skirt.length).toBeGreaterThan(0);
      const start = skirt.map((n) => n.getAbsolutePosition().clone());
      let swing = 0;
      const worst: Record<string, number> = {};
      // The loop is 2.5 s: 160 frames of 16 ms cover it whole.
      for (let f = 0; f < 160; f++) {
        frame();
        skirt.forEach((n, k) => { swing = Math.max(swing, Vector3.Distance(n.getAbsolutePosition(), start[k]!)); });
        if (f % 16) continue;
        for (const side of ["l", "r"] as const) {
          const hand = points(`base.female.hand_${side}`);
          const other = `base.female.hand_${side === "l" ? "r" : "l"}`;
          for (const name of [...OBSTACLES, other]) {
            const mm = depth(hand, triangles(name, SLEEVES.includes(name) ? side : undefined)) * 1000;
            const key = `hand_${side} in ${name}`;
            worst[key] = Math.max(worst[key] ?? 0, Math.round(mm * 10) / 10);
          }
        }
      }
      // Idle_Loop measures 26 mm into her thighs; a hand resting on cloth reads within 2 mm.
      for (const mm of Object.values(worst)) expect(mm, JSON.stringify(worst)).toBeLessThanOrEqual(2);
      // Her floor-length hem travels 6.0 cm over a breath on the talking idle she stood on before, 5.7 on this one.
      expect(swing, "skirt joint travel over a breath").toBeLessThan(0.06);
    } finally {
      (globalThis as { FileReader?: unknown }).FileReader = original;
      resetPlayerRig();
    }
  }, 180_000);

  it("turns her head toward the player beside her, never more than 40 degrees off her body", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    try {
      engine = new NullEngine();
      engine.getDeltaTime = () => 16;
      const { scene } = createScene(engine);
      scene.useConstantAnimationDeltaTime = true;
      await loadPlayerRig(scene, ["female"], { anims: file("anim-library.glb"), wardrobes: { female: file("wardrobe-female.glb") } });
      // Three of her facing the camera as the hideout stands her, the same idle frame for each.
      const stand = (x: number) => {
        const root = makeMesh(scene, "cartographer", `maren-${x}`);
        root.position.x = x;
        root.rotation.y = Math.PI;
        return { root, rig: rigOf(root)!, head: root.getDescendants(false).find((n) => n.name === "Head") as TransformNode };
      };
      const still = stand(0), near = stand(10), far = stand(20);
      // A player 1 unit to her left and 3 in front (18 degrees off), and one straight to her left.
      near.rig.setAimTarget(10 - 1, -3);
      far.rig.setAimTarget(20 - 4, 0);
      for (let i = 0; i < 40; i++) {
        for (const m of [still, near, far]) m.rig.setLocomotion(0);
        scene.render();
      }
      /** Her face's heading off the still one's, in degrees about world up; toward -x is positive. */
      const turned = (m: typeof still) => {
        const world = (n: TransformNode) => {
          const r = new Quaternion();
          n.computeWorldMatrix(true).decompose(undefined, r);
          return r;
        };
        const q = world(m.head).multiply(Quaternion.Inverse(world(still.head)));
        const face = new Vector3(0, 0, -1).rotateByQuaternionToRef(q, new Vector3());
        return (Math.atan2(-face.x, -face.z) * 180) / Math.PI;
      };
      expect(turned(near)).toBeGreaterThan(14);
      expect(turned(near)).toBeLessThan(22);
      expect(turned(far)).toBeGreaterThan(36);
      expect(turned(far)).toBeLessThan(42);
    } finally {
      (globalThis as { FileReader?: unknown }).FileReader = original;
      resetPlayerRig();
    }
  }, 60_000);

  it("watches the player: the renderer hands her rig his position every frame", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    try {
      engine = new NullEngine();
      const { scene } = createScene(engine);
      await loadPlayerRig(scene, ["female"], { anims: file("anim-library.glb"), wardrobes: { female: file("wardrobe-female.glb") } });
      const renderer = new SnapshotRenderer(scene);
      const snapshot = (x: number, y: number): Snapshot => ({
        tick: 1,
        player: {
          id: 0, x, y, life: 100, maxLife: 100, mana: 60, maxMana: 60, energyShield: 0, maxEnergyShield: 0,
          cooldowns: {}, alive: true, casting: false, level: 1, xp: 0, xpToNext: 100, gold: 0,
          flasks: { lifeCharges: 7, lifeMax: 7, manaCharges: 7, manaMax: 7 }, stats: testStats(),
        },
        area: "hideout", portalsLeft: 0, mapOpen: false, areaTier: 0, atlasSeed: 0, completedNodes: [],
        entities: [{ id: 9, kind: "cartographer", x: -4, y: 0, yaw: Math.PI, inRange: false }],
        inventory: { cols: 12, rows: 5, items: [] }, stash: { cols: 12, rows: 12, items: [] },
        vendor: { cols: 12, rows: 12, items: [] }, shards: {}, equipment: {},
      } as unknown as Snapshot);
      renderer.apply(null, snapshot(1, -2), 1);
      const her = rigOf(scene.getMeshByName("entity-9") as Mesh)!;
      expect(her).not.toBeNull();
      const aim = vi.spyOn(her, "setAimTarget");
      renderer.apply(snapshot(1, -2), snapshot(2, -3), 1);
      const him = scene.getMeshByName("entity-0")!;
      expect(aim).toHaveBeenLastCalledWith(him.position.x, him.position.z);
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
