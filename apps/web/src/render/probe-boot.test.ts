// @vitest-environment node
// [DEBUG-bootclip] throwaway probe: boot vertices outside the robe in idle, plus breath sway.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { it, afterEach } from "vitest";
import { FreeCamera, Mesh, NullEngine, Vector3 } from "@babylonjs/core";
import { createScene } from "./engine";
import { attachRig, loadPlayerRig, resetPlayerRig, BASE_LOOKS, SKIRT_COLLIDERS } from "./rig";

class NodeFileReader {
  result: unknown; error: unknown;
  onload?: (e: { target: NodeFileReader }) => void;
  onerror?: (e: { target: NodeFileReader }) => void;
  onloadend?: (e: { target: NodeFileReader }) => void;
  abort(): void {}
  readAsArrayBuffer(blob: Blob): void { this.finish(blob.arrayBuffer()); }
  readAsText(blob: Blob): void { this.finish(blob.text()); }
  private finish(p: Promise<unknown>): void {
    p.then((r) => { this.result = r; this.onload?.({ target: this }); this.onloadend?.({ target: this }); })
      .catch((e: unknown) => { this.error = e; this.onerror?.({ target: this }); this.onloadend?.({ target: this }); });
  }
}

let engine: InstanceType<typeof NullEngine>;
afterEach(() => { resetPlayerRig(); engine?.dispose(); });

const world = (mesh: Mesh): Float32Array => {
  const local = mesh.getPositionData(true, true)!;
  const m = mesh.getWorldMatrix();
  const out = new Float32Array(local.length);
  const v = new Vector3();
  for (let i = 0; i < local.length; i += 3) {
    Vector3.TransformCoordinatesFromFloatsToRef(local[i]!, local[i + 1]!, local[i + 2]!, m, v);
    out[i] = v.x; out[i + 1] = v.y; out[i + 2] = v.z;
  }
  return out;
};

const hit = (ox: number, y: number, oz: number, dx: number, dz: number, p: Float32Array, a: number, b: number, c: number): number => {
  const ax = p[a * 3]!, ay = p[a * 3 + 1]!, az = p[a * 3 + 2]!;
  const e1x = p[b * 3]! - ax, e1y = p[b * 3 + 1]! - ay, e1z = p[b * 3 + 2]! - az;
  const e2x = p[c * 3]! - ax, e2y = p[c * 3 + 1]! - ay, e2z = p[c * 3 + 2]! - az;
  const px = -dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det;
  const tx = ox - ax, ty = y - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dz * qz) * inv;
  if (v < 0 || u + v > 1) return -1;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
};

type V3 = [number, number, number];
const CASES: Record<string, { r: V3; rt?: V3; worn?: number }> = JSON.parse(process.env.PROBE_CASES ?? "{}");

it.each(Object.keys(CASES))("[DEBUG-bootclip] %s", async (name) => {
  const k = CASES[name]!;
  const calfR = SKIRT_COLLIDERS[3] as { shaft: number[]; toe?: number[]; worn: number };
  calfR.shaft = k.r; calfR.toe = k.rt; if (k.worn) calfR.worn = k.worn;
  const MODELS = fileURLToPath(new URL("../../public/models/", import.meta.url));
  const original = (globalThis as { FileReader?: unknown }).FileReader;
  (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
  try {
    engine = new NullEngine();
    engine.getDeltaTime = () => 16;
    const { scene } = createScene(engine);
    scene.useConstantAnimationDeltaTime = true;
    new FreeCamera("eye", new Vector3(0, 2, -6), scene);
    const file = (n: string) => new File([readFileSync(`${MODELS}${n}`)], n, { type: "model/gltf-binary" });
    await loadPlayerRig(scene, { anims: file("anim-library.glb"), wardrobe: file("wardrobe.glb") });
    const rig = attachRig(scene, new Mesh("hero", scene))!;
    rig.setLooks({ ...BASE_LOOKS, helmet: "ember", chest: "ember", boots: "ember", gloves: "ember" });
    rig.standSettled();
    const frame = () => { rig.setLocomotion(0); scene.render(); };
    for (let i = 0; i < 200; i++) frame();
    const on = scene.meshes.filter((m) => m.isEnabled() && m instanceof Mesh && m.getTotalVertices() > 0) as Mesh[];
    const robe = on.find((m) => m.name === "chest.ember.robe")!;
    const boots = on.filter((m) => m.name.startsWith("boots.ember"));
    const pelvis = scene.transformNodes.find((n) => n.name === "pelvis")!;
    const joints = scene.transformNodes.filter((n) => /^skirt_\d+_0[2-6]$/.test(n.name));
    const start = joints.map((n) => n.getAbsolutePosition().clone());
    let sway = 0;
    const clip: Record<string, number> = {};
    const count: Record<string, number> = {};
    for (let f = 0; f < 150; f++) {
      frame();
      joints.forEach((n, j) => { sway = Math.max(sway, Vector3.Distance(n.getAbsolutePosition(), start[j]!)); });
      if (f % 10) continue;
      const p = world(robe); const idx = robe.getIndices()!;
      const c = pelvis.getAbsolutePosition();
      for (const boot of boots) {
        const b = world(boot);
        let worst = 0, n = 0;
        for (let i = 0; i < b.length; i += 3) {
          const x = b[i]!, y = b[i + 1]!, z = b[i + 2]!;
          if (y < 0.3) continue;
          let dx = x - c.x, dz = z - c.z;
          const r = Math.hypot(dx, dz);
          dx /= r; dz /= r;
          let far = -1;
          for (let t = 0; t < idx.length; t += 3) {
            const a = idx[t]!, bb = idx[t + 1]!, cc = idx[t + 2]!;
            const y0 = p[a * 3 + 1]!, y1 = p[bb * 3 + 1]!, y2 = p[cc * 3 + 1]!;
            if (y < Math.min(y0, y1, y2) || y > Math.max(y0, y1, y2)) continue;
            const s = hit(c.x, y, c.z, dx, dz, p, a, bb, cc);
            if (s > far) far = s;
          }
          if (far > 0 && r > far) { n++; worst = Math.max(worst, r - far); }
        }
        const side = boot.name.slice(-1);
        clip[side] = Math.max(clip[side] ?? 0, worst);
        count[side] = Math.max(count[side] ?? 0, n);
      }
    }
    console.log(`[DEBUG-bootclip] RESULT ${name}: sway ${(sway * 100).toFixed(2)}cm | clip L ${((clip.l ?? 0) * 100).toFixed(2)}cm/${count.l} R ${((clip.r ?? 0) * 100).toFixed(2)}cm/${count.r}`);
  } finally {
    (globalThis as { FileReader?: unknown }).FileReader = original;
  }
}, 600_000);
