// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  Animation,
  AnimationGroup,
  Camera,
  ImageProcessingConfiguration,
  Matrix,
  NullEngine,
  ParticleSystem,
  PointLight,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { applyAtmosphere, BETA_AT_DEFAULT, createScene, VOID_COLOR } from "./engine";
import { applyBiomeTint } from "./level";
import { LIGHT_POOL } from "./lights";
import { HAZE_HEIGHT, HAZE_MAX_SIZE, HAZE_NAME, MOTES_NAME, MOTES_NOISE_NAME } from "./haze";
import { BIOMES } from "@exiled/content-runtime";
import { blowFrom, SnapshotRenderer, syncActionAnimation } from "./renderer";
import { makeMesh, updateTelegraph } from "./meshes";
import type { Snapshot } from "@exiled/protocol";
import { testPlayer, testStats } from "../test-fixtures";
import { columnHit } from "../input/bindings";
import { restartAtCurrentFrame } from "./rig";
import { playSfx } from "../audio/sfx";

vi.mock("../audio/sfx", async (importOriginal) => ({
  ...await importOriginal<typeof import("../audio/sfx")>(),
  playSfx: vi.fn(),
}));

describe("sustained casting animation", () => {
  it("starts on the casting edge and is not restarted while the cast runs", () => {
    const rig = { playCast: vi.fn(), playStrike: vi.fn(), stopStrike: vi.fn() };

    syncActionAnimation(rig, false, true, undefined, "spell");
    syncActionAnimation(rig, true, true, "spell", "spell");

    expect(rig.playCast).toHaveBeenCalledTimes(1);
  });

  it("lets the swing finish after the wind-up ends", () => {
    // The clip is paced to the BEAT (wind-up or cooldown, whichever is longer)
    // while the casting flag lives only for the wind-up. Cutting it on the
    // falling edge showed 30% of a 1s swing and the bolt left a lifting hand.
    const rig = { playCast: vi.fn(), playStrike: vi.fn(), stopStrike: vi.fn() };

    syncActionAnimation(rig, false, true, undefined, "spell", 1);
    syncActionAnimation(rig, true, false, "spell", undefined, 1);

    expect(rig.playCast).toHaveBeenCalledTimes(1);
    expect(rig.playCast).toHaveBeenCalledWith(1);
  });

  it("uses the melee action clip for a melee cast and leaves spell casting separate", () => {
    const rig = {
      playCast: vi.fn(),
      playStrike: vi.fn(),
      stopStrike: vi.fn(),
    };

    syncActionAnimation(rig, false, true, undefined, "melee");
    syncActionAnimation(rig, true, true, "melee", "melee");
    syncActionAnimation(rig, true, false, "melee", undefined);

    expect(rig.playStrike).toHaveBeenCalledTimes(1);
    expect(rig.playCast).not.toHaveBeenCalled();
    expect(rig.stopStrike).not.toHaveBeenCalled();
  });
});

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
    completedNodes: [],
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
  vi.mocked(playSfx).mockClear();
});

describe("torch", () => {
  it("rides the camera target, so the pool cannot drift off the player", () => {
    engine = new NullEngine();
    const { scene, camera } = createScene(engine);
    const torch = scene.getLightByName("torch") as PointLight;
    expect(torch).toBeTruthy();

    camera.setTarget(new Vector3(7, 0, -3), false, false, true);
    scene.render();

    expect(torch.position.x).toBeCloseTo(7);
    expect(torch.position.z).toBeCloseTo(-3);
    // Lifted off the floor: at y=0 the pool is a hot spot under the feet and the
    // inverse square eats the whole radius inside one step.
    expect(torch.position.y).toBeGreaterThan(1);
  });

  it("carries no specular, so it cannot put a bulb on the character's hair", () => {
    // The lamp rides ~0.8 units off the skull, and a point light that close
    // lands its highlight lobe on the shiniest thing on the rig: the hair lit
    // up like a bulb. The sun still gives every actor its specular.
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const torch = scene.getLightByName("torch") as PointLight;

    expect(torch.specular.r + torch.specular.g + torch.specular.b).toBe(0);
  });

  it("hangs above head height, so the head is not the nearest thing to the lamp", () => {
    // Inverse square: at 2.5 the lamp was 0.8 off the skull and the character
    // went white. Intensity must track h² or the floor pool goes with it.
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const torch = scene.getLightByName("torch") as PointLight;

    expect(torch.position.y).toBeGreaterThan(2.6);
  });
});

