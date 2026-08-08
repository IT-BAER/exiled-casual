import { describe, it, expect, afterEach } from "vitest";
import { FreeCamera, Mesh, MeshBuilder, NullEngine, Scene, Vector3 } from "@babylonjs/core";
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

  it("does not render shadow casters beyond the fire's own light", () => {
    const s = scene();
    // A point light computes no shadow projection at all with no active camera
    // (`PointLight._setDefaultShadowProjectionMatrix` returns early), which leaves
    // the frustum degenerate and lets everything through the per-face cull.
    new FreeCamera("probe", Vector3.Zero(), s);
    const [light] = createFireLights(s);
    const map = light!.getShadowGenerator()!.getShadowMap()!;

    const near = MeshBuilder.CreateBox("near-fire", { size: 1 }, s);
    near.position.set(1, 0.5, 0);
    near.computeWorldMatrix(true);
    const far = MeshBuilder.CreateBox("far-from-fire", { size: 1 }, s);
    far.position.set(100, 0.5, 0);
    far.computeWorldMatrix(true);

    // All six faces: a caster the +X face cannot see may still be standing behind
    // the fire on -X, and only the union says whether it is drawn at all.
    const drawn = new Set<string>();
    for (let f = 0; f < 6; f++) {
      map.onBeforeRenderObservable.notifyObservers(f);
      for (const mesh of map.getCustomRenderList!(f, [], 0) ?? []) drawn.add(mesh.name);
    }
    expect(drawn.has("near-fire")).toBe(true);
    expect(drawn.has("far-from-fire")).toBe(false);
    // ...and it must do it WITHOUT a predicate. A predicate is the only thing
    // that makes `ObjectRenderer.prepareRenderList` clear and refill the map's
    // render list every frame, and refilling an emptied one marks every mesh in
    // the scene light-dirty. See `cullShadowCasters`.
    expect(map.renderListPredicate).toBeFalsy();
  });

  it("never draws dressing scatter, however close it stands", () => {
    // A thin-instance host's bounding sphere spans EVERY instance, so on the
    // coast a weed mesh's sphere covers the whole map and the reach cull always
    // accepts it: each armed cube face re-drew all ~2,500 instances. Dressing
    // is excluded by name instead; boulders and the ledge (the walls) still cast.
    const s = scene();
    new FreeCamera("probe", Vector3.Zero(), s);
    const [light] = createFireLights(s);
    const map = light!.getShadowGenerator()!.getShadowMap()!;

    const weed = MeshBuilder.CreateBox("wallrun-weed-0", { size: 1 }, s);
    weed.position.set(1, 0.5, 0);
    weed.computeWorldMatrix(true);
    const rock = MeshBuilder.CreateBox("wallrun-rock-0", { size: 1 }, s);
    rock.position.set(1, 0.5, 1);
    rock.computeWorldMatrix(true);

    const drawn = new Set<string>();
    for (let f = 0; f < 6; f++) {
      map.onBeforeRenderObservable.notifyObservers(f);
      for (const mesh of map.getCustomRenderList!(f, [], 0) ?? []) drawn.add(mesh.name);
    }
    expect(drawn.has("wallrun-weed-0")).toBe(false);
    expect(drawn.has("wallrun-rock-0")).toBe(true);
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
