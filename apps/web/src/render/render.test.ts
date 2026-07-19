// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { NullEngine, Scene } from "@babylonjs/core";
import { createScene } from "./engine";
import { SnapshotRenderer } from "./renderer";
import type { Snapshot } from "@pact/protocol";

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
      cooldowns: {},
      alive: true,
    },
    entities: [],
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

    const snap = makeSnapshot({ player: { id: 0, x: 2, y: 3, life: 100, maxLife: 100, mana: 60, maxMana: 60, cooldowns: {}, alive: true } });
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

    const s0 = makeSnapshot({ player: { id: 0, x: 0, y: 0, life: 100, maxLife: 100, mana: 60, maxMana: 60, cooldowns: {}, alive: true } });
    renderer.apply(null, s0, 1);
    const mesh = scene.getMeshByName("entity-0")!;
    expect(mesh.rotation.y).toBe(0); // idle: no heading yet

    // Move +x (world +x). Heading yaw = atan2(dx=5, dz=0) = PI/2, eased 0->PI/2 by 0.25.
    const s1 = makeSnapshot({ player: { id: 0, x: 5, y: 0, life: 100, maxLife: 100, mana: 60, maxMana: 60, cooldowns: {}, alive: true } });
    renderer.apply(s0, s1, 1);
    expect(mesh.rotation.y).toBeCloseTo(Math.PI / 8, 4);
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