describe("how many lights a surface may take", () => {
  it("raises the cap past Babylon's four, or the far braziers light nothing", () => {
    // Babylon drops everything past the fourth light on a material without a
    // word. Fill + sun + torch left ONE slot for a pool of four fires, and
    // `updateFireLights` hands that pool out nearest first, so every brazier but
    // the closest stopped lighting the floor until the player walked up to it.
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const probe = new StandardMaterial("cap-probe", scene);
    scene.render(); // the sweep runs before a frame, not at construction

    expect(probe.maxSimultaneousLights).toBeGreaterThanOrEqual(3 + LIGHT_POOL);
    // ...and the scene really does stand that many up, so the cap is not just a
    // number that happens to be big enough today.
    expect(scene.lights.length).toBe(3 + LIGHT_POOL);
  });
});

describe("atmosphere", () => {
  it("fogs to the void colour, so distance dissolves instead of hitting a cliff", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);

    // LINEAR, not EXP2: the visible floor sits in a measured 15.8..24.4 band
    // from the camera, and exponential fog across 8.6 units varies too little to
    // read as anything but a flat dimmer (it was 7% under the old ortho camera).
    expect(scene.fogMode).toBe(Scene.FOGMODE_LINEAR);
    expect(scene.fogColor.equals(VOID_COLOR)).toBe(true);
    // The band has to straddle the visible floor: clear at the near edge, biting
    // before the far one. Outside that it is either invisible or a wall.
    expect(scene.fogStart).toBeGreaterThan(15.8);
    expect(scene.fogStart).toBeLessThan(24.4);
    expect(scene.fogEnd).toBeGreaterThan(24.4);
  });

  it("projects in perspective, or running reads as sliding a 2D map", () => {
    // Orthographic has literally zero parallax: near and far ground move at the
    // same screen rate and every box shows the same faces wherever it stands. No
    // amount of fog or haze puts depth into a projection that has none.
    engine = new NullEngine();
    const { camera } = createScene(engine);

    expect(camera.mode).toBe(Camera.PERSPECTIVE_CAMERA);
    // Radius is DERIVED from the authored framing, so a wheel notch still frames
    // the same amount of floor it did under the old ortho camera.
    expect(camera.radius).toBeCloseTo(camera.orthoTop! / Math.tan(camera.fov / 2), 4);
  });

  it("darkens the edges by multiply, so a lit corner stays lit", () => {
    // Opaque blend paints a flat black ring over the corners. The rooms have
    // already gone to unplayable black once; this may dim, never paint.
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const ip = scene.imageProcessingConfiguration;

    expect(ip.vignetteEnabled).toBe(true);
    expect(ip.vignetteBlendMode).toBe(ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY);
  });

  it("ships soft, and heavy is strictly more of both", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const soft = { fog: scene.fogEnd, v: scene.imageProcessingConfiguration.vignetteWeight };

    applyAtmosphere(scene, "heavy");

    // A NEARER end is thicker fog: the band closes in on the camera.
    expect(scene.fogEnd).toBeLessThan(soft.fog);
    expect(scene.imageProcessingConfiguration.vignetteWeight).toBeGreaterThan(soft.v);
  });

  it("takes each biome's hue into the fog without taking its brightness", () => {
    // Same rule as the lights: a biome is a colour, not a dimmer. Approximately
    // and not exactly, because the void is not grey — multiplying VOID_COLOR
    // by a mean-1 tint moves the mean by a fraction of a percent, since
    // mean(V·t) only equals mean(V)·mean(t) when one of them is flat. Two
    // decimal places is the honest bound; anything tighter is asserting maths
    // that is not true.
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const voidMean = (VOID_COLOR.r + VOID_COLOR.g + VOID_COLOR.b) / 3;

    for (const biome of Object.values(BIOMES)) {
      applyBiomeTint(scene, biome.tint);
      const f = scene.fogColor;
      expect((f.r + f.g + f.b) / 3, `${biome.id} fog mean`).toBeCloseTo(voidMean, 2);
      expect(f.equals(VOID_COLOR), `${biome.id} fog is actually tinted`).toBe(false);
    }

    applyBiomeTint(scene, null);
    expect(scene.fogColor.equals(VOID_COLOR)).toBe(true);
  });

  it("hazes the ground around the player and drifts it there in world space", () => {
    // The emitter follows; the particles must not. Parent them to the view and
    // the whole field slides with the camera, which reads as a dirty lens.
    engine = new NullEngine();
    const { scene, camera } = createScene(engine);
    const haze = scene.particleSystems.find((p) => p.name === HAZE_NAME)!;

    expect(haze).toBeTruthy();
    expect(haze.blendMode).toBe(ParticleSystem.BLENDMODE_ADD);

    camera.setTarget(new Vector3(9, 0, -4), false, false, true);
    scene.render();

    const at = haze.emitter as Vector3;
    expect(at.x).toBeCloseTo(9);
    expect(at.z).toBeCloseTo(-4);
  });

  it("hangs every haze quad clear of the floor, or the floor slices it", () => {
    // The sprites are camera-facing quads standing `size` tall about their
    // centre. Any part below the floor loses the depth test to the opaque ground
    // plane and the quad ends in a dead-straight horizontal line — at alpha 0.35
    // the frame was banded with them. Height must beat half the largest sprite.
    expect(HAZE_HEIGHT).toBeGreaterThan(HAZE_MAX_SIZE / 2);
  });

  it("names the bolt that killed a body, and the player when nothing did", () => {
    const bolt = { id: 9, kind: "projectile" as const, x: 4.4, y: 1, radius: 0.2 };
    const far = { id: 10, kind: "projectile" as const, x: -20, y: 20, radius: 0.2 };
    const prev = makeSnapshot({ entities: [bolt, far] });
    // Both bolts are gone this snapshot; only the one that was standing on the
    // body can have been what killed it.
    const next = makeSnapshot({ tick: 2, entities: [], player: testPlayer({ x: -3, y: 0 }) });

    const hit = blowFrom(5, 1, prev, next);
    expect(hit.x).toBeCloseTo(4.4);
    expect(hit.z).toBeCloseTo(1);

    // A body nowhere near either bolt was struck by hand, and the player is the
    // only hand there is.
    const melee = blowFrom(5, 1, makeSnapshot({ entities: [far] }), next);
    expect(melee.x).toBeCloseTo(-3);

    // A bolt still in the air hit nothing: it has to be in prev and NOT in next.
    const flying = blowFrom(5, 1, prev, makeSnapshot({ tick: 2, entities: [bolt] }));
    expect(flying.x).toBeCloseTo(0);
  });

  it("floats motes in the torchlight, warm and fading in at both ends", () => {
    engine = new NullEngine();
    const { scene, camera } = createScene(engine);
    const motes = scene.particleSystems.find((p) => p.name === MOTES_NAME)! as ParticleSystem;

    expect(motes).toBeTruthy();
    // Not all of it rises: a field where every speck climbs is a parallax layer
    // sliding past the camera, not air in a room. Some fall, and the sideways
    // spread is of the same order as the vertical one.
    expect(motes.direction1.y).toBeLessThan(0);
    expect(motes.direction2.y).toBeGreaterThan(0);
    expect(motes.direction2.x).toBeGreaterThanOrEqual(motes.direction2.y * 0.8);
    // Gravity would swamp both over a mote's life: 0.035 up is a quarter of a
    // unit per second by the end of one, so a falling mote would turn around.
    expect(motes.gravity.y).toBe(0);
    // ...and each one wanders instead of running its launch direction in a
    // straight line for eleven seconds.
    expect(motes.noiseTexture?.name).toBe(MOTES_NOISE_NAME);
    expect(motes.noiseStrength.x).toBeGreaterThan(0);

    const stops = motes.getColorGradients()!;
    expect(stops[0]!.color1.a).toBe(0);
    expect(stops[stops.length - 1]!.color1.a).toBe(0);
    // Lit by the lamp, not by the room: the biome never recolours these.
    const lit = stops[1]!.color1;
    expect(lit.r).toBeGreaterThan(lit.b);
    applyBiomeTint(scene, BIOMES.swamp.tint);
    expect(motes.getColorGradients()![1]!.color1.r).toBe(lit.r);

    camera.setTarget(new Vector3(-3, 0, 6), false, false, true);
    scene.render();
    const at = motes.emitter as Vector3;
    expect(at.x).toBeCloseTo(-3);
    expect(at.z).toBeCloseTo(6);
  });

  it("tints the haze with the biome and never lets it go opaque", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const haze = scene.particleSystems.find((p) => p.name === HAZE_NAME)! as ParticleSystem;

    applyBiomeTint(scene, BIOMES.desert.tint);
    const stops = haze.getColorGradients()!;

    // Read from the GRADIENTS, not color1/colorDead: gradients override those
    // entirely, so a system carrying both is ignoring half its configuration.
    expect(stops.length).toBeGreaterThan(2);
    const mid = stops[1]!.color1;
    expect(mid.r).toBeGreaterThan(mid.b); // desert is warm
    // Additive, so alpha is intensity. Thick enough to notice on its own has
    // already washed out the torch pool the frame is built around.
    expect(mid.a).toBeLessThan(0.4);
    // Both ends at zero. Babylon starts a particle AT color1, so a system built
    // on color1/colorDead fades every sprite out and POPS every one in.
    expect(stops[0]!.color1.a).toBe(0);
    expect(stops[stops.length - 1]!.color1.a).toBe(0);
  });
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
    // Spawned facing the camera, holding that until it moves. The camera leans
    // 45 degrees off the grid, so that is 3PI/4 and not the due-south PI.
    const spawnYaw = (Math.PI * 3) / 4;
    expect(mesh.rotation.y).toBeCloseTo(spawnYaw, 6);

    // Move +x (world +x). Heading yaw = atan2(dx=5, dz=0) = PI/2; the shortest
    // path from 3PI/4 is -PI/4, eased by 0.25 → 3PI/4 - PI/16.
    const s1 = makeSnapshot({ player: testPlayer({ x: 5 }) });
    renderer.apply(s0, s1, 1);
    expect(mesh.rotation.y).toBeCloseTo(spawnYaw - Math.PI / 16, 4);
  });

  it("faces the player by the sim's heading, not by the step it took", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);

    const s0 = makeSnapshot({ player: testPlayer() });
    renderer.apply(null, s0, 1);
    const mesh = scene.getMeshByName("entity-0")!;
    const spawnYaw = (Math.PI * 3) / 4;

    // Side-stepping +x onto a target inside his turning circle while the body is
    // still turned +y. Facing the step would put him at PI/2; facing the heading
    // holds him near 0, which is what stops the cursor pivoting him on the spot.
    const s1 = makeSnapshot({ player: testPlayer({ x: 0.2, heading: { x: 0, y: 1 } }) });
    renderer.apply(s0, s1, 1);
    expect(mesh.rotation.y).toBeCloseTo(spawnYaw + 0.25 * (0 - spawnYaw), 4);
  });

  it("banks into a turn and stands back up on the straight", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);

    // Running +x, then cornering into +y for a while.
    let prev = makeSnapshot({ player: testPlayer() });
    renderer.apply(null, prev, 1);
    const mesh = scene.getMeshByName("entity-0")!;
    // Long enough to have finished turning onto the run itself: the spawn
    // heading faces the camera, and leaving it IS a corner.
    for (let i = 1; i <= 40; i++) {
      const next = makeSnapshot({ player: testPlayer({ x: i * 0.1 }) });
      renderer.apply(prev, next, 1);
      prev = next;
    }
    expect(Math.abs(mesh.rotation.z)).toBeLessThan(0.01); // straight line, no bank
    const corner = { x: 4, y: 0 };
    for (let i = 1; i <= 6; i++) {
      corner.y += 0.1;
      const next = makeSnapshot({ player: testPlayer({ ...corner }) });
      renderer.apply(prev, next, 1);
      prev = next;
    }
    const banked = mesh.rotation.z;
    expect(Math.abs(banked)).toBeGreaterThan(0.02);
    // Leaning INTO the corner: a right-hand turn (yaw falling) rolls one way.
    expect(Math.sign(banked)).toBe(1);

    // Out of the corner, the body comes back up on its own.
    for (let i = 1; i <= 30; i++) {
      corner.y += 0.1;
      const next = makeSnapshot({ player: testPlayer({ ...corner }) });
      renderer.apply(prev, next, 1);
      prev = next;
    }
    expect(Math.abs(mesh.rotation.z)).toBeLessThan(Math.abs(banked) / 2);
  });

  it("stands upright after stopping in the middle of a turn", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);

    const stopped = makeSnapshot({ player: testPlayer() });
    renderer.apply(null, stopped, 1);
    const mesh = scene.getMeshByName("entity-0")!;
    const turning = makeSnapshot({ player: testPlayer({ x: 0.1 }) });
    renderer.apply(stopped, turning, 1);
    const banked = Math.abs(mesh.rotation.z);
    expect(banked).toBeGreaterThan(0.01);

    for (let frame = 0; frame < 30; frame++) renderer.apply(turning, turning, 1);
    expect(Math.abs(mesh.rotation.z)).toBeLessThan(banked / 2);
    expect(Math.abs(mesh.rotation.x)).toBeLessThan(0.002);
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

  it("flies a bolt straight from the weapon tip to the target, never a curve", () => {
    // The sim launches from the player's CENTRE and lands on the aimed point.
    // Drawn at the weapon tip with a constant offset, that is a line PARALLEL to
    // the one the player aimed along — beside everything he pointed at. Spending
    // the offset in proportion to the distance still to run makes the drawn path
    // the straight line tip → target instead. Straight is the requirement: a
    // bolt that bends back through the player's chest and then sets off is worse
    // than the parallel one.
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);
    const HAND = new Vector3(0.4, 1.2, 0.6); // weapon tip, out to the right
    const TARGET = { x: 10, z: 0 }; // the sim flies +x along z=0

    const snap = (tick: number, x: number, entities = true) =>
      makeSnapshot({
        tick,
        entities: entities ? [{ id: 2, kind: "projectile" as const, x, y: 0, radius: 0.4, team: 0 }] : [],
      });

    let prev = snap(1, 0, false);
    renderer.apply(null, prev, 1);
    scene.getMeshByName("entity-0")!.metadata = {
      rig: {
        setLooks: () => {}, setAimTarget: () => {}, dispose: () => {},
        setLocomotion: () => {}, setFacing: () => {}, update: () => {},
        castPoint: () => HAND,
      },
    };
    renderer.setAim(TARGET.x, TARGET.z);

    // Flown out to 20, twice the target's distance: the bolt does NOT stop at
    // the cursor, and the line must not bend where it passes it.
    const drawn: { x: number; z: number }[] = [];
    for (let i = 0; i <= 50; i++) {
      const next = snap(2 + i, i * 0.4);
      renderer.apply(prev, next, 1);
      prev = next;
      const m = scene.getMeshByName("entity-2");
      if (m) drawn.push({ x: m.position.x, z: m.position.z });
    }

    // It starts at the tip and passes through the target...
    expect(drawn[0]!.x).toBeCloseTo(HAND.x, 2);
    expect(drawn[0]!.z).toBeCloseTo(HAND.z, 2);
    const atTarget = drawn.find((p) => p.x >= TARGET.x)!;
    expect(atTarget.z).toBeCloseTo(TARGET.z, 1);
    expect(drawn[drawn.length - 1]!.x).toBeGreaterThan(TARGET.x * 1.8);

    // ...and every point between lies ON that line. Cross product against the
    // tip→target direction: zero for all of them or the path is bent.
    const dx = TARGET.x - HAND.x;
    const dz = TARGET.z - HAND.z;
    const len = Math.hypot(dx, dz);
    for (const p of drawn) {
      const off = Math.abs((p.x - HAND.x) * dz - (p.z - HAND.z) * dx) / len;
      expect(off).toBeLessThan(0.01);
    }
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

  // The hideout props are authored square to a camera due south (yaw PI). The
  // camera does not stand there any more, so the check is against the lens
  // itself rather than against the number the sim sends.
  it("a prop's fixed yaw turns it to face the camera", () => {
    engine = new NullEngine();
    const { scene, camera } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);
    const snap = makeSnapshot({
      entities: [{ id: 9, kind: "vendor", x: 0, y: 0, yaw: Math.PI, inRange: false }],
    });
    renderer.apply(null, snap, 1);
    camera.getViewMatrix(); // ArcRotateCamera only derives .position on demand
    const mesh = scene.getMeshByName("entity-9");
    expect(mesh).not.toBeNull();
    const forward = new Vector3(Math.sin(mesh!.rotation.y), 0, Math.cos(mesh!.rotation.y));
    const toCamera = camera.position.subtract(mesh!.position);
    toCamera.y = 0;
    expect(Vector3.Dot(forward, toCamera.normalize())).toBeCloseTo(1, 2);
  });

  /**
   * The forgiving pick, measured against the real camera rather than against the
   * algebra that implements it: Babylon projects a point on the NPC's chest to a
   * pixel, Babylon builds the picking ray back out of that pixel, and the column
   * has to be standing where the ray goes. Headless is the exact failure case —
   * the rig never loads, so the mesh pick finds only the torus ring with the hole
   * in it, which is what a click between his legs sees in the real game too.
   */
  it("a ray at an NPC's chest meets his column, one 1.5 units aside does not", () => {
    engine = new NullEngine();
    const { scene, camera } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);
    renderer.apply(null, makeSnapshot({
      entities: [{ id: 9, kind: "vendor", x: 4, y: -2, inRange: false }],
    }), 1);
    scene.render(); // the camera only derives its matrices once it has drawn

    const width = engine.getRenderWidth();
    const height = engine.getRenderHeight();
    const toPixel = (p: Vector3) => Vector3.Project(
      p,
      Matrix.Identity(),
      scene.getTransformMatrix(),
      camera.viewport.toGlobal(width, height),
    );
    // Straight at his chest, which is the parallax case: the ray carries on to
    // the floor a metre BEHIND him, so only the column's height catches it.
    const chest = toPixel(new Vector3(4, 1.2, -2));
    expect(columnHit(scene.createPickingRay(chest.x, chest.y, null, camera), 4, -2)).not.toBeNull();
    // And across his shoulder, which is the radius.
    const shoulder = toPixel(new Vector3(4.4, 1.2, -2));
    expect(columnHit(scene.createPickingRay(shoulder.x, shoulder.y, null, camera), 4, -2))
      .not.toBeNull();

    // And the pick it has to defer to: with no rig loaded, the only thing under
    // that pixel is the floor, so nothing carrying `interactKind` is picked.
    const picked = scene.pick(chest.x, chest.y).pickedMesh;
    expect((picked?.metadata as { interactKind?: string } | null)?.interactKind).toBeUndefined();

    const aside = toPixel(new Vector3(5.5, 1.2, -2));
    expect(columnHit(scene.createPickingRay(aside.x, aside.y, null, camera), 4, -2)).toBeNull();
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

  /**
   * Let the camera arrive.
   *
   * The wheel sets a TARGET and the render loop walks to it at a fixed speed, so
   * a single notch is not a single jump any more. `setZoom(0)` moves the target
   * nowhere and takes one step toward it, which is exactly a frame of that walk
   * without a NullEngine having to render one.
   */
  const settle = (setZoom: (n: number) => void, frames = 60) => {
    for (let i = 0; i < frames; i++) setZoom(0);
  };

  it("zooming in shows less of the map ahead, not more", () => {
    const engine = new NullEngine();
    const { camera, setZoom } = createScene(engine);
    const wide = groundDepth(camera);
    const wideBeta = camera.beta;

    // Every notch in has to shrink the forward view. The pitch shallows as it
    // goes — that is the curve — and shallowing alone would show *more* ground,
    // so this is the guard that the curve never outruns the zoom.
    let previous = wide;
    // Five, not twelve: the range is about 5.6 notches wide now, and a notch
    // past the near stop moves nothing, which is not a shrinking view.
    for (let notch = 0; notch < 5; notch++) {
      setZoom(-1);
      settle(setZoom);
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
    expect(camera.beta).toBeCloseTo(BETA_AT_DEFAULT, 6);
  });

  it("clamps at the near stop", () => {
    const engine = new NullEngine();
    const { camera, setZoom } = createScene(engine);
    // Scrolling past a stop must settle on it rather than creep through: the
    // clamp is on the target, so the eased position approaches and never passes.
    for (let i = 0; i < 120; i++) setZoom(-1);
    settle(setZoom, 200);
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
    expect(camera.beta).toBeCloseTo(BETA_AT_DEFAULT, 6);

    setZoom(-4);
    for (let i = 0; i < 80; i++) setZoom(1);
    settle(setZoom, 200);
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
      settle(setZoom);
      expect(covered()).toBe(true);
    }
  });
});

