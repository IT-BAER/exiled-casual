import { describe, it, expect, afterEach } from "vitest";
import { Color3, Constants, Mesh, NullEngine, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { FLAME_MESH, flameParticleCount } from "./flames";
import {
  BRAZIER_FLAME_Y, BRAZIER_RIM_R, BRAZIER_RIM_Y, LIGHT_POOL,
  createFireLights, fireLightState, resetFireLights, rimShadowRadius, setFireSpots,
  updateFireLights,
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

  it("hangs the light clear of the rim it stands in", () => {
    // Not decoration: level with the lip, the bowl blocks its own light going
    // outward and shadows the whole floor, which a cube shadow map splits along
    // its four face diagonals into dark quadrants around every brazier. A third
    // of the rim's height of clearance is what measured clean in the app.
    expect(BRAZIER_FLAME_Y - BRAZIER_RIM_Y).toBeGreaterThan(BRAZIER_RIM_Y / 3);
  });

  it("keeps the bowl's own shadow near the size of the bowl", () => {
    // The clearance above is necessary and was not sufficient: at 1.45 the rim
    // still threw a 1.35-unit disc, a stain three times the width of the prop
    // standing in it. Held under 2.5 rim radii, the shadow seats the brazier on
    // the floor instead of painting a ring round it. Falls as the lamp rises.
    expect(rimShadowRadius(BRAZIER_FLAME_Y)).toBeLessThan(BRAZIER_RIM_R * 2.5);
    expect(rimShadowRadius(BRAZIER_FLAME_Y + 0.2))
      .toBeLessThan(rimShadowRadius(BRAZIER_FLAME_Y));
  });
});

describe("the fire in the bowl", () => {
  it("plays the Blender flipbook over each burning bowl", () => {
    const s = scene();
    createFireLights(s);
    const mesh = s.getMeshByName(FLAME_MESH) as Mesh;
    const material = mesh.material as StandardMaterial;

    expect(material.emissiveTexture?.name).toContain("/textures/effects/brazier-fire.png");
    expect(material.emissiveColor).toEqual(Color3.Black());
    setFireSpots([{ x: 2, z: 3, phase: 0 }]);
    updateFireLights(s, new Vector3(2, 0, 3), 16);
    const first = mesh.getVerticesData("uv")!;
    const firstU = [first[0]!, first[2]!, first[4]!, first[6]!];
    const firstV = [first[1]!, first[3]!, first[5]!, first[7]!];
    expect(Math.max(...firstU) - Math.min(...firstU)).toBeLessThan(0.1);
    expect(Math.max(...firstV) - Math.min(...firstV)).toBeLessThan(0.15);
    updateFireLights(s, new Vector3(2, 0, 3), 100);
    expect(mesh.getVerticesData("uv")).not.toEqual(first);
  });

  it("burns over the bowl and nowhere else, and stops burning off screen", () => {
    const s = scene();
    createFireLights(s);
    const mesh = s.getMeshByName(FLAME_MESH) as Mesh;
    expect(mesh).toBeTruthy();
    // The RGB atlas has a black background, which disappears only in Babylon's
    // additive transparent pass.
    const material = mesh.material as StandardMaterial;
    expect(material.alphaMode).toBe(Constants.ALPHA_ADD);
    expect(material.needAlphaBlending()).toBe(true);

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
