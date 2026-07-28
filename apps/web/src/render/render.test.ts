// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import {
  Camera,
  ImageProcessingConfiguration,
  NullEngine,
  ParticleSystem,
  PointLight,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import { applyAtmosphere, BETA_AT_DEFAULT, createScene, VOID_COLOR } from "./engine";
import { applyBiomeTint } from "./level";
import { HAZE_HEIGHT, HAZE_MAX_SIZE, HAZE_NAME, MOTES_NAME } from "./haze";
import { BIOMES } from "@exiled/content-runtime";
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
    // and not exactly, because the void is not grey — multiplying (0.09, 0.1,
    // 0.12) by a mean-1 tint moves the mean by a fraction of a percent, since
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

  it("floats motes in the torchlight, warm and fading in at both ends", () => {
    engine = new NullEngine();
    const { scene, camera } = createScene(engine);
    const motes = scene.particleSystems.find((p) => p.name === MOTES_NAME)! as ParticleSystem;

    expect(motes).toBeTruthy();
    // Rising, or they are snow.
    expect(motes.gravity.y).toBeGreaterThan(0);

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
    expect(camera.beta).toBeCloseTo(BETA_AT_DEFAULT, 6);
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
    expect(camera.beta).toBeCloseTo(BETA_AT_DEFAULT, 6);

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
