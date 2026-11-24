import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { LoadAssetContainerAsync, NullEngine, Quaternion, TransformNode, Vector3 } from "@babylonjs/core";
import { createScene } from "./engine";
import { indexRigSubtree, ORIGINAL_DIRECTIONS } from "./rig";
import { BACK_DIAG_GAITS, BACK_DIAG_RIGHT_GAITS, BACK_GAITS, BOW_GAITS, createMovementClips, GAITS, HEEL_BACK, HEEL_DOWN, MOVEMENT_PACE, type GaitKeys, type MovementKeyframeSpec } from "./movement-clips";

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

/** The clips the game bakes: one per key set, forward, side and back-diagonal both ways, backpedal. */
const SPECS: MovementKeyframeSpec[] = (["walk", "run"] as const).flatMap((gait) =>
  [...new Map(ORIGINAL_DIRECTIONS[gait].map(({ clip, yaw, stride }) => [clip, { name: clip, gait, yaw, stride }])).values()]);

const SPINE_OWNED = ["spine_01", "neck_01"];

it("the bow carry keeps each gait's legs, and the run's hips", () => {
  const upper = ["arms", "chestTwist", "chestLean", "twist"];
  const own = { run: new Set(upper), walk: new Set([...upper, "hipSway", "hipYaw", "hipRoll", "bank", "headYaw", "headNod"]) };
  for (const gait of ["walk", "run"] as const) {
    for (const [key, value] of Object.entries(GAITS[gait])) {
      if (!own[gait].has(key)) expect(BOW_GAITS[gait][key as keyof GaitKeys], `${gait} ${key}`).toBe(value);
    }
  }
});

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
      // Whatever the idle left on a bone the gait does not turn must not survive into the gait.
      const spineBind = SPINE_OWNED.map((name) => (byName.get(name) as TransformNode).rotationQuaternion!.clone());
      const rest = ["foot_l", "foot_r"].map(inPivot);
      const restBall = ["ball_l", "ball_r"].map(inPivot);
      const leg = Vector3.Distance(inPivot("thigh_l"), inPivot("calf_l")) + Vector3.Distance(inPivot("calf_l"), inPivot("foot_l"));
      // The sole's heel rides the foot bone: where it sits at rest, carried by the foot's turn since.
      const footInPivot = (name: string) => (byName.get(name) as TransformNode).computeWorldMatrix(true).multiply(pivot.getWorldMatrix().clone().invert());
      const restFoot = ["foot_l", "foot_r"].map((name) => footInPivot(name).clone().invert());
      const restHeel = [0, 1].map((side) => {
        const toe = restBall[side]!.subtract(rest[side]!);
        return rest[side]!.add(new Vector3(0, HEEL_DOWN * toe.y, -HEEL_BACK * toe.z));
      });

      const groups = createMovementClips(scene, pivot, byName, SPECS);
      expect(groups, "clips were not built").not.toBeNull();
      for (const spec of SPECS) {
        const group = groups!.get(spec.name)!;
        const fps = group.targetedAnimations[0]!.animation.framePerSecond;
        const frames = Math.round(group.to - group.from);
        const travel = new Vector3(Math.sin(spec.yaw), 0, Math.cos(spec.yaw));
        const perFrame = (MOVEMENT_PACE[spec.gait] * spec.stride) / fps;
        for (const name of SPINE_OWNED) (byName.get(name) as TransformNode).rotationQuaternion!.copyFromFloats(0, 0, 0, 1);
        group.start(true, 1, group.from, group.to);
        group.pause();
        group.goToFrame(group.from);
        for (const [i, name] of SPINE_OWNED.entries()) {
          const now = (byName.get(name) as TransformNode).rotationQuaternion!;
          expect(Math.abs(Quaternion.Dot(now, spineBind[i]!)), `${spec.name} leaves ${name} to the clip before`).toBeGreaterThan(0.99999);
        }
        const samples: Vector3[][] = [];
        for (let f = 0; f < frames; f++) {
          group.goToFrame(group.from + f);
          for (const node of byName.values()) if (node instanceof TransformNode) node.computeWorldMatrix(true);
          const heels = ["foot_l", "foot_r"].map((name, side) =>
            Vector3.TransformCoordinates(restHeel[side]!, restFoot[side]!.multiply(footInPivot(name))));
          samples.push([...["foot_l", "foot_r", "ball_l", "ball_r"].map(inPivot), ...heels]);
        }
        group.stop();
        for (const side of [0, 1]) {
          const floor = rest[side]!.y;
          const ballFloor = restBall[side]!.y;
          const heelFloor = restHeel[side]!.y;
          const toe = restBall[side]!.subtract(rest[side]!);
          toe.y = 0;
          const heelBack = restHeel[side]!.subtract(rest[side]!);
          heelBack.y = 0;
          const heights = samples.map((s) => s[side]!.y);
          expect(Math.min(...heights), `${spec.name} ${side} sinks`).toBeGreaterThan(floor - 0.01 * leg);
          expect(Math.min(...samples.map((s) => s[side + 4]!.y)), `${spec.name} ${side} heel sinks`).toBeGreaterThan(heelFloor - 0.01 * leg);
          // No faster than PoE2's fastest ankle (0.15 leg up or down per 1/40 stride, its back kick):
          // anything more is a pop onto or off the floor.
          const step = Math.max(...heights.map((h, f) => Math.abs(heights[(f + frames - 1) % frames]! - h)));
          expect(step, `${spec.name} ${side} jumps ${(step / leg).toFixed(3)} legs in a frame`).toBeLessThan((0.16 * 40 / frames) * leg);
          // Planted frames: the ball, the ankle or the heel on the floor. The contact point (moved back
          // onto its ankle's track) must move back exactly one ground step per frame, or the foot skates.
          const planted = samples.flatMap((s, f) => {
            const ankle = s[side]!, ball = s[side + 2]!, heel = s[side + 4]!;
            if (ball.y < ballFloor + 0.0005 * leg) return [{ f, at: ball.subtract(toe) }];
            if (ankle.y < floor + 0.0005 * leg) return [{ f, at: ankle }];
            return heel.y < heelFloor + 0.0005 * leg ? [{ f, at: heel.subtract(heelBack) }] : [];
          });
          // PoE2's run keeps a toe down a quarter of its stride; a walk stands far longer.
          const share = spec.gait === "run" ? 0.22 : 0.3;
          expect(planted.length, `${spec.name} ${side} never plants`).toBeGreaterThan(frames * share);
          // The right foot runs half a cycle behind, so its plant crosses the loop.
          const local = (f: number) => (f + Math.round(side * 0.5 * frames)) % frames;
          const drift = planted.map(({ f, at }) => Vector3.Dot(at, travel) + local(f) * perFrame);
          // A plant that lands before the loop's last frame continues at frame 0: one cycle of travel apart.
          const cycle = frames * perFrame;
          const wrapped = drift.map((d) => d - Math.round((d - drift[0]!) / cycle) * cycle);
          const slip = Math.max(...wrapped) - Math.min(...wrapped);
          expect(slip, `${spec.name} ${side} skates ${(slip / leg).toFixed(3)} legs`).toBeLessThan(0.02 * leg);
        }
      }
    } finally {
      engine.dispose();
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  }, 60_000);
});

