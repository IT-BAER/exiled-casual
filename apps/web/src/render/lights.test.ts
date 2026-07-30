import { describe, it, expect, afterEach } from "vitest";
import { Mesh, NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { FLAME_MESH, flameParticleCount } from "./flames";
import {
  BRAZIER_FLAME_Y, LIGHT_POOL,
  createFireLights, fireLightState, resetFireLights, setFireSpots, updateFireLights,
} from "./lights";

afterEach(() => resetFireLights());

function scene(): Scene {
  return new Scene(new NullEngine());
}

describe("the fires a place is lit by", () => {
  it("builds a fixed pool once, dark and off", () => {
    const s = scene();
    const pool = createFireLights(s);
    expect(pool).toHaveLength(LIGHT_POOL);
    // A second call must not add lights: every new light recompiles every PBR
    // material in the scene, which is a hitch the player would see.
    createFireLights(s);
    expect(s.lights.filter((l) => l.name.startsWith("firelight-"))).toHaveLength(LIGHT_POOL);
    expect(fireLightState().every((l) => !l.on)).toBe(true);
  });

  it("lights the nearest bowls and leaves the rest dark", () => {
    const s = scene();
    createFireLights(s);
    // Six fires strung out along x; the pool can only cover four.
    setFireSpots([0, 6, 12, 18, 24, 30].map((x, i) => ({ x, z: 0, phase: i })));
    updateFireLights(s, new Vector3(30, 0, 0), 16);
    const lit = fireLightState().filter((l) => l.on);
    expect(lit).toHaveLength(LIGHT_POOL);
    // The four nearest to x=30 are 30, 24, 18 and 12.
    expect(lit.map((l) => l.x).sort((a, b) => a - b)).toEqual([12, 18, 24, 30]);
    expect(lit.every((l) => l.intensity > 0)).toBe(true);
  });

  it("switches a light off when there is no fire for it", () => {
    const s = scene();
    createFireLights(s);
    setFireSpots([{ x: 1, z: 2, phase: 0 }]);
    updateFireLights(s, Vector3.Zero(), 16);
    const state = fireLightState();
    expect(state.filter((l) => l.on)).toHaveLength(1);
    expect(state[0]!.x).toBe(1);
    expect(state[0]!.z).toBe(2);
  });

  it("flickers, and never to nothing", () => {
    const s = scene();
    createFireLights(s);
    setFireSpots([{ x: 0, z: 0, phase: 0 }]);
    const seen: number[] = [];
    for (let i = 0; i < 40; i++) {
      updateFireLights(s, Vector3.Zero(), 50);
      seen.push(fireLightState()[0]!.intensity);
    }
    expect(Math.max(...seen)).toBeGreaterThan(Math.min(...seen));
    expect(Math.min(...seen)).toBeGreaterThan(0);
  });

  it("hangs the flame over the bowl, not on the floor", () => {
    const s = scene();
    const pool = createFireLights(s);
    setFireSpots([{ x: 0, z: 0, phase: 0 }]);
    updateFireLights(s, Vector3.Zero(), 16);
    expect(pool[0]!.position.y).toBe(BRAZIER_FLAME_Y);
  });
});

describe("the fire in the bowl", () => {
  it("burns over the bowl and nowhere else, and stops burning off screen", () => {
    const s = scene();
    createFireLights(s);
    const mesh = s.getMeshByName(FLAME_MESH) as Mesh;
    expect(mesh).toBeTruthy();
    // Without this the material's own alpha decides the pass, and a fire drawn
    // opaque is a cloud of grey pebbles.
    expect(mesh.hasVertexAlpha).toBe(true);

    setFireSpots([{ x: 8, z: -3, phase: 0 }]);
    updateFireLights(s, new Vector3(8, 0, -3), 16);
    const drawn = flameParticleCount();
    expect(drawn).toBeGreaterThan(0);

    // Read the geometry the GPU would draw, not a bounding box: the system is
    // marked always-visible, so Babylon stops refreshing the bounds and a box
    // check would pass on the shape the mesh was BUILT at. Every vertex has to
    // stand over its own bowl and above the coals — the whole trajectory is
    // rewritten per frame, and a sign error puts the fire in the next room with
    // nothing else in the app any the wiser.
    const pos = mesh.getVerticesData("position")!;
    let top = 0;
    for (let i = 0; i < pos.length; i += 3) {
      expect(Math.hypot(pos[i]! - 8, pos[i + 2]! + 3)).toBeLessThan(2);
      expect(pos[i + 1]!).toBeGreaterThan(0.5);
      top = Math.max(top, pos[i + 1]!);
    }
    // ...and the plume reaches well over the rim, or it is a glow in a bowl.
    expect(top).toBeGreaterThan(1.6);
    expect(top).toBeLessThan(4);

    // Walk away past FLAME_RANGE and nothing is alight.
    updateFireLights(s, new Vector3(60, 0, -3), 16);
    expect(flameParticleCount()).toBe(0);
  });
});