describe("portals arrive one at a time", () => {
  /** Six portals on one tick with the entity ids the sim's ring order gives them. */
  const ring = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: 100 + i, kind: "portal" as const, x: i, y: 0, yaw: 0 }));

  /** The device was clicked: same place, one moment later, now with portals. */
  const opened = (n: number, renderer: SnapshotRenderer) => {
    const empty = makeSnapshot({ entities: [] });
    renderer.apply(null, empty, 1);
    renderer.apply(empty, makeSnapshot({ tick: 2, entities: ring(n) }), 1);
  };

  it("holds every portal but the first shut, and opens them in ring order", () => {
    const scene = new Scene(new NullEngine());
    const renderer = new SnapshotRenderer(scene);
    opened(4, renderer);

    const meshes = [100, 101, 102, 103].map((id) => scene.getMeshByName(`entity-${id}`)!);
    for (const m of meshes) expect(m).not.toBeNull();
    // The first is already opening; the rest are waiting their quarter-second and
    // must not be standing there at full size in the meantime.
    expect(meshes[0]!.isEnabled(false)).toBe(true);
    for (const m of meshes.slice(1)) expect(m.isEnabled(false)).toBe(false);
    for (const m of meshes) expect(m.scaling.x).toBeLessThan(0.5);
  });

  it("plays one opening cue for the whole six-portal sequence", () => {
    engine = new NullEngine();
    vi.spyOn(engine, "getDeltaTime").mockReturnValue(250);
    const scene = new Scene(engine);
    const renderer = new SnapshotRenderer(scene);
    opened(6, renderer);

    for (let i = 0; i < 6; i++) scene.onBeforeRenderObservable.notifyObservers(scene);

    expect(vi.mocked(playSfx).mock.calls.map(([name]) => name)).toEqual(["portal-open"]);
  });

  /**
   * The one he kept hearing and nobody could place: it only fires where nobody
   * plays, on the first snapshot of a place. Walking into a map plays it over the
   * return portal that was already standing there, and in dev an HMR reload plays
   * it on every save — a rising sweep out of nowhere, in a map, with no portal
   * opening anywhere.
   */
  it("says nothing about portals that were already standing when we arrived", () => {
    engine = new NullEngine();
    vi.spyOn(engine, "getDeltaTime").mockReturnValue(250);
    const scene = new Scene(engine);
    const renderer = new SnapshotRenderer(scene);

    // A cold start inside a map, and then a walk from the hideout into one.
    renderer.apply(null, makeSnapshot({ area: "map", entities: ring(2) }), 1);
    const hideout = makeSnapshot({ area: "hideout", entities: [] });
    renderer.apply(hideout, makeSnapshot({ area: "map", entities: ring(2) }), 1);
    for (let i = 0; i < 6; i++) scene.onBeforeRenderObservable.notifyObservers(scene);

    expect(vi.mocked(playSfx).mock.calls.map(([name]) => name)).toEqual([]);
    // ...and they are standing, not stuck shut at 0.001 waiting for a sequence
    // that will never run.
    const standing = scene.getMeshByName("entity-101")!;
    expect(standing.isEnabled(false)).toBe(true);
    expect(standing.scaling.x).toBe(1);
  });

  it("a portal already standing is not re-opened by the next frame", () => {
    const scene = new Scene(new NullEngine());
    const renderer = new SnapshotRenderer(scene);
    opened(2, renderer);
    const snap = makeSnapshot({ tick: 2, entities: ring(2) });
    const second = scene.getMeshByName("entity-101")!;
    second.setEnabled(true);
    second.scaling.setAll(1);
    // apply() runs several times per snapshot while interpolating.
    renderer.apply(snap, snap, 0.5);
    expect(second.isEnabled(false)).toBe(true);
    expect(second.scaling.x).toBe(1);
  });

  /**
   * Leaving an area takes the whole hideout with it. Those portals were not closed,
   * and six collapses plus six cues under the loading plate is noise.
   */
  it("an area change takes its portals instantly, with no collapse", () => {
    const scene = new Scene(new NullEngine());
    const renderer = new SnapshotRenderer(scene);
    const before = makeSnapshot({ area: "hideout", entities: ring(3) });
    renderer.apply(null, before, 1);
    renderer.apply(before, makeSnapshot({ area: "map", entities: [] }), 1);
    for (const id of [100, 101, 102]) expect(scene.getMeshByName(`entity-${id}`)).toBeNull();
  });

  it("takes them instantly on a restart too, which is how the crossing arrives", () => {
    // Entering the hideout hands the first snapshot of the new area with no
    // previous one to diff against. Read as "everything vanished at once", that
    // path collapsed the map's portals and played six closing cues over the
    // loading plate — the sound he heard walking into his own hideout.
    const scene = new Scene(new NullEngine());
    const renderer = new SnapshotRenderer(scene);
    renderer.apply(null, makeSnapshot({ area: "map", entities: ring(3) }), 1);
    renderer.apply(null, makeSnapshot({ area: "hideout", entities: [] }), 1);
    for (const id of [100, 101, 102]) expect(scene.getMeshByName(`entity-${id}`)).toBeNull();
  });

  it("a portal closing inside the area collapses before it goes", () => {
    const scene = new Scene(new NullEngine());
    const renderer = new SnapshotRenderer(scene);
    const before = makeSnapshot({ entities: ring(1) });
    renderer.apply(null, before, 1);
    renderer.apply(before, makeSnapshot({ entities: [] }), 1);
    // Still in the scene, mid-collapse, and no longer the renderer's to move.
    expect(scene.getMeshByName("entity-100")).not.toBeNull();
  });
});

