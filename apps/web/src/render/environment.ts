/**
 * A procedural sky/ground cube, so a PBR metal has something to put in its
 * specular lobe.
 *
 * The wardrobe's plate material is metallic ~0.95 over most of its texels, and
 * a PBR metal has no diffuse term: with no `scene.environmentTexture` anywhere
 * in this client, the rough specular lobe misses the sun on most normals and
 * the armour renders flat black. There is no captured HDR to load and none may
 * enter the repo, so this generates one in code: a two-colour gradient baked
 * into a small cube plus its analytic spherical-harmonic irradiance.
 */
import {
  BaseTexture,
  Color3,
  Constants,
  InternalTexture,
  InternalTextureSource,
  RawCubeTexture,
  Scene,
  SphericalHarmonics,
  SphericalPolynomial,
  Texture,
  Vector3,
} from "@babylonjs/core";

/** Stable name the texture is looked up by, so a second call (a biome change)
 *  disposes the old cube instead of leaking one per area. */
const NAME = "sky-environment";

/**
 * Texels per face. The cube only ever feeds a rough specular lobe and a
 * baked-once SH irradiance, both of which blur a two-colour gradient well past
 * the point a sharper cube would read differently — 32 keeps six faces plus
 * mip chain cheap to rebuild on every area change without buying anything a
 * render would show.
 */
const FACE_SIZE = 32;

/** Neutral sky/ground for the procedural environment cube — a dim, cool
 *  overhead and a darker stone-coloured floor bounce, close to what the fill
 *  light and the flagstone floor already look like. Neutral and per-scene, not
 *  per-biome: `applyBiomeTint` runs from the worker's area message, which can
 *  land before `loadPlayerRig` resolves, and building this cube before the
 *  wardrobe's glTF import is what blackens every PBR material in the scene. */
export const SKY_COLOR = new Color3(0.35, 0.4, 0.5);
export const GROUND_COLOR = new Color3(0.14, 0.13, 0.11);
/** `scene.environmentIntensity`. 1.0, Babylon's own default weight for an IBL
 *  contribution: this cube only exists so a metal's rough specular lobe has
 *  something besides black to sample, not to relight the scene. A dielectric
 *  (`metallic = 0`, every client-authored material here) keeps its own
 *  small ~0.04 grazing-angle Fresnel reflectance regardless — a genuinely
 *  brighter environment would show up there too — but the sky/ground cube
 *  above is dim next to SUN_INTENSITY/FILL_INTENSITY, so that term stays a
 *  minor grazing highlight rather than a visible relight. */
export const ENVIRONMENT_INTENSITY = 1.0;

/** t*t*(3-2t): blends the horizon instead of cutting it. A hard split at y=0
 *  shows up as a seam once a rough metal reflects it. */
function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * Direction a cube face texel points, in OpenGL's standard cubemap face basis
 * — the one WebGL's `TEXTURE_CUBE_MAP_POSITIVE_X` etc. use and so the one
 * `updateRawCubeTexture`'s face data is expected in. `u`/`v` run -1..1 across
 * the face, row-major top-to-bottom (this is built with `invertY: false`).
 */
function faceDirection(face: number, u: number, v: number): Vector3 {
  switch (face) {
    case 0:
      return new Vector3(1, -v, -u); // +X
    case 1:
      return new Vector3(-1, -v, u); // -X
    case 2:
      return new Vector3(u, 1, v); // +Y
    case 3:
      return new Vector3(u, -1, -v); // -Y
    case 4:
      return new Vector3(u, -v, 1); // +Z
    default:
      return new Vector3(-u, -v, -1); // -Z
  }
}

/** Linear colour at a direction: `ground` at straight down, `sky` at straight
 *  up, smoothstepped across the sphere between. */
function colorAt(dir: Vector3, sky: Color3, ground: Color3): Color3 {
  return Color3.Lerp(ground, sky, smoothstep((dir.y + 1) / 2));
}

export interface SkyEnvironmentOptions {
  sky: Color3;
  ground: Color3;
  /** `scene.environmentIntensity`. Defaults to 1. */
  intensity?: number;
}

/**
 * Builds the sky cube, sets it as `scene.environmentTexture`, and returns it.
 * Idempotent per scene: a previous cube built by this function is disposed
 * first, so calling it again on a biome change does not leak one texture per
 * area — the same convention as the `getLightByName`/`getMaterialByName`
 * lookups elsewhere in this file's neighbours.
 */
