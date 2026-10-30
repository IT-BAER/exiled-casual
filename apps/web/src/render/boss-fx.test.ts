// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { NullEngine, Vector3, VertexBuffer, type AbstractMesh, type Scene } from "@babylonjs/core";
import type { Snapshot, SnapshotEntity } from "@exiled/protocol";
import { MONSTERS } from "@exiled/content-runtime";
import {
  BEAM_NAME, BEAM_SECONDS, BossFx, bossFx, FISSURE_NAME, FISSURE_SECONDS, SCORCH_NAME, THORN_NAME, warmBossFx,
} from "./boss-fx";
import { createScene } from "./engine";
import { fxPools } from "./fx-pool";
import { SnapshotRenderer } from "./renderer";
import { slamDebris } from "./slam-debris";
import { testPlayer } from "../test-fixtures";

let engine: InstanceType<typeof NullEngine>;
afterEach(() => engine?.dispose());

function snapshot(tick: number, entities: SnapshotEntity[], player = { x: 0, y: 0 }): Snapshot {
  return {
    tick, player: testPlayer(player), area: "map", portalsLeft: 0, mapOpen: false, areaTier: 0,
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

const warden: SnapshotEntity = { id: 7, kind: "monster", boss: true, species: "monster.cinder_warden.v1", x: 0, y: 4, bossPhase: 1 };
/** The Warden's slam, `left` seconds from landing on (0, 1). */
const slam = (left: number): SnapshotEntity => ({
  id: 20, kind: "telegraph", x: 0, y: 1, radius: 3.5, progress: 1 - left, ownerId: 7, impactIn: left, heavy: true,
});

/** Show a mark at `left` seconds out, then let it leave the snapshot. */
function land(renderer: SnapshotRenderer, mark: SnapshotEntity, owner: SnapshotEntity = warden, player = { x: 0, y: 0 }) {
  renderer.apply(null, snapshot(1, [owner, mark], player), 1);
  renderer.apply(null, snapshot(2, [owner], player), 1);
}

/** World-space vertices of an enabled mesh, projected on the unit direction (dx, dz) from (x, z). */
function along(mesh: AbstractMesh, x: number, z: number, dx: number, dz: number): [number, number] {
  mesh.computeWorldMatrix(true);
  const local = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const t: number[] = [];
  for (let i = 0; i < local.length; i += 3) {
    const p = Vector3.TransformCoordinates(new Vector3(local[i]!, local[i + 1]!, local[i + 2]!), mesh.getWorldMatrix());
    t.push((p.x - x) * dx + (p.z - z) * dz);
  }
  return [Math.min(...t), Math.max(...t)];
}

const shown = (scene: Scene, prefix: string) => scene.meshes.filter((m) => m.name.startsWith(prefix) && m.isEnabled());

describe("Magma Rift splits the floor along its lane", () => {
  // From the Warden at (0, 4) toward -y: 9 long, 1.8 wide.
  const rift = (left: number): SnapshotEntity => ({
    id: 22, kind: "telegraph", x: 0, y: 4, radius: 0.9, progress: 1 - left, shape: "line", dirX: 0, dirY: -1, length: 9,
    ownerId: 7, impactIn: left, heavy: true, ability: "magma_rift",
  });

  it("leaves a molten fissure the length of the lane that cools away", () => {
    const { scene, renderer } = setup();
    land(renderer, rift(1 / 30));
    const [molten] = shown(scene, FISSURE_NAME);
    expect(molten).toBeDefined();
    const [from, to] = along(molten!, 0, 4, 0, -1);
    expect(from).toBeGreaterThan(-0.5);
    expect(from).toBeLessThan(0.5);
    expect(to).toBeGreaterThan(8.5);
    expect(to).toBeLessThan(10);
    bossFx(scene).step(FISSURE_SECONDS + 0.1);
    expect(molten!.isEnabled()).toBe(false);
  });

  it("erupts in flame along the whole lane", () => {
    const { scene, renderer } = setup();
    land(renderer, rift(1 / 30));
    const from = fxPools(scene).glow.positions().map((p) => 4 - p.z);
    expect(Math.min(...from)).toBeLessThan(1.5);
    expect(Math.max(...from)).toBeGreaterThan(7.5);
  });
});

const sirrath: SnapshotEntity = { id: 8, kind: "monster", boss: true, species: "monster.sirrath.v1", x: 0, y: 4, bossPhase: 1 };

/** Each vertex's distance from (x, z) on the floor. */
function radii(mesh: AbstractMesh, x: number, z: number): number[] {
  mesh.computeWorldMatrix(true);
  const local = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const out: number[] = [];
  for (let i = 0; i < local.length; i += 3) {
    const p = Vector3.TransformCoordinates(new Vector3(local[i]!, local[i + 1]!, local[i + 2]!), mesh.getWorldMatrix());
    out.push(Math.hypot(p.x - x, p.z - z));
  }
  return out;
}

describe("the Kiln Ring burns its band and spares the hole", () => {
  // On Sirrath at (0, 4): safe inside 2.4 or beyond 7.
  const kiln = (left: number): SnapshotEntity => ({
    id: 23, kind: "telegraph", x: 0, y: 4, radius: 7, inner: 2.4, progress: 1 - left, shape: "ring",
    ownerId: 8, impactIn: left, heavy: true, ability: "kiln_ring",
  });

  it("raises flame across the band and none in the hole", () => {
    const { scene, renderer } = setup();
    land(renderer, kiln(1 / 30), sirrath);
    const r = fxPools(scene).glow.positions().map((p) => Math.hypot(p.x, p.z - 4));
    expect(r.length).toBeGreaterThan(20);
    expect(Math.min(...r)).toBeGreaterThanOrEqual(2.35);
    expect(Math.max(...r)).toBeLessThanOrEqual(7.05);
  });

  it("leaves a scorched band with the hole bare", () => {
    const { scene, renderer } = setup();
    land(renderer, kiln(1 / 30), sirrath);
    const [scorch] = shown(scene, SCORCH_NAME);
    expect(scorch).toBeDefined();
    const r = radii(scorch!, 0, 4);
    expect(Math.min(...r)).toBeCloseTo(2.4, 1);
    expect(Math.max(...r)).toBeCloseTo(7, 1);
  });
});

/** [lowest, highest] world-space vertex height of a mesh. */
function heights(mesh: AbstractMesh): [number, number] {
  mesh.computeWorldMatrix(true);
  const local = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const y: number[] = [];
  for (let i = 0; i < local.length; i += 3) {
    y.push(Vector3.TransformCoordinates(new Vector3(local[i]!, local[i + 1]!, local[i + 2]!), mesh.getWorldMatrix()).y);
  }
  return [Math.min(...y), Math.max(...y)];
}

describe("a Sunlance strikes its lane from above", () => {
  // From Sirrath at (0, 4) along +x: 12 long, 1.2 wide.
  const lance = (left: number): SnapshotEntity => ({
    id: 24, kind: "telegraph", x: 0, y: 4, radius: 0.6, progress: 1 - left, shape: "line", dirX: 1, dirY: 0, length: 12,
    ownerId: 8, impactIn: left, ability: "sunlance",
  });

  it("stands a beam of light on the whole lane, too low to wall off the view, briefly", () => {
    const { scene, renderer } = setup();
    land(renderer, lance(1 / 30), sirrath);
    const [beam] = shown(scene, BEAM_NAME);
    expect(beam).toBeDefined();
    const [from, to] = along(beam!, 0, 4, 1, 0);
    expect(from).toBeGreaterThan(-0.7);
    expect(from).toBeLessThan(0.3);
    expect(to).toBeGreaterThan(11.5);
    expect(to).toBeLessThan(13);
    const [low, high] = heights(beam!);
    expect(low).toBeCloseTo(0, 1);
    expect(high).toBeGreaterThan(2.5);
    expect(high).toBeLessThan(4);
    bossFx(scene).step(BEAM_SECONDS + 0.05);
    expect(shown(scene, BEAM_NAME)).toHaveLength(0);
  });

  it("leaves a scorch line where it struck", () => {
    const { scene, renderer } = setup();
    land(renderer, lance(1 / 30), sirrath);
    expect(shown(scene, FISSURE_NAME).length).toBeGreaterThan(0);
  });
});

describe("Cinder Rain drops burning rock into each marker", () => {
  // A marker r 1.3 round (2, -1), landing 1.2 s after it shows.
  const rain = (left: number): SnapshotEntity => ({
    id: 25, kind: "telegraph", x: 2, y: -1, radius: 1.3, progress: 1 - left / 1.2, ownerId: 7, impactIn: left, ability: "cinder_rain",
  });

  it("drops the rock in the marker's last moment, so it reaches the floor on the impact", () => {
    const { scene, renderer } = setup();
    const glow = fxPools(scene).glow;
    renderer.apply(null, snapshot(1, [warden, rain(0.9)]), 0);
    expect(glow.emitted, "still waiting").toBe(0);
    renderer.apply(null, snapshot(2, [warden, rain(0.3)]), 0);
    const [rock] = glow.positions();
    expect(rock!.y).toBeGreaterThan(5);
    expect(Math.hypot(rock!.x - 2, rock!.z + 1)).toBeLessThan(1);
    glow.step(0.29);
    const [fallen] = glow.positions();
    expect(fallen!.y).toBeLessThan(0.6);
    expect(Math.hypot(fallen!.x - 2, fallen!.z + 1)).toBeLessThan(0.3);
    renderer.apply(null, snapshot(3, [warden, rain(0.2)]), 0);
    expect(glow.emitted, "one rock per marker").toBe(1);
  });

  it("bursts into a fireball where it lands", () => {
    const { scene, renderer } = setup();
    land(renderer, rain(1 / 30));
    // The slam throws embers and a shockwave; only a meteor lands as a fireball.
    expect(fxPools(scene).glow.emitted).toBeGreaterThan(0);
    expect(slamDebris(scene).live, "a little rubble").toBeGreaterThan(0);
    expect(slamDebris(scene).live, "less than a slam's").toBeLessThan(40);
  });
});

describe("the bog stirs before it erupts", () => {
  const vhal: SnapshotEntity = { id: 9, kind: "monster", boss: true, species: "monster.mother_vhal.v1", x: 0, y: 4, bossPhase: 3 };
  const geyser = (left: number): SnapshotEntity => ({
    id: 26, kind: "telegraph", x: -2, y: 1, radius: 1.6, progress: 1 - left, ownerId: 9, impactIn: left, ability: "bog_geyser",
  });
  const brood = (left: number): SnapshotEntity => ({
    id: 27, kind: "telegraph", x: 3, y: 2, radius: 1.2, progress: 1 - left / 0.8, ownerId: 9, impactIn: left, ability: "brood",
  });

  it("bubbles in a geyser's marker while it waits, faster as it nears", () => {
    const { scene } = setup();
    const smoke = fxPools(scene).smoke;
    bossFx(scene).windup(geyser(0.9), 0.9, 0.5);
    const early = smoke.emitted;
    bossFx(scene).windup(geyser(0.1), 0.1, 0.5);
    expect(early).toBeGreaterThan(0);
    expect(smoke.emitted - early).toBeGreaterThan(early);
  });

  it("throws a column of bog water up out of the marker", () => {
    const { scene, renderer } = setup();
    land(renderer, geyser(1 / 30), vhal);
    expect(slamDebris(scene).live, "water, not rubble").toBe(0);
    const smoke = fxPools(scene).smoke;
    smoke.step(0.25);
    const over = smoke.positions().filter((p) => Math.hypot(p.x + 2, p.z - 1) < 1.6);
    expect(Math.max(...over.map((p) => p.y))).toBeGreaterThan(1.5);
  });

  it("splashes where the brood rises", () => {
    const { scene, renderer } = setup();
    land(renderer, brood(1 / 30), vhal);
    expect(slamDebris(scene).live, "water, not rubble").toBe(0);
    expect(fxPools(scene).ring.emitted).toBeGreaterThan(0);
    expect(fxPools(scene).smoke.emitted).toBeGreaterThan(0);
  });
});

describe("thorns burst where Ghaltrek strikes", () => {
  const ghaltrek: SnapshotEntity = { id: 10, kind: "monster", boss: true, species: "monster.ghaltrek.v1", x: 0, y: 4, bossPhase: 1 };
  // From Ghaltrek at (0, 4) toward -y: 8 long, 1.6 wide.
  const charge = (left: number): SnapshotEntity => ({
    id: 28, kind: "telegraph", x: 0, y: 4, radius: 0.8, progress: 1 - left, shape: "line", dirX: 0, dirY: -1, length: 8,
    ownerId: 10, impactIn: left, heavy: true, ability: "bramble_charge",
  });
  const nova = (left: number): SnapshotEntity => ({
    id: 29, kind: "telegraph", x: 0, y: 4, radius: 3, progress: 1 - left, ownerId: 10, impactIn: left, heavy: true, ability: "briar_nova",
  });
  const tall = (s: { base: Vector3; tip: Vector3 }) => s.tip.y - s.base.y > 0.2;

  it("thrusts spikes up the lane in a wave that runs at his charge, then sinks them", () => {
    const { scene, renderer } = setup();
    land(renderer, charge(1 / 30), ghaltrek);
    const fx = bossFx(scene);
    fx.step(0.12);
    const spikes = fx.thorns();
    expect(spikes.length).toBeGreaterThan(20);
    for (const s of spikes) {
      expect(4 - s.base.z).toBeGreaterThan(-0.1);
      expect(4 - s.base.z).toBeLessThan(8.9);
      expect(Math.abs(s.base.x)).toBeLessThanOrEqual(0.85);
    }
    // Up near him, not yet at the far end: the wave runs at 14 units a second.
    expect(spikes.filter(tall).some((s) => 4 - s.base.z < 1.5)).toBe(true);
    expect(spikes.filter(tall).every((s) => 4 - s.base.z < 3)).toBe(true);
    fx.step(3);
    expect(fx.thorns()).toHaveLength(0);
  });

  it("bursts a ring of spikes round him, leaning out", () => {
    const { scene, renderer } = setup();
    land(renderer, nova(1 / 30), ghaltrek);
    const fx = bossFx(scene);
    fx.step(0.3);
    const up = fx.thorns().filter(tall);
    expect(up.length).toBeGreaterThan(12);
    for (const s of up) {
      const base = Math.hypot(s.base.x, s.base.z - 4);
      expect(base).toBeLessThanOrEqual(3.05);
      expect(Math.hypot(s.tip.x, s.tip.z - 4)).toBeGreaterThan(base);
    }
  });
});

describe("the last phase announces itself, and heavy blows shake the camera", () => {
  it("bursts the boss's element, rings the floor and shakes on the way into phase 3, once", () => {
    const { scene, renderer } = setup();
    renderer.apply(null, snapshot(1, [{ ...warden, bossPhase: 2 }]), 1);
    expect(renderer.shakeTrauma).toBe(0);
    renderer.apply(null, snapshot(2, [{ ...warden, bossPhase: 3 }]), 1);
    const pools = fxPools(scene);
    expect(pools.ring.emitted).toBeGreaterThan(0);
    expect(pools.glow.emitted + pools.shards.emitted).toBeGreaterThan(0);
    expect(renderer.shakeTrauma).toBeGreaterThan(0);
    const rings = pools.ring.emitted;
    renderer.apply(null, snapshot(3, [{ ...warden, bossPhase: 3 }]), 1);
    expect(pools.ring.emitted).toBe(rings);
  });

  it("bursts too when a slow frame skips the snapshot it spent in phase 2", () => {
    const { scene, renderer } = setup();
    renderer.apply(null, snapshot(1, [{ ...warden, bossPhase: 1 }]), 1);
    renderer.apply(null, snapshot(3, [{ ...warden, bossPhase: 3 }]), 1);
    expect(fxPools(scene).ring.emitted).toBeGreaterThan(0);
  });

  it("stays quiet for a boss first seen already in phase 3", () => {
    const { scene, renderer } = setup();
    renderer.apply(null, snapshot(1, [{ ...warden, bossPhase: 3 }]), 1);
    expect(fxPools(scene).ring.emitted).toBe(0);
  });

  it("shakes for a heavy blow landing near the player, not for one far off", () => {
    const near = setup();
    land(near.renderer, slam(1 / 30));
    expect(near.renderer.shakeTrauma).toBeGreaterThan(0);
    engine.dispose();
    const far = setup();
    land(far.renderer, slam(1 / 30), warden, { x: 40, y: 40 });
    expect(far.renderer.shakeTrauma).toBe(0);
  });

  it("does not shake for a volley's small hits", () => {
    const { renderer } = setup();
    land(renderer, { id: 25, kind: "telegraph", x: 0, y: 0, radius: 1.3, progress: 1, ownerId: 7, impactIn: 1 / 30, ability: "cinder_rain" });
    expect(renderer.shakeTrauma).toBe(0);
  });
});

describe("boss effects belong to the place they landed in", () => {
  it("leaves no fissure, scorch, beam or thorn standing in the next area", () => {
    const { scene, renderer } = setup();
    const ghaltrek: SnapshotEntity = { id: 10, kind: "monster", boss: true, species: "monster.ghaltrek.v1", x: 0, y: 4 };
    const bosses = [warden, sirrath, ghaltrek];
    const lane = { kind: "telegraph" as const, x: 0, y: 4, radius: 0.8, progress: 1, shape: "line" as const, dirX: 0, dirY: -1, length: 8, impactIn: 1 / 30 };
    renderer.apply(null, snapshot(1, [...bosses,
      { ...lane, id: 30, ownerId: 7, heavy: true, ability: "magma_rift" },
      { ...lane, id: 31, ownerId: 8, ability: "sunlance" },
      { ...lane, id: 32, ownerId: 10, heavy: true, ability: "bramble_charge" },
      { id: 33, kind: "telegraph", x: 0, y: 4, radius: 7, inner: 2.4, progress: 1, shape: "ring", ownerId: 8, impactIn: 1 / 30, heavy: true, ability: "kiln_ring" },
    ]), 1);
    renderer.apply(null, snapshot(2, bosses), 1);
    bossFx(scene).step(0.1);
    expect(shown(scene, FISSURE_NAME).length + shown(scene, SCORCH_NAME).length + shown(scene, BEAM_NAME).length).toBeGreaterThan(0);
    expect(bossFx(scene).thorns().length).toBeGreaterThan(0);

    renderer.apply(null, { ...snapshot(3, []), area: "hideout" }, 1);
    for (const name of [FISSURE_NAME, SCORCH_NAME, BEAM_NAME]) expect(shown(scene, name), name).toHaveLength(0);
    expect(bossFx(scene).thorns()).toHaveLength(0);
  });
});

describe("boss effects cost nothing on first use", () => {
  it("builds every boss effect behind the loading plate and shows none of it", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    warmBossFx(scene);
    const names = scene.meshes.map((m) => m.name);
    for (const name of [FISSURE_NAME, SCORCH_NAME, BEAM_NAME, THORN_NAME]) {
      expect(names.some((n) => n.startsWith(name)), name).toBe(true);
      expect(shown(scene, name).filter((m) => m.name !== THORN_NAME), name).toHaveLength(0);
    }
    expect(bossFx(scene).thorns()).toHaveLength(0);
  });
});

describe("a boss slam lands with the floor breaking", () => {
  it("breaks the floor, sends a shockwave out and throws the boss's own element", () => {
    const { scene, renderer } = setup();
    land(renderer, slam(1 / 30));
    const pools = fxPools(scene);
    expect(slamDebris(scene).live, "rubble").toBeGreaterThan(0);
    expect(pools.ring.emitted, "a shockwave").toBeGreaterThan(0);
    expect(pools.shards.emitted, "the Warden's embers").toBeGreaterThan(0);
    expect(pools.smoke.emitted, "dust").toBeGreaterThan(0);
  });

  it("lands nothing for a mark its dead boss never finished", () => {
    const { scene, renderer } = setup();
    land(renderer, slam(0.6));
    expect(slamDebris(scene).live).toBe(0);
    expect(fxPools(scene).ring.emitted).toBe(0);
  });

  it("leaves a trash heavy's slam to its own look", () => {
    const { scene, renderer } = setup();
    const brute: SnapshotEntity = { id: 9, kind: "monster", species: "monster.sunbaked_colossus.v1", x: 0, y: 4 };
    land(renderer, { id: 21, kind: "telegraph", x: 0, y: 1, radius: 2, progress: 1, ownerId: 9, impactIn: 1 / 30 }, brute);
    expect(fxPools(scene).ring.emitted).toBe(0);
  });
});

describe("every boss ability the content names has its own look", () => {
  const abilities = [...MONSTERS.values()].flatMap((m) => m.boss?.abilities?.map((a) => a.id) ?? []);

  it("lands each one with its own effect, never the plain slam's", () => {
    expect(abilities.length).toBeGreaterThan(0);
    for (const id of abilities) expect(BossFx.LANDINGS[id], id).toBeDefined();
  });

  it("keys no landing or wind-up on an ability no boss has", () => {
    for (const id of [...Object.keys(BossFx.LANDINGS), ...Object.keys(BossFx.WINDUPS)]) expect(abilities, id).toContain(id);
  });
});
