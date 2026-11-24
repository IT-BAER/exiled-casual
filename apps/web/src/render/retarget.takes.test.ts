import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { LoadAssetContainerAsync, NullEngine, TransformNode, Vector3 } from "@babylonjs/core";
import { createScene } from "./engine";
import { indexRigSubtree } from "./rig";
import { HEEL_BACK, HEEL_DOWN, MOVEMENT_PACE } from "./movement-clips";
import { captureBind, createRetargetClips, takeOf, targetJoints, type PoseClip } from "./retarget";

const MODELS = fileURLToPath(new URL("../../public/models/", import.meta.url));
// The PoE2 dump is local to the dev box (gitignored), never in CI.
const REFS = fileURLToPath(new URL("../../../../review/poe2-ref/", import.meta.url));
const DIRS = ["01", "left_01", "right_01", "bwd_left_01", "bwd_right_01", "bwd_01"];
const TAKES = (["run", "walk"] as const).flatMap((gait) => DIRS.flatMap((d) =>
  [`basesword-${gait}_sword_unarmed_${d}`, `basebow-${gait}_bow_${d}`].map((name) => ({ gait, name }))));

class NodeFileReader {
  result: unknown; onload?: (e: { target: NodeFileReader }) => void; onloadend?: (e: { target: NodeFileReader }) => void;
  abort(): void {}
  readAsArrayBuffer(blob: Blob): void { void blob.arrayBuffer().then((r) => { this.result = r; this.onload?.({ target: this }); this.onloadend?.({ target: this }); }); }
}

