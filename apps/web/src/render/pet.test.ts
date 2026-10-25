// @vitest-environment node
import { describe, it, expect, afterAll, afterEach, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NullEngine, Scene, type Mesh, type PBRMaterial, type StandardMaterial } from "@babylonjs/core";
import {
  FLOOR_CLIPS, FOLLOW, GALLOP_Y, HOVER_Y, PET_ACTIONS, PET_CLIPS, PET_ID, PET_URL, PetActor, ROUTINE, ROUTINE_PERIOD, SWIM_Y,
  cloudRate, followTarget, loadPet, isPetReady, resetPet, routineAt, stepFollow,
  type FollowState,
} from "./pet";

// `loadPet` fetches a URL; node has no server, so hand the loader the file on disk.
vi.mock("@babylonjs/core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@babylonjs/core")>();
  const { readFileSync: read } = await import("node:fs");
  const path = fileURLToPath(new URL("../../public/models/pet.glb", import.meta.url));
  return {
    ...core,
    LoadAssetContainerAsync: (src: unknown, scene: import("@babylonjs/core").Scene) =>
      core.LoadAssetContainerAsync(
        src === "/models/pet.glb" ? new File([read(path)], "pet.glb", { type: "model/gltf-binary" }) : (src as string),
        scene,
      ),
  };
});

