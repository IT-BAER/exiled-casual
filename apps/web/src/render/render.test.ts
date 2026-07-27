// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { NullEngine, Scene, StandardMaterial } from "@babylonjs/core";
import { createScene } from "./engine";
import { SnapshotRenderer } from "./renderer";
import { makeMesh, updateTelegraph } from "./meshes";
import type { Snapshot } from "@exiled/protocol";
import { testPlayer, testStats } from "../test-fixtures";

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    tick: 1,
    player: {
      id: 0,
      x: 0,
      y: 0,
      life: 100,
      maxLife: 100,
      mana: 60,
      maxMana: 60,
      energyShield: 0, maxEnergyShield: 0,
      cooldowns: {},
      alive: true,
      casting: false, level: 65, xp: 0, xpToNext: 60_000, gold: 0,
      flasks: { lifeCharges: 7, lifeMax: 7, manaCharges: 7, manaMax: 7 }, stats: testStats(),
    },
    area: "map",
    portalsLeft: 0,
    mapOpen: false,
    areaTier: 0,
    atlasSeed: 0,
    completedNodes: [], waystones: [],
    entities: [],
    inventory: { cols: 12, rows: 5, items: [] },
    stash: { cols: 12, rows: 12, items: [] },
    vendor: { cols: 12, rows: 12, items: [] },
    shards: {},
    equipment: {},
    ...overrides,
  };
}

let engine: InstanceType<typeof NullEngine>;

afterEach(() => {
  engine?.dispose();
});

describe("SnapshotRenderer", () => {
  it("creates a mesh for the player on first apply", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);

    const snap = makeSnapshot({ player: testPlayer({ x: 2, y: 3 }) });
    renderer.apply(null, snap, 1);

    // Player mesh positioned at x=2, z=3
    const playerMesh = scene.getMeshByName("entity-0");
    expect(playerMesh).not.toBeNull();
    expect(playerMesh!.position.x).toBeCloseTo(2);
    expect(playerMesh!.position.z).toBeCloseTo(3);
  });

  it("turns the player to face its movement direction", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);

    const s0 = makeSnapshot({ player: testPlayer() });
    renderer.apply(null, s0, 1);
    const mesh = scene.getMeshByName("entity-0")!;
    // Spawned facing south (toward the camera), holding that until it moves.
    expect(mesh.rotation.y).toBeCloseTo(Math.PI, 6);

    // Move +x (world +x). Heading yaw = atan2(dx=5, dz=0) = PI/2; the shortest
    // path from PI is -PI/2, eased by 0.25 → PI - PI/8.
    const s1 = makeSnapshot({ player: testPlayer({ x: 5 }) });
    renderer.apply(s0, s1, 1);
    expect(mesh.rotation.y).toBeCloseTo(Math.PI - Math.PI / 8, 4);
  });

  it("swings a monster's legs while it walks and rests them when it stops", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);

    const s0 = makeSnapshot({ entities: [{ id: 1, kind: "monster", x: 0, y: 0 }] });
    renderer.apply(null, s0, 1);
    const leg = scene.getMeshByName("leg0")!;
    expect(leg.rotation.x).toBe(0);

    // Walk in small per-frame steps, the way the render loop actually calls in.
    let prev = s0;
    let peak = 0;
    for (let step = 1; step <= 24; step++) {
      const next = makeSnapshot({ entities: [{ id: 1, kind: "monster", x: step * 0.15, y: 0 }] });
      renderer.apply(prev, next, 1);
      peak = Math.max(peak, Math.abs(leg.rotation.x));
      prev = next;
    }
    expect(peak).toBeGreaterThan(0.2);

    // Standing still eases the legs back toward rest.
    for (let i = 0; i < 12; i++) renderer.apply(prev, prev, 1);
    expect(Math.abs(leg.rotation.x)).toBeLessThan(0.02);
  });

  it("creates meshes for each entity and places them correctly", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);

    const snap = makeSnapshot({
      entities: [
        { id: 1, kind: "monster", x: 5, y: -2 },
        { id: 2, kind: "projectile", x: 1, y: 1, radius: 0.4 },
      ],
    });
    renderer.apply(null, snap, 1);

    const m1 = scene.getMeshByName("entity-1");
    const m2 = scene.getMeshByName("entity-2");
    expect(m1).not.toBeNull();
    expect(m1!.position.x).toBeCloseTo(5);
    expect(m1!.position.z).toBeCloseTo(-2);
    expect(m2).not.toBeNull();
  });

  it("disposes the mesh when an entity disappears in a subsequent snapshot", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);

    const snap1 = makeSnapshot({
      entities: [{ id: 1, kind: "monster", x: 0, y: 0 }],
    });
    renderer.apply(null, snap1, 1);
    expect(scene.getMeshByName("entity-1")).not.toBeNull();

    const snap2 = makeSnapshot({ entities: [] });
    renderer.apply(snap1, snap2, 1);
    expect(scene.getMeshByName("entity-1")).toBeNull();
  });

  it("monster count matches entity list", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);

    const snap = makeSnapshot({
      entities: [
        { id: 1, kind: "monster", x: 1, y: 0 },
        { id: 2, kind: "monster", x: 2, y: 0 },
        { id: 3, kind: "monster", x: 3, y: 0 },
      ],
    });
    renderer.apply(null, snap, 1);

    const monsters = scene.meshes.filter((m) =>
      [1, 2, 3].includes(parseInt(m.name.replace("entity-", ""), 10)),
    );
    expect(monsters.length).toBe(3);
  });
});

