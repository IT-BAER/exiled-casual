// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { Mesh, NullEngine, PBRMaterial, Vector3, VertexBuffer, VertexData, type AbstractMesh, type Scene, type StandardMaterial } from "@babylonjs/core";
import type { Snapshot, SnapshotEntity } from "@exiled/protocol";
import { BROOD_ABILITY } from "./boss-tells";
import { createScene } from "./engine";
import { warmEntityLooks } from "./meshes";
import { SnapshotRenderer } from "./renderer";
import { addRim } from "./rim";
import { testPlayer } from "../test-fixtures";

let engine: InstanceType<typeof NullEngine>;
afterEach(() => engine?.dispose());

function snapshot(tick: number, entities: SnapshotEntity[]): Snapshot {
  return {
    tick, player: testPlayer({ x: 20, y: 20 }), area: "map", portalsLeft: 0, mapOpen: false, areaTier: 0,
    atlasSeed: 0, completedNodes: [], entities,
    inventory: { cols: 12, rows: 5, items: [] }, stash: { cols: 12, rows: 12, items: [] },
    vendor: { cols: 12, rows: 12, items: [] }, shards: {}, equipment: {},
  };
}

function setup() {
  engine = new NullEngine();
  const { scene } = createScene(engine);
  return { scene, renderer: new SnapshotRenderer(scene) };
}

/**
 * A part of entity `id` by name, as its vertices on the floor (world x, z). Not
 * the bounding box: the root carries a spawn yaw, and a turned box is wider than
 * the circle in it.
 */
function part(scene: ReturnType<typeof setup>["scene"], id: number, name: string) {
  const root = scene.getMeshByName(`entity-${id}`)!;
  const mesh = root.getChildMeshes().find((m) => m.name === name) as AbstractMesh | undefined;
  if (!mesh) throw new Error(`entity-${id} has no ${name}: ${root.getChildMeshes().map((m) => m.name).join(", ")}`);
  const chain: AbstractMesh[] = [];
  for (let n: AbstractMesh | null = mesh; n; n = n.parent as AbstractMesh | null) chain.unshift(n);
  for (const n of chain) n.computeWorldMatrix(true);
  const local = mesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
  const points: { x: number; z: number }[] = [];
  for (let i = 0; i < local.length; i += 3) {
    const p = Vector3.TransformCoordinates(new Vector3(local[i]!, local[i + 1]!, local[i + 2]!), mesh.getWorldMatrix());
    points.push({ x: p.x, z: p.z });
  }
  return {
    mesh,
    /** Farthest vertex from (x, z). */
    reach: (x: number, z: number) => Math.max(...points.map((p) => Math.hypot(p.x - x, p.z - z))),
    /** Nearest vertex to (x, z). */
    nearest: (x: number, z: number) => Math.min(...points.map((p) => Math.hypot(p.x - x, p.z - z))),
    /** [min, max] of the vertices along the unit direction (dx, dz) from (x, z). */
    along: (x: number, z: number, dx: number, dz: number) => {
      const t = points.map((p) => (p.x - x) * dx + (p.z - z) * dz);
      return [Math.min(...t), Math.max(...t)] as const;
    },
  };
}

/** Wound to face the camera: Babylon culls by winding, and hand-written +Y normals cannot show it. */
function facesUp(mesh: AbstractMesh): boolean {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const derived = new Float32Array(pos.length);
  VertexData.ComputeNormals(pos, mesh.getIndices()!, derived);
  for (let i = 1; i < derived.length; i += 3) if (!(derived[i]! > 0.9)) return false;
  return true;
}

describe("a heavy's disc says when it lands", () => {
  it("grows a bright front from the centre that meets the rim at impact", () => {
    const { scene, renderer } = setup();
    renderer.apply(null, snapshot(1, [{ id: 5, kind: "telegraph", x: 3, y: -1, radius: 4, progress: 0.5 }]), 1);
    expect(part(scene, 5, "telegraph-front").reach(3, -1)).toBeCloseTo(2, 1);

    renderer.apply(null, snapshot(2, [{ id: 5, kind: "telegraph", x: 3, y: -1, radius: 4, progress: 1 }]), 1);
    expect(part(scene, 5, "telegraph-front").reach(3, -1)).toBeCloseTo(4, 1);
  });
});