describe("second-foot timing keys", () => {
  /** Bakes one walk back-left clip on the male body and samples both ankles, balls and heels per frame. */
  async function bakeBackLeft(diag: GaitKeys) {
    const original = (globalThis as { FileReader?: unknown }).FileReader;
    (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
    const engine = new NullEngine();
    try {
      const { scene } = createScene(engine);
      const file = "wardrobe.glb";
      const container = await LoadAssetContainerAsync(
        new File([readFileSync(`${MODELS}${file}`)], file, { type: "model/gltf-binary" }), scene);
      const entries = container.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
      const pivot = new TransformNode("rig", scene);
      for (const node of entries.rootNodes) node.parent = pivot;
      const byName = indexRigSubtree(entries.rootNodes, "Armature");
      const inPivot = (name: string) => {
        const node = byName.get(name) as TransformNode;
        node.computeWorldMatrix(true);
        return Vector3.TransformCoordinates(node.getAbsolutePosition(), pivot.getWorldMatrix().clone().invert());
      };
      const leg = Vector3.Distance(inPivot("thigh_r"), inPivot("calf_r")) + Vector3.Distance(inPivot("calf_r"), inPivot("foot_r"));
      const footInPivot = () => (byName.get("foot_r") as TransformNode).computeWorldMatrix(true).multiply(pivot.getWorldMatrix().clone().invert());
      const restFoot = footInPivot().clone().invert();
      const ankle = inPivot("foot_r"), ball = inPivot("ball_r"), toe = ball.subtract(ankle);
      const rest = { ankle, ball, heel: ankle.add(new Vector3(0, HEEL_DOWN * toe.y, -HEEL_BACK * toe.z)) };
      const spec: MovementKeyframeSpec = { name: "walkBackLeft", gait: "walk", yaw: (-135 * Math.PI) / 180, stride: 1 };
      const group = createMovementClips(scene, pivot, byName, [spec], GAITS, BACK_GAITS, { walk: diag }, BACK_DIAG_RIGHT_GAITS)!.get(spec.name)!;
      const frames = Math.round(group.to - group.from);
      group.start(true, 1, group.from, group.to);
      group.pause();
      const samples: { ankle: Vector3; ball: Vector3; heel: Vector3; left: Vector3 }[] = [];
      const turns: Quaternion[][] = [];
      for (let f = 0; f < frames; f++) {
        group.goToFrame(group.from + f);
        for (const node of byName.values()) if (node instanceof TransformNode) node.computeWorldMatrix(true);
        samples.push({ ankle: inPivot("foot_r"), ball: inPivot("ball_r"), heel: Vector3.TransformCoordinates(rest.heel, restFoot.multiply(footInPivot())), left: inPivot("foot_l") });
        turns.push(["thigh_l", "calf_l", "foot_l", "thigh_r", "calf_r", "foot_r", "pelvis"].map((n) => (byName.get(n) as TransformNode).rotationQuaternion!.clone()));
      }
      group.stop();
      const fps = group.targetedAnimations[0]!.animation.framePerSecond;
      return { samples, turns, frames, leg, rest, perFrame: (MOVEMENT_PACE.walk * spec.stride) / fps, travel: new Vector3(Math.sin(spec.yaw), 0, Math.cos(spec.yaw)) };
    } finally {
      engine.dispose();
      (globalThis as { FileReader?: unknown }).FileReader = original;
    }
  }

  /** The right foot's longest run of frames with the ball, ankle or heel on the floor: where it starts and how long it lasts, as stride shares. */
  function rightPlant({ samples, frames, leg, rest }: Awaited<ReturnType<typeof bakeBackLeft>>) {
    const down = samples.map((s) => s.ball.y < rest.ball.y + 0.0005 * leg || s.ankle.y < rest.ankle.y + 0.0005 * leg || s.heel.y < rest.heel.y + 0.0005 * leg);
    let best = { start: 0, length: 0 };
    for (let start = 0; start < frames; start++) {
      if (!down[start] || down[(start + frames - 1) % frames]) continue;
      let length = 0;
      while (length < frames && down[(start + length) % frames]) length++;
      if (length > best.length) best = { start, length };
    }
    return { start: best.start / frames, share: best.length / frames, frames: best };
  }

  it("lands the right foot at secondAt, keeps it down for secondStance, and does not skate", async () => {
    const keys = BACK_DIAG_GAITS.walk!;
    const timed = await bakeBackLeft({ ...keys, secondAt: 0.66, secondStance: 0.35 });
    const plant = rightPlant(timed);
    // A landing ball rides in early (0.03 of the default half-stride swing, longer as the swing stretches);
    // the heel-off ball contact stays a little past the stance.
    expect(plant.start, "right foot touchdown").toBeGreaterThan(0.58);
    expect(plant.start, "right foot touchdown").toBeLessThan(0.69);
    expect(plant.share, "right foot planted share").toBeGreaterThan(0.33);
    expect(plant.share, "right foot planted share").toBeLessThan(0.45);
    const { samples, frames, perFrame, travel, leg, rest } = timed;
    // The contact point moved back onto its ankle's track, as the clip test above does.
    const toe = rest.ball.subtract(rest.ankle).multiplyByFloats(1, 0, 1);
    const heelBack = rest.heel.subtract(rest.ankle).multiplyByFloats(1, 0, 1);
    const drift = Array.from({ length: plant.frames.length }, (_, j) => {
      const s = samples[(plant.frames.start + j) % frames]!;
      const at = s.ball.y < rest.ball.y + 0.0005 * leg ? s.ball.subtract(toe)
        : s.ankle.y < rest.ankle.y + 0.0005 * leg ? s.ankle : s.heel.subtract(heelBack);
      return Vector3.Dot(at, travel) + j * perFrame;
    });
    const slip = Math.max(...drift) - Math.min(...drift);
    expect(slip, `right foot skates ${(slip / leg).toFixed(3)} legs`).toBeLessThan(0.02 * leg);
  }, 60_000);

  it("half-stride timing at the gait's own stance bakes the same pose as no timing keys", async () => {
    const keys = BACK_DIAG_GAITS.walk!;
    const plain = await bakeBackLeft(keys);
    const timed = await bakeBackLeft({ ...keys, secondAt: 0.5, secondStance: keys.stance });
    let worst = 1;
    for (const [f, row] of plain.turns.entries()) for (const [j, q] of row.entries()) worst = Math.min(worst, Math.abs(Quaternion.Dot(q, timed.turns[f]![j]!)));
    // Two bakes of the same keys already differ by ~3e-8 (float32 key storage).
    expect(worst).toBeGreaterThan(1 - 1e-6);
  }, 60_000);

  it("right-foot swing keys move the right foot's swing only, and the gait's own values bake the same pose", async () => {
    const keys = BACK_DIAG_GAITS.walk!;
    const plain = await bakeBackLeft(keys);
    const same = await bakeBackLeft({ ...keys, second: { swingOut: keys.swingOut, height: keys.height } });
    let worst = 1;
    for (const [f, row] of plain.turns.entries()) for (const [j, q] of row.entries()) worst = Math.min(worst, Math.abs(Quaternion.Dot(q, same.turns[f]![j]!)));
    expect(worst).toBeGreaterThan(1 - 1e-6);
    const wide = await bakeBackLeft({ ...keys, second: { swingOut: keys.swingOut.map((x) => x + 0.1) } });
    const moved = (side: "ankle" | "left") => Math.max(...plain.samples.map((s, f) => Vector3.Distance(s[side], wide.samples[f]![side]))) / plain.leg;
    expect(moved("ankle"), "right ankle moves with its own swingOut").toBeGreaterThan(0.05);
    expect(moved("left"), "left ankle stays").toBeLessThan(0.005);
  }, 60_000);
});