describe.skipIf(!existsSync(REFS)).each([
  { file: "wardrobe.glb", root: "Armature" },
  { file: "wardrobe-female.glb", root: "Armature_female" },
])("PoE2 takes retargeted on $file", ({ file, root }) => {
  it("stand on the floor and plant without skating", async () => {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    const engine = new NullEngine();
    try {
      const { scene } = createScene(engine);
      const c = await LoadAssetContainerAsync(new File([readFileSync(`${MODELS}${file}`)], file, { type: "model/gltf-binary" }), scene);
      const e = c.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
      const pivot = new TransformNode("rig", scene);
      for (const n of e.rootNodes) n.parent = pivot;
      const byName = indexRigSubtree(e.rootNodes, root);
      const inv = pivot.getWorldMatrix().clone().invert();
      const inPivot = (name: string) => Vector3.TransformCoordinates((byName.get(name) as TransformNode).computeWorldMatrix(true).getTranslation(), inv);
      const footM = (name: string) => (byName.get(name) as TransformNode).computeWorldMatrix(true).multiply(inv);
      const bind = captureBind(pivot, byName)!;
      const leg = bind.leg;
      const rest = ["foot_l", "foot_r"].map(inPivot), restBall = ["ball_l", "ball_r"].map(inPivot);
      const restFoot = ["foot_l", "foot_r"].map((n) => footM(n).clone().invert());
      const restHeel = [0, 1].map((s) => { const t = restBall[s]!.subtract(rest[s]!); return rest[s]!.add(new Vector3(0, HEEL_DOWN * t.y, -HEEL_BACK * t.z)); });
      const clips = new Map(TAKES.map(({ gait, name }) => [name, { clip: JSON.parse(readFileSync(`${REFS}${name}.json`, "utf8")) as PoseClip, pace: MOVEMENT_PACE[gait] }]));
      const groups = createRetargetClips(scene, pivot, byName, clips)!;
      expect(groups).not.toBeNull();
      const report: string[] = [];
      const fails: string[] = [];
      for (const { gait, name } of TAKES) {
        const group = groups.get(name)!;
        const take = takeOf(clips.get(name)!.clip, bind);
        const fps = group.targetedAnimations[0]!.animation.framePerSecond;
        const frames = Math.round(group.to - group.from);
        const travel = new Vector3(Math.sin(take.travel), 0, Math.cos(take.travel));
        const perFrame = MOVEMENT_PACE[gait] / fps;
        const samples: Vector3[][] = [];
        group.start(true, 1, group.from, group.to); group.pause();
        for (let f = 0; f < frames; f++) {
          group.goToFrame(group.from + f);
          const heels = ["foot_l", "foot_r"].map((n, s) => Vector3.TransformCoordinates(restHeel[s]!, restFoot[s]!.multiply(footM(n))));
          samples.push([...["foot_l", "foot_r", "ball_l", "ball_r"].map(inPivot), ...heels]);
        }
        group.stop();
        const line: string[] = [];
        for (const side of [0, 1]) {
          const toe = restBall[side]!.subtract(rest[side]!); toe.y = 0;
          const heelBack = restHeel[side]!.subtract(rest[side]!); heelBack.y = 0;
          const sink = Math.min(...samples.map((s) => Math.min(s[side]!.y - rest[side]!.y, s[side + 2]!.y - restBall[side]!.y, s[side + 4]!.y - restHeel[side]!.y))) / leg;
          // Planted: a sole point (heel, ankle or ball) within a sliver of the floor. While one point stays down it
          // must move back exactly one ground step a frame, along and across the travel; rolling heel to ball is no skate.
          const across = new Vector3(travel.z, 0, -travel.x);
          const point = (s: Vector3[], f: number) => {
            const a = s[side]!.y - rest[side]!.y, b = s[side + 2]!.y - restBall[side]!.y, h = s[side + 4]!.y - restHeel[side]!.y;
            const low = Math.min(a, b, h);
            // 2 mm: a planted sole stands at 0; a toe 6 mm up at toe-off is already swinging (PoE2's own lift-off).
            return low > 0.002 * leg ? null : { f, kind: low === b ? 2 : low === h ? 4 : 0, at: low === b ? s[side + 2]! : low === h ? s[side + 4]! : s[side]! };
          };
          const planted = samples.map(point).filter((p) => p !== null);
          let slip = 0;
          const debug = process.env.RT_DEBUG === `${name}:${side}` && file === "wardrobe.glb";
          for (let i = 0; i < frames; i++) {
            const p = point(samples[i]!, i), q = point(samples[(i + 1) % frames]!, (i + 1) % frames);
            if (debug) {
              const s = samples[i]!;
              const h = [s[side]!.y - rest[side]!.y, s[side + 2]!.y - restBall[side]!.y, s[side + 4]!.y - restHeel[side]!.y].map((x) => (x / leg).toFixed(4));
              const st = p && q && p.kind === q.kind ? q.at.subtract(p.at).add(travel.scale(perFrame)) : null;
              console.log(`f${i} ankle/ball/heel ${h.join(" ")} kind ${p?.kind ?? "-"} step ${st ? (st.length() / leg).toFixed(4) : "-"}`);
            }
            if (!p || !q || p.kind !== q.kind) continue;
            const step = q.at.subtract(p.at).add(travel.scale(perFrame));
            slip = Math.max(slip, Math.hypot(Vector3.Dot(step, travel), Vector3.Dot(step, across)) / leg);
          }
          void toe; void heelBack;
          line.push(`${side ? "R" : "L"} sink ${sink.toFixed(3)} planted ${planted.length}/${frames} slip/frame ${slip.toFixed(4)}`);
          if (sink < -0.01) fails.push(`${name} ${side} sinks ${sink.toFixed(3)}`);
          // No faster than PoE2's fastest ankle (0.15 leg a 1/40 stride): anything more is a pop onto or off the floor.
          const hs = samples.map((s) => s[side]!.y);
          const jump = Math.max(...hs.map((h, f) => Math.abs(hs[(f + frames - 1) % frames]! - h))) / leg;
          if (jump > 0.16 * 40 / frames) fails.push(`${name} ${side} jumps ${jump.toFixed(3)}`);
          line.push(`jump ${jump.toFixed(3)}`);
          if (planted.length < frames * (gait === "run" ? 0.1 : 0.25)) fails.push(`${name} ${side} plants ${planted.length}/${frames}`);
          // Per frame: 0.003 legs is about 2.5 mm, under a pixel at the game camera.
          if (!(slip < 0.003)) fails.push(`${name} ${side} skates ${slip.toFixed(4)} legs/frame`);
        }
        // How far planting moves the legs off the take's own directions (knee, ankle).
        const pinned = [0, 0];
        for (let f = 0; f < take.n; f++) {
          const p = take.frame(f);
          const free = Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith("pin_")));
          const a = targetJoints(bind, p), b = targetJoints(bind, free);
          for (const [side, S] of [[0, "L"], [1, "R"]] as const) {
            const s = samples[f]!;
            const down = Math.min(s[side]!.y - rest[side]!.y, s[side + 2]!.y - restBall[side]!.y, s[side + 4]!.y - restHeel[side]!.y) < 0.002 * leg;
            for (const k of [`${S}_knee_jntBnd`, `${S}_ankle_jntBnd`]) pinned[down ? 0 : 1] = Math.max(pinned[down ? 0 : 1]!, Vector3.Distance(a[k]!, b[k]!) / leg);
          }
        }
        line.push(`pin moves legs <= ${pinned[0]!.toFixed(3)} planted, ${pinned[1]!.toFixed(3)} swinging`);
        report.push(`${name.padEnd(42)} ${line.join(" | ")}`);
      }
      console.log(`${file}\n${report.join("\n")}`);
      expect(fails).toEqual([]);
    } finally {
      engine.dispose();
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  }, 120_000);
});
