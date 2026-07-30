import { describe, it, expect, afterEach } from "vitest";
import { NullEngine, Scene, Vector3 } from "@babylonjs/core";
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
