// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  FreeCamera, Matrix, MeshBuilder, NullEngine, PointLight, Scene, ShadowGenerator, Vector3,
} from "@babylonjs/core";
import { cullCasters, cullShadowCasters } from "./shadow-cull";

/**
 * The frustum of one face of a point light's shadow cube: 90 degrees, square,
 * looking down world +Z from the origin, near 0.4 and far 11 — the torch's own
 * `shadowMinZ`/`shadowMaxZ`. Built here from Babylon's matrix maths rather than
 * from anything `shadow-cull` does, so the expectations below come from geometry
 * and not from the code under test.
 */
const face = (): Matrix =>
  Matrix.LookAtLH(Vector3.Zero(), new Vector3(0, 0, 1), Vector3.Up())
    .multiply(Matrix.PerspectiveFovLH(Math.PI / 2, 1, 0.4, 11));

describe("cullCasters", () => {
  it("keeps a caster the face can see and drops the five sixths it cannot", () => {
    const scene = new Scene(new NullEngine());
    const at = (x: number, y: number, z: number) => {
      const box = MeshBuilder.CreateBox(`box-${x}-${y}-${z}`, { size: 0.5 }, scene);
      box.position.set(x, y, z);
      box.computeWorldMatrix(true);
      return box;
    };
    const front = at(0, 0, 5);
    const behind = at(0, 0, -5);
    const left = at(-5, 0, 0);
    const above = at(0, 5, 0);

    const out = cullCasters(face(), [front, behind, left, above], 4, []);

    expect(out).toEqual([front]);
  });

  it("drops a caster past the light's reach, which cannot darken a lit pixel", () => {
    const scene = new Scene(new NullEngine());
    const far = MeshBuilder.CreateBox("far", { size: 0.5 }, scene);
    far.position.set(0, 0, 40); // dead ahead, but well past the 11-unit far plane
    far.computeWorldMatrix(true);

    expect(cullCasters(face(), [far], 1, [])).toEqual([]);
  });

  it("reuses the array it is handed instead of allocating one per face", () => {
    const scene = new Scene(new NullEngine());
    const front = MeshBuilder.CreateBox("front", { size: 0.5 }, scene);
    front.position.set(0, 0, 5);
    front.computeWorldMatrix(true);
    const out: typeof front[] = [];

    expect(cullCasters(face(), [front], 1, out)).toBe(out);
    // ...and a second pass leaves one entry, not two.
    expect(cullCasters(face(), [front], 1, out)).toHaveLength(1);
  });
});

describe("a shadow map given its own caster filter", () => {
  /** A lit point light with a shadow cube, and a camera so its projection exists. */
  const lamp = () => {
    const scene = new Scene(new NullEngine());
    new FreeCamera("probe", Vector3.Zero(), scene);
    const light = new PointLight("lamp", Vector3.Zero(), scene);
    light.shadowMinZ = 0.4;
    light.shadowMaxZ = 11;
    const gen = new ShadowGenerator(256, light);
    return { scene, gen, map: gen.getShadowMap()! };
  };

  it("asks the filter once a frame however many faces the cube has", () => {
    const { scene, gen, map } = lamp();
    MeshBuilder.CreateBox("wall", { size: 1 }, scene).computeWorldMatrix(true);
    let asked = 0;
    cullShadowCasters(gen, () => (asked++, true));

    for (let f = 0; f < 6; f++) {
      map.onBeforeRenderObservable.notifyObservers(f);
      map.getCustomRenderList!(f, [], 0);
    }

    // One mesh in the scene, six faces: six calls would be the per-face filtering
    // that made the first attempt at this 30% slower than the churn it removed.
    expect(asked).toBe(scene.meshes.length);
  });
});