describe("a lane covers exactly what the sim hits", () => {
  // Magma Rift: 9 long, 1.8 wide, cast from (2, 1) along (0.6, 0.8).
  const rift = (tick: number, progress: number): SnapshotEntity => ({
    id: 8, kind: "telegraph", x: 2, y: 1, radius: 0.9, progress, shape: "line", dirX: 0.6, dirY: 0.8, length: 9, heavy: true,
  });

  it("runs from the boss, flat there and round past its length, as wide as the hit", () => {
    const { scene, renderer } = setup();
    renderer.apply(null, snapshot(1, [rift(1, 0.25)]), 1);
    const fill = part(scene, 8, "lane-fill");
    const [from, to] = fill.along(2, 1, 0.6, 0.8);
    expect(from).toBeCloseTo(0, 2);
    expect(to).toBeCloseTo(9.9, 2);
    const [left, right] = fill.along(2, 1, 0.8, -0.6);
    expect(left).toBeCloseTo(-0.9, 2);
    expect(right).toBeCloseTo(0.9, 2);
    // The rim is the same outline, drawn as a line.
    expect(part(scene, 8, "lane-rim").along(2, 1, 0.6, 0.8)[1]).toBeCloseTo(9.9, 1);
    expect(facesUp(part(scene, 8, "lane-fill").mesh)).toBe(true);
    expect(facesUp(part(scene, 8, "lane-rim").mesh)).toBe(true);
  });

  it("sends its front from the boss to the far end, landing there on impact", () => {
    const { scene, renderer } = setup();
    renderer.apply(null, snapshot(1, [rift(1, 0.25)]), 1);
    const [a, b] = part(scene, 8, "lane-front").along(2, 1, 0.6, 0.8);
    expect((a + b) / 2).toBeCloseTo(0.25 * 9.9, 1);

    renderer.apply(null, snapshot(2, [rift(2, 1)]), 1);
    expect(part(scene, 8, "lane-front").along(2, 1, 0.6, 0.8)[1]).toBeLessThanOrEqual(9.9 + 0.05);
    expect(part(scene, 8, "lane-front").along(2, 1, 0.6, 0.8)[1]).toBeGreaterThan(9.7);
  });
});

describe("a ring leaves its hole empty", () => {
  // Kiln Ring: safe inside 2.4 of Sirrath at (-4, 6) or beyond 7.
  const kiln = (progress: number): SnapshotEntity => ({
    id: 9, kind: "telegraph", x: -4, y: 6, radius: 7, inner: 2.4, progress, shape: "ring", heavy: true,
  });

  it("fills only the band, with a rim at each edge", () => {
    const { scene, renderer } = setup();
    renderer.apply(null, snapshot(1, [kiln(0.2)]), 1);
    const fill = part(scene, 9, "ring-fill");
    expect(fill.nearest(-4, 6)).toBeCloseTo(2.4, 1);
    expect(fill.reach(-4, 6)).toBeCloseTo(7, 1);
    expect(facesUp(fill.mesh)).toBe(true);
    expect(part(scene, 9, "ring-rim-inner").reach(-4, 6)).toBeCloseTo(2.4, 1);
    expect(part(scene, 9, "ring-rim-outer").reach(-4, 6)).toBeCloseTo(7, 1);
  });

  it("closes its front from the outer edge in to the hole", () => {
    const { scene, renderer } = setup();
    renderer.apply(null, snapshot(1, [kiln(0.5)]), 1);
    expect(part(scene, 9, "ring-front").reach(-4, 6)).toBeCloseTo(4.7, 1);
    renderer.apply(null, snapshot(2, [kiln(1)]), 1);
    expect(part(scene, 9, "ring-front").reach(-4, 6)).toBeCloseTo(2.4, 1);
  });
});

describe("a brood mark says something rises here, not that it hurts", () => {
  const mark = (tick: number) => snapshot(tick, [{ id: 10, kind: "telegraph", x: 5, y: 5, radius: 1.2, progress: tick / 24, ability: BROOD_ABILITY }]);

  it("is murky water, never the danger palette, and ripples while it waits", () => {
    const { scene, renderer } = setup();
    renderer.apply(null, mark(1), 1);
    const names = scene.getMeshByName("entity-10")!.getChildMeshes().map((m) => m.name);
    expect(names).not.toContain("telegraph-rim");
    const water = part(scene, 10, "brood-fill").mesh.material as StandardMaterial;
    expect(water.emissiveColor.r).toBeLessThan(water.emissiveColor.g);
    expect(part(scene, 10, "brood-fill").reach(5, 5)).toBeCloseTo(1.2, 1);

    const early = part(scene, 10, "brood-ripple-0").reach(5, 5);
    renderer.apply(null, mark(6), 1);
    expect(part(scene, 10, "brood-ripple-0").reach(5, 5)).toBeGreaterThan(early + 0.1);
  });
});

