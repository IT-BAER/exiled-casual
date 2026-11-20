import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { LoadAssetContainerAsync, NullEngine, TransformNode, Vector3 } from "@babylonjs/core";
import { createScene } from "./engine";
import { indexRigSubtree } from "./rig";
import { createMovementClips, MOVEMENT_PACE, type MovementKeyframeSpec } from "./movement-clips";

const MODELS = fileURLToPath(new URL("../../public/models/", import.meta.url));

/** Babylon reads a File through FileReader, which node does not ship. */
class NodeFileReader {
  result: unknown;
  onload?: (e: { target: NodeFileReader }) => void;
  onloadend?: (e: { target: NodeFileReader }) => void;
  onerror?: (e: { target: NodeFileReader }) => void;
  abort(): void {}
  readAsArrayBuffer(blob: Blob): void { void blob.arrayBuffer().then((r) => this.done(r)); }
  readAsText(blob: Blob): void { void blob.text().then((r) => this.done(r)); }
  private done(result: unknown): void {
    this.result = result;
    this.onload?.({ target: this });
    this.onloadend?.({ target: this });
  }
}

const SPECS: MovementKeyframeSpec[] = [
  { name: "walk", gait: "walk", yaw: 0, stride: 1 },
  { name: "run", gait: "run", yaw: 0, stride: 1 },
  { name: "runStrafeR", gait: "run", yaw: (55 * Math.PI) / 180, stride: 1 },
  { name: "runBack", gait: "run", yaw: Math.PI, stride: 0.75 },
];

describe.each([
  { file: "wardrobe.glb", root: "Armature" },
  { file: "wardrobe-female.glb", root: "Armature_female" },
])("original movement clips on $file", ({ file, root }) => {
  it("plants each foot at the clip's own pace and keeps every sole off the floor", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    const engine = new NullEngine();
    try {
      const { scene } = createScene(engine);
      const container = await LoadAssetContainerAsync(
        new File([readFileSync(`${MODELS}${file}`)], file, { type: "model/gltf-binary" }), scene);
      const entries = container.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
      const pivot = new TransformNode("rig", scene);
      for (const node of entries.rootNodes) node.parent = pivot;
      const byName = indexRigSubtree(entries.rootNodes, root);
      const inPivot = (name: string) => {
        const node = byName.get(name) as TransformNode;
        node.computeWorldMatrix(true);
        return Vector3.TransformCoordinates(node.getAbsolutePosition(), pivot.getWorldMatrix().clone().invert());
      };
      const rest = ["foot_l", "foot_r"].map(inPivot);
      const leg = Vector3.Distance(inPivot("thigh_l"), inPivot("calf_l")) + Vector3.Distance(inPivot("calf_l"), inPivot("foot_l"));

      const groups = createMovementClips(scene, pivot, byName, SPECS);
      expect(groups, "clips were not built").not.toBeNull();
      for (const spec of SPECS) {
        const group = groups!.get(spec.name)!;
        const fps = group.targetedAnimations[0]!.animation.framePerSecond;
        const frames = Math.round(group.to - group.from);
        const travel = new Vector3(Math.sin(spec.yaw), 0, Math.cos(spec.yaw));
        const perFrame = (MOVEMENT_PACE[spec.gait] * spec.stride) / fps;
        group.start(true, 1, group.from, group.to);
        group.pause();
        const samples: Vector3[][] = [];
        for (let f = 0; f < frames; f++) {
          group.goToFrame(group.from + f);
          for (const node of byName.values()) if (node instanceof TransformNode) node.computeWorldMatrix(true);
          samples.push(["foot_l", "foot_r"].map(inPivot));
        }
        group.stop();
        for (const side of [0, 1]) {
          const floor = rest[side]!.y;
          const heights = samples.map((s) => s[side]!.y);
          expect(Math.min(...heights), `${spec.name} ${side} sinks`).toBeGreaterThan(floor - 0.01 * leg);
          // Planted frames: the ankle at its rest height. Along the travel line it
          // must move back exactly one ground step per frame, or the foot skates.
          const planted = samples.map((s, f) => ({ f, at: s[side]! })).filter(({ at }) => at.y < floor + 0.0005 * leg);
          expect(planted.length, `${spec.name} ${side} never plants`).toBeGreaterThan(frames * 0.3);
          // The right foot runs half a cycle behind, so its plant crosses the loop.
          const local = (f: number) => (f + Math.round(side * 0.5 * frames)) % frames;
          const drift = planted.map(({ f, at }) => Vector3.Dot(at, travel) + local(f) * perFrame);
          const slip = Math.max(...drift) - Math.min(...drift);
          expect(slip, `${spec.name} ${side} skates ${(slip / leg).toFixed(3)} legs`).toBeLessThan(0.02 * leg);
        }
      }
    } finally {
      engine.dispose();
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  }, 60_000);
});
