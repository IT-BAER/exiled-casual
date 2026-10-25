// @vitest-environment node
import { describe, it, expect, afterAll, afterEach, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NullEngine, Scene, type Mesh, type Node, type PBRMaterial, type StandardMaterial, type TransformNode } from "@babylonjs/core";
import {
  ANCHOR_BONE, CLIP_SECONDS, FOLLOW, PET_ACTIONS, PET_CLIPS, PET_ID, PET_URL, PetActor, RELAXED_CHANCE,
  cloudRate, followTarget, loadPet, isPetReady, resetPet, stepFollow,
  type FollowState, type PetClip,
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

describe("pet clouds", () => {
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
    animations: { name: string; samplers: { input: number }[] }[];
    accessors: { max?: number[] }[];
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

  it("runs PoE's four floating clips at PoE's lengths", () => {
    // idle_floating 2.0 s, run_floating 1.2 s, idle_relaxed_floating 14.67 s, happy_floating 3.0 s.
    expect(PET_CLIPS).toEqual(["hover", "gallop", "relaxed", "emerge"]);
    expect(CLIP_SECONDS).toEqual({ hover: 2.0, gallop: 1.2, relaxed: 14.67, emerge: 3.0 });
    for (const clip of PET_CLIPS) {
      const anim = json.animations.find((a) => a.name === `${PET_ID}|${clip}`)!;
      const end = Math.max(...anim.samplers.map((sm) => json.accessors[sm.input]!.max![0]!));
      expect(end, clip).toBeCloseTo(CLIP_SECONDS[clip], 1);
    }
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

/** Step `pet` `seconds` at 60 Hz with the player standing at (px, pz) facing +z. */
function stand(pet: PetActor, seconds: number, px = 0, pz = 0, seen?: PetClip[]): void {
  for (let i = 0; i < seconds * 60; i++) {
    pet.update(1 / 60, px, pz, { x: 0, y: 1 }, true, false);
    if (seen && pet.playing !== seen[seen.length - 1]) seen.push(pet.playing!);
  }
}

/** The lowest the posed body's middle goes through `clip`, frame by frame. */
function lowestThrough(pet: PetActor, clip: PetClip): number {
  pet.previewAction(clip);
  const group = pet.clipGroups.get(clip)!;
  // Restarted unblended, so a frame jumped to is that frame.
  group.enableBlending = false;
  pet.previewAction(clip);
  const middle = pet.root.getDescendants(false).find((n) => n.name === ANCHOR_BONE) as TransformNode;
  expect(middle, ANCHOR_BONE).toBeDefined();
  const chain: TransformNode[] = [];
  for (let n: Node | null = middle; n; n = n.parent) chain.unshift(n as TransformNode);
  let low = Infinity;
  for (let f = group.from; f <= group.to; f += 1) {
    group.goToFrame(f);
    for (const n of chain) n.computeWorldMatrix(true);
    low = Math.min(low, middle.getAbsolutePosition().y);
  }
  return low;
}

describe("pet actor", () => {
  it("loads through the real loader and stands the cat's root on the ground with every clip", async () => {
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
    // PoE's clips carry the cat's height above the ground: the root stays on it.
    expect(pet.root.position.y).toBe(0);
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

  it("emerges on arrival and after an area change, then hovers", async () => {
    const scene = newScene();
    await loadPet(scene);
    const pet = new PetActor(scene, 1);
    const seen: PetClip[] = [];
    stand(pet, CLIP_SECONDS.emerge + 0.5, 0, 0, seen);
    expect(seen.slice(0, 2)).toEqual(["emerge", "hover"]);
    pet.update(1 / 60, 40, 40, { x: 0, y: 1 }, true, true);
    expect(pet.playing).toBe("emerge");
    pet.dispose();
  });

  it("gallops when left behind, cutting a one-shot short, and hovers again beside him", async () => {
    const scene = newScene();
    await loadPet(scene);
    const pet = new PetActor(scene, 1);
    pet.update(1 / 60, 0, 0, { x: 0, y: 1 }, true, false);
    expect(pet.playing).toBe("emerge");
    // The player is suddenly nine units away: the cat gallops after him in the air.
    for (let i = 0; i < 40; i++) pet.update(1 / 60, 0, 9, { x: 0, y: 1 }, true, false);
    expect(pet.playing).toBe("gallop");
    expect(pet.root.position.y).toBe(0);
    // Walking on beside him, it settles into the hover.
    for (let i = 0; i < 240; i++) pet.update(1 / 60, 0, 9 + i / 300, { x: 0, y: 1 }, true, false);
    expect(pet.playing).toBe("hover");
    pet.dispose();
  });

  it("rolls PoE's relaxed idle once per hover cycle while he stands, seeded", async () => {
    expect(RELAXED_CHANCE).toBe(0.25);
    const scene = newScene();
    await loadPet(scene);
    const runs = (seed: number): PetClip[] => {
      const pet = new PetActor(scene, seed);
      const seen: PetClip[] = [];
      stand(pet, 60, 0, 0, seen);
      pet.dispose();
      return seen;
    };
    const seen = runs(7);
    expect(seen[0]).toBe("emerge");
    expect(seen).toContain("relaxed");
    // Every relaxed ends back in the hover; nothing else plays while he stands.
    for (const [i, clip] of seen.entries()) {
      expect(["emerge", "hover", "relaxed"]).toContain(clip);
      if (clip === "relaxed" && i + 1 < seen.length) expect(seen[i + 1]).toBe("hover");
    }
    // The same seed plays the same idle; a walking player never sees it.
    expect(runs(7)).toEqual(seen);
    const pet = new PetActor(scene, 7);
    const walked: PetClip[] = [];
    for (let i = 0; i < 60 * 60; i++) {
      pet.update(1 / 60, 0, i / 300, { x: 0, y: 1 }, true, false);
      if (pet.playing !== walked[walked.length - 1]) walked.push(pet.playing!);
    }
    expect(walked).not.toContain("relaxed");
    pet.dispose();
  });

  it("always floats: no clip takes the body under the hover's lowest", async () => {
    const scene = newScene();
    await loadPet(scene);
    const pet = new PetActor(scene);
    const hover = lowestThrough(pet, "hover");
    // Held at his hip, as PoE's cat beside a Marauder.
    expect(hover).toBeGreaterThan(0.5);
    expect(hover).toBeLessThan(1.2);
    for (const clip of ["gallop", "relaxed", "emerge"] as const) {
      expect(lowestThrough(pet, clip), clip).toBeGreaterThan(hover - 0.05);
    }
    pet.dispose();
  });

  it("previews any clip in place for the viewer, the one-shots repeating", async () => {
    const scene = newScene();
    await loadPet(scene);
    const pet = new PetActor(scene);
    pet.previewAction("relaxed");
    pet.previewTick(1 / 60);
    expect(pet.playing).toBe("relaxed");
    expect(pet.root.position.x).toBe(0);
    expect(pet.root.position.z).toBe(0);
    expect(pet.root.position.y).toBe(0);
    pet.previewAction("emerge");
    for (let i = 0; i < 60 * 7; i++) pet.previewTick(1 / 60);
    expect(pet.playing).toBe("emerge");
    expect(pet.clipGroups.get("emerge")!.isPlaying).toBe(true);
    expect(PET_ACTIONS).toEqual(PET_CLIPS);
    expect(pet.clipGroups.size).toBe(PET_CLIPS.length);
    pet.dispose();
  });

  it("names the served file", () => {
    expect(PET_URL).toBe("/models/pet.glb");
  });
});