describe("a heavy wind-up lights the boss that winds it", () => {
  // The Warden at (0, 0), its Magma Rift on the floor ahead of it.
  const warden: SnapshotEntity = { id: 7, kind: "monster", boss: true, species: "monster.cinder_warden.v1", x: 0, y: 0 };
  const rift = (progress: number, impactIn: number, heavy = true): SnapshotEntity => ({
    id: 8, kind: "telegraph", x: 0, y: 0, radius: 0.9, progress, shape: "line", dirX: 0, dirY: 1, length: 9,
    ownerId: 7, impactIn, ...(heavy ? { heavy: true } : {}),
  });

  /** A hide under the boss: headless it is a greybox, and only a creature's materials carry the rim. */
  function hide(scene: Scene): Mesh {
    const body = new Mesh("body", scene);
    body.parent = scene.getMeshByName("entity-7");
    const material = new PBRMaterial("hide", scene);
    addRim(material);
    body.material = material;
    return body;
  }
  const glow = (m: Mesh) => (m.metadata as { dangerGlow?: number } | null)?.dangerGlow ?? 0;

  it("glows red through the wind-up and lets go when the blow lands", () => {
    const { scene, renderer } = setup();
    renderer.apply(null, snapshot(1, [warden]), 1);
    const body = hide(scene);
    renderer.apply(null, snapshot(2, [warden, rift(0.5, 0.5)]), 1);
    expect(glow(body)).toBeGreaterThan(0);
    renderer.apply(null, snapshot(3, [warden]), 1);
    expect(glow(body)).toBe(0);
  });

  it("stays dark for a volley's markers, which are many small hits", () => {
    const { scene, renderer } = setup();
    renderer.apply(null, snapshot(1, [warden]), 1);
    const body = hide(scene);
    renderer.apply(null, snapshot(2, [warden, rift(0.5, 0.5, false)]), 1);
    expect(glow(body)).toBe(0);
  });

  it("pulses faster as the blow nears and is brightest when it lands", () => {
    const { scene, renderer } = setup();
    renderer.apply(null, snapshot(1, [warden]), 1);
    const body = hide(scene);
    // A 1.2 s wind-up drawn at 120 frames a second: four frames per snapshot.
    const frames: { left: number; glow: number }[] = [];
    for (let t = 0; t < 36; t++) {
      for (let f = 0; f < 4; f++) {
        renderer.apply(null, snapshot(2 + t, [warden, rift(t / 36, (36 - t) / 30)]), f / 4);
        frames.push({ left: (36 - t - f / 4) / 30, glow: glow(body) });
      }
    }
    const troughs = (from: number, to: number) => frames.filter((s, i) =>
      i > 0 && i < frames.length - 1 && s.left <= from && s.left > to
      && s.glow < frames[i - 1]!.glow && s.glow <= frames[i + 1]!.glow).length;
    expect(troughs(0.5, 0)).toBeGreaterThan(troughs(1, 0.5));
    const last = frames[frames.length - 1]!.glow;
    expect(last).toBeGreaterThanOrEqual(Math.max(...frames.map((s) => s.glow)) - 0.02);
  });
});

describe("the boss marks cost nothing on first use and leave nothing behind", () => {
  const marks = (base: number): SnapshotEntity[] => [
    { id: base, kind: "telegraph", x: 0, y: 0, radius: 0.9, progress: 0.5, shape: "line", dirX: 1, dirY: 0, length: 9 },
    { id: base + 1, kind: "telegraph", x: 0, y: 0, radius: 7, inner: 2.4, progress: 0.5, shape: "ring" },
    { id: base + 2, kind: "telegraph", x: 0, y: 0, radius: 1.2, progress: 0.5, ability: BROOD_ABILITY },
  ];

  it("builds every mark behind the loading plate", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const release = warmEntityLooks(scene);
    const warmed = scene.meshes.map((m) => m.name);
    for (const name of ["lane-fill", "lane-front", "ring-fill", "ring-front", "brood-fill"]) expect(warmed).toContain(name);
    release();
  });

  it("releases each mark's materials when the area changes", () => {
    const { scene, renderer } = setup();
    const cross = (base: number, tick: number) => {
      renderer.apply(null, snapshot(tick, marks(base)), 1);
      renderer.apply(null, { ...snapshot(tick + 1, []), area: "hideout" }, 1);
    };
    cross(10, 1);
    const materials = scene.materials.length;
    cross(30, 3);
    cross(50, 5);
    expect(scene.materials.length).toBe(materials);
  });
});
