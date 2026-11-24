import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { LoadAssetContainerAsync, NullEngine, TransformNode, Vector3 } from "@babylonjs/core";
import { createScene } from "./engine";
import { indexRigSubtree, ORIGINAL_DIRECTIONS } from "./rig";
import { createMovementClips } from "./movement-clips";
import { captureBind, poseFrame, POSE_JOINTS, targetJoints, takeOf, type PoseClip } from "./retarget";

const MODELS = fileURLToPath(new URL("../../public/models/", import.meta.url));

class NodeFileReader {
  result: unknown;
  onload?: (e: { target: NodeFileReader }) => void;
  onloadend?: (e: { target: NodeFileReader }) => void;
  abort(): void {}
  readAsArrayBuffer(blob: Blob): void { void blob.arrayBuffer().then((r) => this.done(r)); }
  readAsText(blob: Blob): void { void blob.text().then((r) => this.done(r)); }
  private done(result: unknown): void { this.result = result; this.onload?.({ target: this }); this.onloadend?.({ target: this }); }
}

async function body(file: string, root: string) {
  const engine = new NullEngine();
  const { scene } = createScene(engine);
  const container = await LoadAssetContainerAsync(new File([readFileSync(`${MODELS}${file}`)], file, { type: "model/gltf-binary" }), scene);
  const entries = container.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
  const pivot = new TransformNode("rig", scene);
  for (const node of entries.rootNodes) node.parent = pivot;
  return { engine, scene, pivot, byName: indexRigSubtree(entries.rootNodes, root) };
}

describe.each([
  { file: "wardrobe.glb", root: "Armature" },
  { file: "wardrobe-female.glb", root: "Armature_female" },
])("retarget on $file", ({ file, root }) => {
  it("puts every joint back where a take of the same body put it", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    const src = await body(file, root);
    const dst = await body(file, root);
    try {
      // The source take: our own run strafe, sampled and written out as a PoE2 dump would hold it.
      const spec = ORIGINAL_DIRECTIONS.run.find((d) => d.clip === "runStrafeR")!;
      const group = createMovementClips(src.scene, src.pivot, src.byName, [{ name: "take", gait: "run", ...spec }])!.get("take")!;
      const bind = captureBind(src.pivot, src.byName)!;
      const inv = src.pivot.getWorldMatrix().clone().invert();
      const at = (name: string) => Vector3.TransformCoordinates((src.byName.get(name) as TransformNode).computeWorldMatrix(true).getTranslation(), inv);
      const n = 24;
      const rows: number[][] = [];
      const truth: Record<string, Vector3>[] = [];
      for (let f = 0; f <= n; f++) {
        group.goToFrame(group.from + ((f % n) / n) * (group.to - group.from));
        src.scene.render();
        const pose = poseFrame(bind, at, (name) => (src.byName.get(name) as TransformNode).computeWorldMatrix(true).multiply(inv));
        truth.push(Object.fromEntries(POSE_JOINTS.map((j) => [j.poe, pose[j.poe]!.clone()])));
        // PoE2 axes: up -Z, forward -Y, left +X, centimetres.
        rows.push(POSE_JOINTS.flatMap((j) => { const p = pose[j.poe]!; return [p.dot(bind.left) * 100, -p.z * 100, -p.y * 100]; }));
      }
      const clip: PoseClip = { clip: "take", fps: 60, bones: POSE_JOINTS.map((j) => ({ name: j.poe, parent: -1 })), frames: rows };

      const dBind = captureBind(dst.pivot, dst.byName)!;
      const take = takeOf(clip, dBind);
      const dInv = dst.pivot.getWorldMatrix().clone().invert();
      const leg = dBind.leg;
      let worst = 0;
      for (let f = 0; f < n; f++) {
        take.apply(f);
        const want = targetJoints(dBind, take.frame(f));
        for (const j of POSE_JOINTS) {
          if (!j.ours) continue;
          const got = Vector3.TransformCoordinates((dst.byName.get(j.ours) as TransformNode).computeWorldMatrix(true).getTranslation(), dInv);
          // The bones reach the joints the reference figure draws.
          worst = Math.max(worst, Vector3.Distance(got, want[j.poe]!) / leg);
        }
      }
      expect(worst, "bones vs drawn reference").toBeLessThan(1e-3);
      // And the same body reproduces its own take, up to the phase the take starts on.
      const shift = take.shift;
      let back = 0;
      for (let f = 0; f < n; f++) {
        take.apply(f);
        const src0 = truth[(f + shift) % n]!;
        for (const j of POSE_JOINTS) {
          if (!j.ours) continue;
          const got = Vector3.TransformCoordinates((dst.byName.get(j.ours) as TransformNode).computeWorldMatrix(true).getTranslation(), dInv);
          back = Math.max(back, Vector3.Distance(got, src0[j.poe]!.add(take.offset)) / leg);
        }
      }
      expect(back, "round trip").toBeLessThan(2e-3);
    } finally {
      src.engine.dispose();
      dst.engine.dispose();
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  });
});