describe("createScene", () => {
  it("includes a pickable ground plane so click-to-move/aim can raycast", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);

    // bindings.ts gates click-to-move and pointer aim on scene.pick().hit; a
    // missing or unpickable ground makes empty-space picks miss entirely.
    const ground = scene.getMeshByName("ground");
    expect(ground).not.toBeNull();
    expect(ground!.isPickable).toBe(true);
  });
});

describe("makeMesh kinds", () => {
  it("makeMesh boss produces a mesh", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const mesh = makeMesh(scene, "boss", "test-boss");
    expect(mesh).not.toBeNull();
  });

  it("makeMesh telegraph produces a mesh", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const mesh = makeMesh(scene, "telegraph", "test-tel");
    expect(mesh).not.toBeNull();
  });

  it("boss mesh scaling is 2.0, distinguishing it from plain monster (1.0)", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const boss = makeMesh(scene, "boss", "b");
    const monster = makeMesh(scene, "monster", "m");
    expect(boss.scaling.x).toBeCloseTo(2.0);
    expect(monster.scaling.x).toBeCloseTo(1.0);
  });

  it("updateTelegraph sets fill alpha to ~0.12 at progress 0 and ~0.30 at progress 1", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const mesh = makeMesh(scene, "telegraph", "tel-alpha");
    const parts = mesh.metadata as { fill: StandardMaterial };

    updateTelegraph(mesh, 0);
    expect(parts.fill.alpha).toBeCloseTo(0.12, 2);

    updateTelegraph(mesh, 1);
    expect(parts.fill.alpha).toBeCloseTo(0.30, 2);
  });
});

describe("SnapshotRenderer — new kinds", () => {
  it("applies a snapshot with a telegraph entity without throwing", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);
    const snap = makeSnapshot({
      entities: [{ id: 5, kind: "telegraph", x: 3, y: 2, radius: 4, progress: 0.5 }],
    });
    expect(() => renderer.apply(null, snap, 1)).not.toThrow();
  });

  it("scales telegraph mesh x/z to entity.radius", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);
    const snap = makeSnapshot({
      entities: [{ id: 6, kind: "telegraph", x: 0, y: 0, radius: 3.5, progress: 0 }],
    });
    renderer.apply(null, snap, 1);
    const mesh = scene.getMeshByName("entity-6");
    expect(mesh).not.toBeNull();
    expect(mesh!.scaling.x).toBeCloseTo(3.5);
  });

  it("boss:true monster entity gets boss mesh (scaling ~2.0)", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);
    const snap = makeSnapshot({
      entities: [{ id: 7, kind: "monster", x: 0, y: 0, boss: true, bossPhase: 1, life: 1000, maxLife: 1000 }],
    });
    renderer.apply(null, snap, 1);
    const mesh = scene.getMeshByName("entity-7");
    expect(mesh).not.toBeNull();
    expect(mesh!.scaling.x).toBeCloseTo(2.0);
  });
});

