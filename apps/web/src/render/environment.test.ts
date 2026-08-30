// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { Color3, NullEngine, Scene } from "@babylonjs/core";
import { buildSkyEnvironment } from "./environment";

let engine: InstanceType<typeof NullEngine>;

afterEach(() => {
  engine?.dispose();
});

const SKY = new Color3(0.6, 0.7, 0.9);
const GROUND = new Color3(0.05, 0.04, 0.03);

describe("buildSkyEnvironment", () => {
  it("builds a 6-face cube at the authored size", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);

    const texture = buildSkyEnvironment(scene, { sky: SKY, ground: GROUND });

    expect(texture.isCube).toBe(true);
    expect(texture.getSize().width).toBe(32);
    expect(texture.getSize().height).toBe(32);
  });

  it("bakes a non-zero spherical polynomial for the diffuse irradiance", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);

    const texture = buildSkyEnvironment(scene, { sky: SKY, ground: GROUND });

    const poly = texture.sphericalPolynomial;
    expect(poly).not.toBeNull();
    expect(poly!.x.lengthSquared() + poly!.y.lengthSquared() + poly!.z.lengthSquared()).toBeGreaterThan(0);
  });

  it("keeps the gradient right way up: a brighter sky than ground lands on l10's sign", () => {
    // l10 is the SH band along the pole axis (y here) — the harmonics that
    // `sphericalPolynomial` was built from are private, so this reads the
    // irradiance itself at the poles instead of reaching into the SH.
    engine = new NullEngine();
    const scene = new Scene(engine);

    const texture = buildSkyEnvironment(scene, { sky: SKY, ground: GROUND });
    const poly = texture.sphericalPolynomial!;

    // Lambertian irradiance at a surface normal n, from the baked polynomial:
    // the same expansion Babylon's own PBR shader evaluates.
    const irradiance = (nx: number, ny: number, nz: number): number => {
      const c = poly.x.scale(nx).add(poly.y.scale(ny)).add(poly.z.scale(nz))
        .add(poly.xx.scale(nx * nx))
        .add(poly.yy.scale(ny * ny))
        .add(poly.zz.scale(nz * nz))
        .add(poly.xy.scale(nx * ny))
        .add(poly.yz.scale(ny * nz))
        .add(poly.zx.scale(nz * nx));
      return (c.x + c.y + c.z) / 3;
    };

    expect(irradiance(0, 1, 0)).toBeGreaterThan(irradiance(0, -1, 0));
  });

  it("sets scene.environmentTexture, and a second call does not leak a texture", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);

    const first = buildSkyEnvironment(scene, { sky: SKY, ground: GROUND });
    expect(scene.environmentTexture).toBe(first);
    const countAfterFirst = scene.textures.filter((t) => t.name === "sky-environment").length;
    expect(countAfterFirst).toBe(1);

    const second = buildSkyEnvironment(scene, { sky: SKY, ground: GROUND, intensity: 0.5 });
    expect(scene.environmentTexture).toBe(second);
    expect(scene.textures.filter((t) => t.name === "sky-environment").length).toBe(1);
    expect(scene.environmentIntensity).toBe(0.5);
  });
});