/** Babylon reads a File through FileReader, which node does not ship (as monsters.test). */
class NodeFileReader {
  result: unknown;
  onload?: (e: { target: NodeFileReader }) => void;
  onloadend?: (e: { target: NodeFileReader }) => void;
  onerror?: (e: { target: NodeFileReader }) => void;
  abort(): void {}
  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((r) => { this.result = r; this.onload?.({ target: this }); this.onloadend?.({ target: this }); });
  }
}
const originalFileReader = (globalThis as { FileReader?: unknown }).FileReader;
beforeAll(() => { (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader; });
afterAll(() => { (globalThis as { FileReader?: unknown }).FileReader = originalFileReader; });

let engine: NullEngine | undefined;
afterEach(() => {
  resetPet();
  engine?.dispose();
  engine = undefined;
});

function newScene(): Scene {
  engine = new NullEngine();
  return new Scene(engine);
}

const fresh = (x = 0, z = 0): FollowState => ({ x, z, vx: 0, vz: 0, yaw: 0 });

/** Run the spring at 60 Hz for `seconds`. */
function run(s: FollowState, seconds: number, px: number, pz: number, hx = 0, hz = 1): number {
  let speed = 0;
  for (let i = 0; i < seconds * 60; i++) speed = stepFollow(s, 1 / 60, px, pz, hx, hz);
  return speed;
}

describe("pet follow spring", () => {
  it("rests behind and beside the player, off his heading", () => {
    const t = followTarget(10, 5, 0, 1);
    expect(t.z).toBeCloseTo(5 - FOLLOW.behind);
    expect(Math.abs(t.x - 10)).toBeCloseTo(FOLLOW.beside);
    // Turned round, the spot turns with him.
    const back = followTarget(10, 5, 0, -1);
    expect(back.z).toBeCloseTo(5 + FOLLOW.behind);
    expect(back.x - 10).toBeCloseTo(-(t.x - 10));
  });

  it("settles on its spot without overshooting past it and then stays put", () => {
    const s = fresh(0, -6);
    const target = followTarget(0, 0, 0, 1);
    let maxZ = -Infinity;
    for (let i = 0; i < 240; i++) {
      stepFollow(s, 1 / 60, 0, 0, 0, 1);
      maxZ = Math.max(maxZ, s.z);
    }
    // Critically damped: never past the target, and inside the dead zone it rests.
    expect(maxZ).toBeLessThanOrEqual(target.z + 1e-6);
    expect(Math.hypot(s.x - target.x, s.z - target.z)).toBeLessThan(FOLLOW.deadZone);
    const speed = run(s, 1, 0, 0);
    expect(speed).toBeLessThan(0.02);
  });

  it("does not creep inside the dead zone", () => {
    const target = followTarget(0, 0, 0, 1);
    const s = fresh(target.x + 0.2, target.z - 0.2);
    const before = { x: s.x, z: s.z };
    run(s, 2, 0, 0);
    expect(s.x).toBeCloseTo(before.x, 3);
    expect(s.z).toBeCloseTo(before.z, 3);
  });

  it("teleports to the spot when left far behind, as across a portal", () => {
    const s = fresh(0, 0);
    const speed = stepFollow(s, 1 / 60, 100, 100, 0, 1);
    const target = followTarget(100, 100, 0, 1);
    expect(s.x).toBeCloseTo(target.x);
    expect(s.z).toBeCloseTo(target.z);
    expect(speed).toBe(0);
  });

  it("faces its own travel while moving and the player's heading at rest", () => {
    const s = fresh(0, -6);
    stepFollow(s, 1 / 60, 0, 0, 0, 1);
    for (let i = 0; i < 30; i++) stepFollow(s, 1 / 60, 0, 0, 0, 1);
    // Moving along +z: yaw 0 in the renderer's atan2(dx, dz) convention.
    expect(Math.abs(s.yaw)).toBeLessThan(0.6);
    run(s, 4, 0, 0, 1, 0);
    expect(s.yaw).toBeCloseTo(Math.PI / 2, 1);
  });

  it("reports dash speed while catching up", () => {
    const s = fresh(0, -8);
    let fastest = 0;
    for (let i = 0; i < 60; i++) fastest = Math.max(fastest, stepFollow(s, 1 / 60, 0, 0, 0, 1));
    expect(fastest).toBeGreaterThan(FOLLOW.dash);
  });
});

describe("pet heights and idle routine", () => {
  it("hovers beside the player below his head and gallops a little higher", () => {
    // PoE: the hovering cat sits at his hip to chest, the running one at his shoulder.
    expect(HOVER_Y).toBeGreaterThan(0.7);
    expect(HOVER_Y + 0.25).toBeLessThan(1.5);
    expect(GALLOP_Y).toBeGreaterThan(HOVER_Y);
    expect(GALLOP_Y + 0.25).toBeLessThan(1.7);
    // The swim of the routine is high over his head (1.8).
    expect(SWIM_Y).toBeGreaterThan(2.0);
  });

  it("runs its air loop in order, about every fifteen seconds", () => {
    expect(ROUTINE.map((p) => p.clip)).toEqual(["spring", "swim", "dive", "hover"]);
    expect(ROUTINE_PERIOD).toBeGreaterThan(13);
    expect(ROUTINE_PERIOD).toBeLessThan(17);
    expect(routineAt(0).clip).toBe("spring");
    expect(routineAt(ROUTINE_PERIOD - 0.01).clip).toBe("hover");
    // It loops.
    expect(routineAt(ROUTINE_PERIOD + 0.01).clip).toBe("spring");
  });

  it("always floats: no phase below the hover, none on the floor, the swim over his head", () => {
    for (const p of ROUTINE) expect((FLOOR_CLIPS as readonly string[]).includes(p.clip)).toBe(false);
    for (let t = 0; t < ROUTINE_PERIOD; t += 0.01) expect(routineAt(t).height).toBeGreaterThanOrEqual(HOVER_Y - 1e-9);
    const swim = ROUTINE.find((p) => p.clip === "swim")!;
    expect(routineAt(swim.start + swim.seconds / 2).height).toBeCloseTo(SWIM_Y, 5);
  });

  it("has no jump in height anywhere: the spring rises, the dive lands", () => {
    let prev = routineAt(0).height;
    for (let t = 0.01; t < ROUTINE_PERIOD * 2; t += 0.01) {
      const h = routineAt(t).height;
      // A dive is fast but never a teleport: under 0.1 units per hundredth.
      expect(Math.abs(h - prev)).toBeLessThan(0.1);
      prev = h;
    }
  });

  it("plays the loop around the player: hovers on its follow spot, swims over his head", () => {
    const at = (clip: string, u: number) => {
      const p = ROUTINE.find((q) => q.clip === clip)!;
      const r = routineAt(p.start + p.seconds * u);
      return Math.hypot(r.side, r.fwd);
    };
    expect(at("hover", 0.5)).toBeCloseTo(Math.hypot(FOLLOW.behind, FOLLOW.beside), 5);
    let over = Infinity;
    for (let u = 0; u <= 1; u += 0.01) over = Math.min(over, at("swim", u), at("spring", u));
    expect(over).toBeLessThan(0.3);
    // It travels, never teleports, the wrap of the loop included.
    let prev = routineAt(0);
    for (let t = 0.01; t < ROUTINE_PERIOD * 2; t += 0.01) {
      const r = routineAt(t);
      expect(Math.hypot(r.side - prev.side, r.fwd - prev.fwd)).toBeLessThan(0.05);
      prev = r;
    }
  });

  it("streams the cloud harder the faster it moves, and never off", () => {
    expect(cloudRate(0)).toBeGreaterThan(0);
    expect(cloudRate(FOLLOW.dash)).toBeGreaterThan(cloudRate(0) * 3);
    expect(cloudRate(50)).toBe(cloudRate(FOLLOW.dash * 2));
  });
});

describe("pet asset", () => {
  const glb = readFileSync(fileURLToPath(new URL("../../public/models/pet.glb", import.meta.url)));
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8")) as {
    nodes: { name: string; mesh?: number; skin?: number; children?: number[] }[];
    animations: { name: string }[];
    materials: { name: string; emissiveFactor?: number[]; extensions?: Record<string, unknown> }[];
    extensionsRequired?: string[];
  };

  it("carries the cat as one skinned root with every clip the runtime asks for", () => {
    const root = json.nodes.find((n) => n.name === PET_ID);
    expect(root).toBeDefined();
    const meshes = (root!.children ?? []).map((i) => json.nodes[i]!).filter((n) => n.mesh !== undefined);
    expect(meshes.length).toBe(2);
    for (const m of meshes) expect(m.skin).toBeTypeOf("number");
    const names = json.animations.map((a) => a.name);
    for (const clip of PET_CLIPS) expect(names).toContain(`${PET_ID}|${clip}`);
    expect(names.length).toBe(PET_CLIPS.length);
  });

  it("glows at the eyes and is served meshopt-packed", () => {
    const eye = json.materials.find((m) => m.name === `${PET_ID}.eye`);
    expect(eye?.emissiveFactor?.[2]).toBeGreaterThan(0.9);
    expect(eye?.extensions).toHaveProperty("KHR_materials_emissive_strength");
    const coat = json.materials.find((m) => m.name === `${PET_ID}.coat`);
    expect(coat?.extensions).toHaveProperty("KHR_materials_emissive_strength");
    expect(json.extensionsRequired).toContain("EXT_meshopt_compression");
    expect(glb.byteLength).toBeLessThan(700 * 1024);
  });
});