export function buildSkyEnvironment(scene: Scene, opts: SkyEnvironmentOptions): BaseTexture {
  const previous = scene.textures.find((t) => t.name === NAME);
  previous?.dispose();

  const { sky, ground, intensity = 1 } = opts;
  const size = FACE_SIZE;
  const faces: Uint8Array[] = [];
  // Per-texel direction, colour and raw (unnormalised) solid-angle weight,
  // kept alongside the face data so the SH pass below can reuse both without
  // recomputing the face basis.
  const samples: { dir: Vector3; color: Color3; weight: number }[] = [];
  let totalRawWeight = 0;

  for (let face = 0; face < 6; face++) {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (2 * (x + 0.5)) / size - 1;
        const v = (2 * (y + 0.5)) / size - 1;
        const dir = faceDirection(face, u, v).normalize();
        const color = colorAt(dir, sky, ground);
        // The projection from a flat cube face to the sphere is not uniform:
        // texels nearer a face's centre subtend more solid angle than the
        // corners. `(2/size)^2` is the flat texel's own area in uv space, and
        // `1/(1+u^2+v^2)^{1.5}` is the Jacobian that maps it onto the unit
        // sphere. Summed and renormalised below rather than trusted outright,
        // so floating-point drift never lets the total stray from 4*PI.
        const weight = (2 / size) ** 2 / (1 + u * u + v * v) ** 1.5;
        samples.push({ dir, color, weight });
        totalRawWeight += weight;

        const i = (y * size + x) * 4;
        data[i] = Math.round(Math.min(1, color.r) * 255);
        data[i + 1] = Math.round(Math.min(1, color.g) * 255);
        data[i + 2] = Math.round(Math.min(1, color.b) * 255);
        data[i + 3] = 255;
      }
    }
    faces.push(data);
  }

  const solidAngleScale = (4 * Math.PI) / totalRawWeight;
  const sh = new SphericalHarmonics();
  for (const s of samples) sh.addLight(s.dir, s.color, s.weight * solidAngleScale);
  sh.convertIncidentRadianceToIrradiance();
  sh.convertIrradianceToLambertianRadiance();
  // No `preScaleForRendering()`: that bakes the raw Ylm basis constants in for
  // shaders that evaluate the 9 SH coefficients directly at runtime.
  // `SphericalPolynomial.FromHarmonics` below is the other reconstruction path
  // babylon.js ships (the one `BaseTexture.sphericalPolynomial` actually reads
  // in the PBR shader) and applies its own, different set of constants — doing
  // both applies two incompatible normalisations to the same linear terms and
  // flips their sign, verified by asserting the sky-above-ground direction
  // below and watching it fail with this line in.

  // `RawCubeTexture` is the supported path and the only one that runs the full
  // cube setup: face allocation, CLAMP_TO_EDGE on both axes, the trilinear
  // filters and the mip chain. Uploading into a hand-built `InternalTexture`
  // skips all of that and binds a cube the shader samples as black, which is
  // the very failure this file exists to remove.
  //
  // It reaches straight into a WebGL context, though, and `NullEngine` (every
  // render test in this package, including this file's own) has none. So the
  // headless branch builds just the metadata every caller reads - `isCube`,
  // `getSize`, `sphericalPolynomial` - and skips the pixel upload, which is
  // real GPU work and impossible there.
  let texture: BaseTexture;
  if (scene.getEngine().getRenderingCanvas()) {
    texture = new RawCubeTexture(
      scene,
      faces,
      size,
      Constants.TEXTUREFORMAT_RGBA,
      Constants.TEXTURETYPE_UNSIGNED_BYTE,
      true,
      false,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
  } else {
    const internal = new InternalTexture(scene.getEngine(), InternalTextureSource.CubeRaw);
    internal.isCube = true;
    internal.width = size;
    internal.height = size;
    internal.format = Constants.TEXTUREFORMAT_RGBA;
    internal.type = Constants.TEXTURETYPE_UNSIGNED_BYTE;
    internal.generateMipMaps = true;
    internal.samplingMode = Texture.TRILINEAR_SAMPLINGMODE;
    internal.invertY = false;
    internal.isReady = true;
    texture = new BaseTexture(scene, internal);
  }
  texture.name = NAME;
  // Linear data written above, and this says so: get it wrong and the whole
  // scene's ambient shifts, since Babylon otherwise assumes sRGB and decodes
  // the bytes a second time.
  texture.gammaSpace = false;
  texture.sphericalPolynomial = SphericalPolynomial.FromHarmonics(sh);

  scene.environmentTexture = texture;
  scene.environmentIntensity = intensity;
  return texture;
}