describe("rare element aura", () => {
  it("two rares of different elements light different colours", () => {
    const engine = new NullEngine();
    const { scene } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);

    const snap = makeSnapshot({
      entities: [
        { id: 1, kind: "monster", x: 0, y: 0, rare: true, element: "cold", life: 10, maxLife: 10 },
        { id: 2, kind: "monster", x: 4, y: 0, rare: true, element: "chaos", life: 10, maxLife: 10 },
      ],
    });
    renderer.apply(null, snap, 1);

    const aura = (id: number) =>
      scene.getMaterialByName(`entity-${id}-aura`) as StandardMaterial;
    // Cold reads blue, chaos reads violet — and neither is the other.
    expect(aura(1).emissiveColor.b).toBeGreaterThan(aura(1).emissiveColor.r);
    expect(aura(2).emissiveColor.r).toBeGreaterThan(aura(1).emissiveColor.r);
    expect(aura(2).emissiveColor.g).toBeLessThan(aura(1).emissiveColor.g);
  });

  it("an ordinary monster gets no aura at all", () => {
    const engine = new NullEngine();
    const { scene } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);
    renderer.apply(null, makeSnapshot({ entities: [{ id: 3, kind: "monster", x: 0, y: 0, life: 10, maxLife: 10 }] }), 1);
    expect(scene.getMaterialByName("entity-3-aura")).toBeNull();
  });
});

describe("wheel zoom", () => {
  /**
   * How much ground the screen shows front-to-back. The camera looks down at
   * `90° - beta`, so a vertical span of `2 * orthoTop` lands on the floor
   * stretched by `1 / cos(beta)`.
   */
  const groundDepth = (camera: { orthoTop: number | null; beta: number }): number =>
    (2 * camera.orthoTop!) / Math.cos(camera.beta);

  it("zooming in shows less of the map ahead, not more", () => {
    const engine = new NullEngine();
    const { camera, setZoom } = createScene(engine);
    const wide = groundDepth(camera);
    const wideBeta = camera.beta;

    // Every notch in has to shrink the forward view. The pitch shallows as it
    // goes — that is the curve — and shallowing alone would show *more* ground,
    // so this is the guard that the curve never outruns the zoom.
    let previous = wide;
    for (let notch = 0; notch < 12; notch++) {
      setZoom(-1);
      const depth = groundDepth(camera);
      expect(depth).toBeLessThan(previous);
      previous = depth;
    }
    expect(camera.beta).toBeGreaterThan(wideBeta); // shallower up close, as PoE
    expect(groundDepth(camera)).toBeLessThan(wide * 0.85);
  });

  it("holds the shipped framing until the wheel is touched", () => {
    const engine = new NullEngine();
    const { camera } = createScene(engine);
    expect(camera.orthoTop).toBeCloseTo(4.75, 6);
    expect(camera.beta).toBeCloseTo(0.72, 6);
  });

  it("clamps at the near stop", () => {
    const engine = new NullEngine();
    const { camera, setZoom } = createScene(engine);
    // Scrolling past a stop must settle on it rather than creep through: the
    // clamp is on the target, so the eased position approaches and never passes.
    for (let i = 0; i < 40; i++) setZoom(-1);
    expect(camera.orthoTop).toBeCloseTo(3.2, 2);
    expect(camera.orthoTop).toBeGreaterThanOrEqual(3.2);
  });

  it("never zooms out past the authored framing", () => {
    const engine = new NullEngine();
    const { camera, setZoom } = createScene(engine);
    // The widest shot is the composed one. Scrolling out from rest must do
    // nothing at all, and scrolling out after zooming in must stop there.
    for (let i = 0; i < 20; i++) setZoom(1);
    expect(camera.orthoTop).toBeCloseTo(4.75, 6);
    expect(camera.beta).toBeCloseTo(0.72, 6);

    setZoom(-4);
    for (let i = 0; i < 80; i++) setZoom(1);
    expect(camera.orthoTop).toBeCloseTo(4.75, 2);
    expect(camera.orthoTop).toBeLessThanOrEqual(4.75);
  });

  it("keeps the shadow frustum around the visible floor at every zoom", () => {
    const engine = new NullEngine();
    const { scene, camera, setZoom } = createScene(engine);
    const sun = scene.getLightByName("sun") as unknown as { orthoRight: number };
    const aspect = engine.getRenderWidth() / engine.getRenderHeight();
    // Half the screen diagonal on the floor: the corner is the part that falls
    // off a frustum sized for the middle.
    const covered = () =>
      sun.orthoRight >
      Math.hypot(camera.orthoTop! * aspect, camera.orthoTop! / Math.cos(camera.beta));

    expect(covered()).toBe(true);
    for (let i = 0; i < 20; i++) {
      setZoom(-1);
      expect(covered()).toBe(true);
    }
  });
});
