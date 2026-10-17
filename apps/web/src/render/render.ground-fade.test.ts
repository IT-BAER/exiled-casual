// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import { Color3, Color4, MeshBuilder, NullEngine, StandardMaterial } from "@babylonjs/core";
import type { AbstractMesh, GlowLayer, Mesh } from "@babylonjs/core";
import { createScene } from "./engine";
import { SnapshotRenderer } from "./renderer";
import type { GroundEmbers } from "./skill-fx";
import { glowFollowsErosion, groundErosion, GROUND_FADE_TICKS, IGNITE_TICKS } from "./ground-fx";
import type { AreaKind, Snapshot, SnapshotEntity } from "@exiled/protocol";
import { testPlayer } from "../test-fixtures";

function snap(tick: number, entities: SnapshotEntity[] = [], area: AreaKind = "map"): Snapshot {
  return {
    tick, player: testPlayer(), area, portalsLeft: 0, mapOpen: false, areaTier: 0, atlasSeed: 0,
    completedNodes: [], entities,
    inventory: { cols: 12, rows: 5, items: [] }, stash: { cols: 12, rows: 12, items: [] },
    vendor: { cols: 12, rows: 12, items: [] }, shards: {}, equipment: {},
  };
}

const patch: SnapshotEntity = { id: 7, kind: "groundArea", x: 2, y: 2, radius: 2.5, skillId: "cinder_ground" };

let engine: InstanceType<typeof NullEngine>;
afterEach(() => engine?.dispose());

function setup() {
  engine = new NullEngine();
  const { scene } = createScene(engine);
  return { scene, r: new SnapshotRenderer(scene) };
}

describe("a ground effect the sim spawned", () => {
  it("ignites over a short head instead of popping in whole", () => {
    const { scene, r } = setup();
    r.apply(null, snap(1, [patch]), 1);
    const mesh = scene.getMeshByName("entity-7")!;
    const embers = (mesh.metadata as { embers: GroundEmbers }).embers;
    expect(groundErosion(mesh)).toBeGreaterThan(0.8);
    const flare = embers.emitRate;

    r.apply(snap(1, [patch]), snap(1 + IGNITE_TICKS, [patch]), 1);
    expect(groundErosion(mesh)).toBe(0);
    expect(embers.emitRate).toBeLessThan(flare);
  });

  it("gives every patch its own material, so one burning out leaves the others whole", () => {
    const { scene, r } = setup();
    r.apply(null, snap(1, [patch, { ...patch, id: 8, x: 9 }]), 1);
    const a = scene.getMeshByName("entity-7")!;
    const b = scene.getMeshByName("entity-8")!;
    expect(a.material).not.toBe(b.material);
    expect((a.material as StandardMaterial).emissiveTexture).toBe((b.material as StandardMaterial).emissiveTexture);
  });
});

describe("the bloom over a ground patch", () => {
  it("dims with the erosion and leaves every other mesh at the layer's default", () => {
    const { scene, r } = setup();
    r.apply(null, snap(1, [patch]), 1);
    const mesh = scene.getMeshByName("entity-7")!;
    const glow = { neutralColor: new Color4(0, 0, 0, 0) } as unknown as GlowLayer;
    glowFollowsErosion(glow);
    const pick = glow.customEmissiveColorSelector!;
    const seen = (m: AbstractMesh, mat: StandardMaterial) => {
      const out = new Color4();
      pick(m as Mesh, null as never, mat, out);
      return out;
    };

    const other = MeshBuilder.CreateBox("other", {}, scene);
    const lamp = new StandardMaterial("lamp", scene);
    lamp.emissiveColor = new Color3(0.5, 0.25, 1);
    other.material = lamp;
    expect(seen(other, lamp).asArray()).toEqual([0.5, 0.25, 1, 1]);

    const mat = mesh.material as StandardMaterial;
    const catching = seen(mesh, mat).r;
    r.apply(snap(1, [patch]), snap(1 + IGNITE_TICKS, [patch]), 1);
    const whole = seen(mesh, mat).r;
    expect(whole).toBeCloseTo(mat.emissiveColor.r);
    expect(catching).toBeLessThan(whole * 0.1);
  });
});

describe("a ground effect the sim removed", () => {
  it("erodes away at its own size and lets its embers finish", () => {
    const { scene, r } = setup();
    const s0 = snap(1, [patch]);
    r.apply(null, s0, 1);
    const lit = snap(1 + IGNITE_TICKS, [patch]);
    r.apply(s0, lit, 1);
    const mesh = scene.getMeshByName("entity-7")!;
    const width = mesh.scaling.x;
    const mat = mesh.material as StandardMaterial;
    const cracks = mat.emissiveTexture!;
    const embers = (mesh.metadata as { embers: GroundEmbers }).embers;
    const stop = vi.spyOn(embers, "stop");

    let prev = snap(2 + IGNITE_TICKS);
    r.apply(lit, prev, 1);
    expect(mesh.isDisposed()).toBe(false);

    const mid = snap(prev.tick + Math.floor(GROUND_FADE_TICKS / 2));
    r.apply(prev, mid, 1);
    prev = mid;
    expect(groundErosion(mesh)).toBeGreaterThan(0);
    expect(groundErosion(mesh)).toBeLessThan(1);
    expect(mesh.scaling.x).toBe(width);
    expect(stop).not.toHaveBeenCalled();

    const out = snap(mid.tick + GROUND_FADE_TICKS);
    r.apply(prev, out, 1);
    prev = out;
    expect(groundErosion(mesh)).toBe(1);
    expect(stop).toHaveBeenCalled();
    expect(mesh.isDisposed()).toBe(false);

    const end = snap(out.tick + GROUND_FADE_TICKS * 3);
    r.apply(prev, end, 1);
    expect(mesh.isDisposed()).toBe(true);
    expect(scene.materials).not.toContain(mat);
    expect(scene.textures).toContain(cracks);
  });

  it("does not follow the player across an area change", () => {
    const { scene, r } = setup();
    const s0 = snap(1, [patch]);
    r.apply(null, s0, 1);
    const mesh = scene.getMeshByName("entity-7")!;
    r.apply(s0, snap(2, [], "hideout"), 1);
    expect(mesh.isDisposed()).toBe(true);
  });
});