describe("hit flash", () => {
  it("lights a monster the tick its life drops, and clears it again", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);

    const s0 = makeSnapshot({ tick: 1, entities: [{ id: 1, kind: "monster", x: 0, y: 0, life: 40, maxLife: 40 }] });
    renderer.apply(null, s0, 1);
    const mesh = scene.getMeshByName("entity-1")!;
    expect(mesh.renderOverlay).toBeFalsy();

    const s1 = makeSnapshot({ tick: 2, entities: [{ id: 1, kind: "monster", x: 0, y: 0, life: 22, maxLife: 40 }] });
    renderer.apply(s0, s1, 1);
    expect(mesh.renderOverlay).toBe(true);
    expect(mesh.overlayAlpha).toBeGreaterThan(0);

    // Unhurt for long enough (a NullEngine frame is 16ms, so ten of them).
    let prev = s1;
    for (let t = 3; t < 13; t++) {
      const next = makeSnapshot({ tick: t, entities: [{ id: 1, kind: "monster", x: 0, y: 0, life: 22, maxLife: 40 }] });
      renderer.apply(prev, next, 1);
      prev = next;
    }
    expect(mesh.renderOverlay).toBe(false);
  });
});

describe("restartAtCurrentFrame", () => {
  it("keeps the clip's phase and full loop window while forcing a blend-in restart", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const node = new TransformNode("bone", scene);
      const anim = new Animation("sway", "position.x", 30, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
      anim.setKeys([{ frame: 0, value: 0 }, { frame: 30, value: 1 }]);
      const group = new AnimationGroup("cycle", scene);
      group.addTargetedAnimation(anim, node);
      group.normalize(0, 30);
      group.start(true, 1);
      group.goToFrame(12);
      scene.animate();
      const before = group.animatables[0]!.masterFrame;

      restartAtCurrentFrame(group, true);
      scene.animate();

      expect(group.isPlaying).toBe(true);
      const animatable = group.animatables[0]!;
      // Phase survives within a frame of drift.
      expect(Math.abs(animatable.masterFrame - before)).toBeLessThan(2);
      // The loop window must stay the whole clip: restarting with `from` set to
      // the current frame would trap every later loop in frame..to.
      expect(animatable.fromFrame).toBe(0);
      expect(animatable.toFrame).toBe(30);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it("does nothing to a group that is not playing", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const node = new TransformNode("bone", scene);
      const anim = new Animation("sway", "position.x", 30, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
      anim.setKeys([{ frame: 0, value: 0 }, { frame: 30, value: 1 }]);
      const group = new AnimationGroup("cycle", scene);
      group.addTargetedAnimation(anim, node);
      restartAtCurrentFrame(group, true);
      expect(group.isPlaying).toBeFalsy();
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});