describe("pet actor", () => {
  it("loads through the real loader and hovers the cat on its root with every clip", async () => {
    const scene = newScene();
    await loadPet(scene);
    expect(isPetReady(scene)).toBe(true);
    const pet = new PetActor(scene);
    pet.update(1 / 60, 3, 4, { x: 0, y: 1 }, true, false);
    expect(pet.clipNames().sort()).toEqual([...PET_CLIPS].sort());
    const meshes = pet.root.getChildMeshes();
    expect(meshes.length).toBeGreaterThan(0);
    for (const m of meshes) expect(m.isPickable).toBe(false);
    const eyes = meshes.find((m) => m.name.endsWith(".eyes"))!;
    expect(eyes).toBeDefined();
    expect((eyes.material as PBRMaterial).emissiveColor.b).toBeGreaterThan(0.9);
    expect(pet.root.position.y).toBeCloseTo(HOVER_Y, 1);
    expect(pet.root.rotation.x).toBe(0);
    expect((scene.getMeshByName("pet-ground") as Mesh).position.y).toBe(0);
    pet.dispose();
    expect(scene.getMeshByName(`${PET_ID}.body`)).toBeNull();
    expect(scene.getMeshByName(`${PET_ID}.halo`)).toBeNull();
    expect(scene.animationGroups.length).toBe(0);
  });

  it("wears a violet rim halo on the body's own skeleton", async () => {
    const scene = newScene();
    await loadPet(scene);
    const pet = new PetActor(scene);
    pet.update(1 / 60, 0, 0, { x: 0, y: 1 }, true, false);
    const body = scene.getMeshByName(`${PET_ID}.body`)!;
    const halo = scene.getMeshByName(`${PET_ID}.halo`)!;
    expect(halo).not.toBeNull();
    expect(halo.isPickable).toBe(false);
    expect(halo.skeleton).toBe(body.skeleton);
    const mat = halo.material as StandardMaterial;
    expect(mat.emissiveColor.b).toBeGreaterThan(mat.emissiveColor.g);
    expect(mat.opacityFresnelParameters?.isEnabled).toBe(true);
    // The fresnel term ADDS to alpha: any base alpha paints the whole skin.
    expect(mat.alpha).toBe(0);
    pet.dispose();
  });

  it("hides while the player is dead and comes back alive", async () => {
    const scene = newScene();
    await loadPet(scene);
    const pet = new PetActor(scene);
    pet.update(1 / 60, 0, 0, undefined, true, false);
    expect(pet.root.isEnabled()).toBe(true);
    pet.update(1 / 60, 0, 0, undefined, false, false);
    expect(pet.root.isEnabled()).toBe(false);
    pet.update(1 / 60, 0, 0, undefined, true, false);
    expect(pet.root.isEnabled()).toBe(true);
    pet.dispose();
  });

  it("hovers on arrival, gallops when left behind, hovers again beside him", async () => {
    const scene = newScene();
    await loadPet(scene);
    const pet = new PetActor(scene);
    pet.update(1 / 60, 0, 0, { x: 0, y: 1 }, true, false);
    expect(pet.playing).toBe("hover");
    // The player is suddenly nine units away: the cat gallops after him in the air,
    // then settles beside him as he walks on (walking, so the routine cannot start).
    let top = 0;
    for (let i = 0; i < 40; i++) {
      pet.update(1 / 60, 0, 9, { x: 0, y: 1 }, true, false);
      top = Math.max(top, pet.root.position.y);
    }
    expect(pet.playing).toBe("gallop");
    expect(top).toBeGreaterThan(HOVER_Y + (GALLOP_Y - HOVER_Y) / 2);
    for (let i = 0; i < 240; i++) pet.update(1 / 60, 0, 9 + i / 300, { x: 0, y: 1 }, true, false);
    expect(pet.playing).toBe("hover");
    expect(pet.root.position.y).toBeCloseTo(HOVER_Y, 1);
    pet.dispose();
  });

  it("hovers first while he stands, then plays the routine: floor, spring, swim high, dive", async () => {
    const scene = newScene();
    await loadPet(scene);
    const pet = new PetActor(scene);
    const seen: string[] = [];
    let low = Infinity;
    let high = 0;
    let overhead = Infinity;
    for (let i = 0; i < 60 * 40; i++) {
      pet.update(1 / 60, 0, 0, { x: 0, y: 1 }, true, false);
      if (pet.playing !== seen[seen.length - 1]) seen.push(pet.playing!);
      low = Math.min(low, pet.root.position.y);
      if (pet.playing === "swim") high = Math.max(high, pet.root.position.y);
      if (pet.playing === "swim") overhead = Math.min(overhead, Math.hypot(pet.root.position.x, pet.root.position.z));
    }
    // It swims over his head, not on its follow spot.
    expect(overhead).toBeLessThan(0.4);
    expect(seen[0]).toBe("hover");
    expect(seen.slice(1, 5)).toEqual(["spring", "swim", "dive", "hover"]);
    // It came round again: the routine loops while he stands.
    expect(seen.filter((c) => c === "swim").length).toBeGreaterThanOrEqual(2);
    // Never down on the floor, not once in forty seconds.
    expect(low).toBeGreaterThan(HOVER_Y - 0.1);
    expect(high).toBeGreaterThan(SWIM_Y - 0.2);
    // He walks off: the cat leaves the floor and comes back up beside him.
    for (let i = 0; i < 60 * 3; i++) pet.update(1 / 60, i / 300, 0, { x: 1, y: 0 }, true, false);
    expect(["hover", "gallop"]).toContain(pet.playing);
    expect(pet.root.position.y).toBeGreaterThan(HOVER_Y - 0.1);
    pet.dispose();
  });

  it("previews any action in place for the viewer, floor clips on the floor", async () => {
    const scene = newScene();
    await loadPet(scene);
    const pet = new PetActor(scene);
    pet.previewAction("curl");
    pet.previewTick(1 / 60);
    expect(pet.playing).toBe("curl");
    expect(pet.root.position.x).toBe(0);
    expect(pet.root.position.z).toBe(0);
    expect(pet.root.position.y).toBeCloseTo(0, 2);
    // A one-shot floor clip repeats in the viewer rather than freezing.
    pet.previewAction("roll_back");
    for (let i = 0; i < 60 * 6; i++) pet.previewTick(1 / 60);
    expect(pet.playing).toBe("roll_back");
    pet.previewAction("hover");
    pet.previewTick(1 / 60);
    expect(pet.root.position.y).toBeCloseTo(HOVER_Y, 1);
    // The routine runs the whole loop in place.
    pet.previewAction("routine");
    const seen = new Set<string>();
    let high = 0;
    for (let i = 0; i < 60 * 16; i++) {
      pet.previewTick(1 / 60);
      seen.add(pet.playing!);
      high = Math.max(high, pet.root.position.y);
    }
    for (const p of ROUTINE) expect(seen.has(p.clip)).toBe(true);
    expect(high).toBeGreaterThan(SWIM_Y - 0.2);
    expect(PET_ACTIONS).toEqual([...PET_CLIPS, "routine"]);
    expect(pet.clipGroups.size).toBe(PET_CLIPS.length);
    pet.dispose();
  });

  it("names the served file", () => {
    expect(PET_URL).toBe("/models/pet.glb");
  });
});
