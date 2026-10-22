import {
  Color3,
  Constants,
  Effect,
  Matrix,
  Mesh,
  MeshBuilder,
  ShaderMaterial,
  SolidParticleSystem,
  StandardMaterial,
  Vector3,
  type Scene,
  type SolidParticle,
} from "@babylonjs/core";
import type { FireSpot } from "./lights";
import {
  COAL_Y,
  FLAME_GLSL,
  SPARKS,
  TONGUE_BRIGHT,
  TONGUE_H,
  TONGUE_W,
  fireFlicker,
  sparkPose,
  sparkRgb,
  sparkTable,
  type Spark,
  type SparkPose,
} from "./flame-field";

export { EMBER_LIFE, EMBER_TOP, SPARKS, emberHeight, emberLife } from "./flame-field";

/**
 * The fire itself, standing in the bowls that `lights.ts` lights the room from.
 *
 * Two populations, as in a real fire: the body of the flame, and the few specks
 * that break off the top and travel until they cool. Both are drawn from
 * `flame-field.ts`, which the menu's braziers burn too.
 *
 * ## The body is one ray-marched box per bowl
 *
 * It was three hundred solid embers a bowl, each living about a second and a
 * half over a flame under a metre tall. Every one was a bright point the eye
 * could follow, so the fire read as a fountain streaming upward, and too fast,
 * however the lifetimes were tuned. A real flame has no points in it: the base
 * is a continuous sheet that hardly moves, and only the top half tears into
 * tongues that rise and break off a couple of times a second.
 *
 * It is marched through a box standing in the bowl, not painted on an upright
 * quad: the camera looks 53 degrees down into the bowl, so a sheet showed as a
 * flat triangle whose foot was one straight line across the coals. In the box
 * the root is a disc over the coal bed, the core glows brighter than the edges
 * because the eye looks through more of it, and the flame keeps its shape from
 * every side of the room. Depth testing still lets a pillar in front hide it.
 *
 * ## The sparks stay solid
 *
 * Forty a bowl on a SolidParticleSystem, not thin instances: the thin-instance
 * `instanceColor` buffer is bound and still shades as `vec4(1.0)` in this scene,
 * which loses heat and alpha both. An SPS writes colour into the mesh's own
 * vertex buffer, the ordinary `VERTEXCOLOR` path.
 *
 * ## Why only the near bowls burn
 *
 * An area stands up to ten braziers and the camera shows nineteen units across,
 * so most of them are off screen. Only the `BOWLS` nearest within `FLAME_RANGE`
 * burn; the rest of the pool is parked. The cut is well outside the frame, so a
 * bowl swapping in never happens where it shows.
 */

/** The sparks' mesh, by name, so a rebuild finds it instead of making a second.
 *  Every flame mesh's name starts with it, which is how filters find them all. */
export const FLAME_MESH = "fire-flames";
/** The flame bodies' names: this, then the bowl's slot. */
export const FLAME_TONGUE = `${FLAME_MESH}-tongue-`;

/**
 * How many bowls may burn at once. Four is exactly `LIGHT_POOL`, which is not a
 * coincidence worth breaking: the bowls that burn are then the bowls that light
 * the room, so a brazier can never be lit with nothing in it or alight with no
 * pool under it.
 */
const BOWLS = 4;
/** Past this, in world units, a bowl is off screen. The frame's half-diagonal
 *  is about 10.6, so the swap always happens out of sight. */
export const FLAME_RANGE = 14;

/**
 * The coal face in world units, against the brazier `tools/build_props.py`
 * builds: its rim is at 1.02 and the coals mound just under it.
 */
const BASE_Y = 0.95;
const TONGUE_Y = BASE_Y - COAL_Y;

const FLAME_SHADER = "brazierFlame";

/**
 * The march, hosted in Babylon: the mesh is neither turned nor scaled, so its
 * local space is the bowl's, and `uEye` is the camera in that space. The box is
 * marched front to back from the face the fragment is on.
 */
function registerFlameShader(): void {
  if (Effect.ShadersStore[`${FLAME_SHADER}VertexShader`]) return;
  Effect.ShadersStore[`${FLAME_SHADER}VertexShader`] = `
    precision highp float;
    attribute vec3 position;
    uniform mat4 worldViewProjection;
    varying vec3 vPos;
    void main(void) {
      vPos = position;
      gl_Position = worldViewProjection * vec4(position, 1.0);
    }`;
  Effect.ShadersStore[`${FLAME_SHADER}FragmentShader`] = `
    precision highp float;
    varying vec3 vPos;
    uniform vec3 uEye;
    uniform float uTime;
    uniform float uFlick;
    uniform float uBright;
    ${FLAME_GLSL}
    void main(void) {
      // Wrapped, or the hash loses its low bits an hour into a session; the
      // pattern jumps once every ten minutes, for one frame.
      vec3 light = marchFlame(vPos, normalize(vPos - uEye), mod(uTime, 600.0));
      // Light, not paint: added straight onto the frame.
      gl_FragColor = vec4(light * uBright * uFlick, 1.0);
    }`;
}

/** One flame body: its mesh and the material its clock is set on. */
interface Tongue {
  mesh: Mesh;
  mat: ShaderMaterial;
  /** The camera in this bowl's local space. Its own vector, because the
   *  material keeps the reference it is given, not a copy. */
  eye: Vector3;
}

function buildTongue(scene: Scene, b: number): Tongue {
  const mesh = MeshBuilder.CreateBox(`${FLAME_TONGUE}${b}`, { width: TONGUE_W, height: TONGUE_H, depth: TONGUE_W }, scene);
  // Floor at the mesh's origin, which the shader's local space depends on.
  mesh.bakeTransformIntoVertices(Matrix.Translation(0, TONGUE_H / 2, 0));
  const mat = new ShaderMaterial(`${FLAME_TONGUE}${b}-mat`, scene, FLAME_SHADER, {
    attributes: ["position"],
    uniforms: ["worldViewProjection", "uEye", "uTime", "uFlick", "uBright"],
    needAlphaBlending: true,
  });
  mat.alphaMode = Constants.ALPHA_ADD;
  // Front faces only: each is where the eye's ray enters the box, and a back
  // face would march the same flame a second time.
  mat.backFaceCulling = true;
  // Additive light: a flame that wrote depth would cut out the sparks behind it.
  // Depth TESTING stays on, so a pillar in front of the bowl still hides it.
  mat.disableDepthWrite = true;
  const eye = new Vector3(0, 10, -10);
  mat.setVector3("uEye", eye);
  mat.setFloat("uTime", 0);
  mat.setFloat("uFlick", 1);
  mat.setFloat("uBright", TONGUE_BRIGHT);
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  mesh.setEnabled(false);
  return { mesh, mat, eye };
}

let sps: SolidParticleSystem | null = null;
let sparks: Spark[] = [];
let tongues: Tongue[] = [];

/** What `updateParticle` needs and cannot be handed: the bowls burning this
 *  frame, and the clock they burn on. */
let burning: readonly FireSpot[] = [];
let clock = 0;
/** Bowls given particles on the last update. */
let lit = BOWLS;
const pose: SparkPose = { x: 0, y: 0, z: 0, radius: 0, alpha: 0, u: 0 };
const rgb = [0, 0, 0];

/**
 * Build the flames and the spark table. Call once per scene, with the lights.
 *
 * Idempotent per scene, for the same reason the light pool is: this is cheap to
 * find and expensive to duplicate.
 */
export function createFireFlames(scene: Scene): Mesh | null {
  const found = scene.getMeshByName(FLAME_MESH) as Mesh | null;
  if (found && sps) return found;
  // A mesh this module has forgotten is a fire that cannot be driven. That is a
  // scene rebuilt after a reset, and the old meshes go.
  for (const m of scene.meshes.filter((x) => x.name.startsWith(FLAME_MESH))) m.dispose();

  registerFlameShader();
  tongues = Array.from({ length: BOWLS }, (_, b) => buildTongue(scene, b));

  const system = new SolidParticleSystem(FLAME_MESH, scene, { updatable: true });
  // Eight triangles. At this camera a spark covers a few pixels, so the solid's
  // own facets are below what can be resolved. Shared corners (`flat: false`):
  // 6 vertices instead of 24, and the material is unlit.
  const proto = MeshBuilder.CreatePolyhedron("fire-ember-proto", { type: 1, size: 0.5, flat: false }, scene);
  system.addShape(proto, BOWLS * SPARKS);
  proto.dispose();
  const m = system.buildMesh();

  const mat = new StandardMaterial("fire-flame-mat", scene);
  // White, because the per-particle vertex colour carries the hue: with the
  // lights off the composition resolves to `emissiveColor * vColor.rgb`.
  mat.emissiveColor = Color3.White();
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.disableLighting = true;
  mat.alphaMode = Constants.ALPHA_ADD;
  mat.backFaceCulling = false;
  mat.disableDepthWrite = true;
  m.material = mat;
  // Puts the mesh in the transparent pass AND turns on the shader's
  // `alpha *= vColor.a`. Without it the sparks render opaque, in the wrong pass.
  m.hasVertexAlpha = true;
  m.isPickable = false;
  m.receiveShadows = false;

  // Nothing here rotates, carries a UV or moves its own vertices, and the
  // particles are spread across the room rather than around the mesh's origin.
  system.computeParticleRotation = false;
  system.computeParticleTexture = false;
  system.computeParticleVertex = false;
  system.isAlwaysVisible = true;
  system.updateParticle = updateParticle;

  sparks = sparkTable(BOWLS);
  sps = system;
  // One pass so nothing is left at the origin on the first frame.
  system.setParticles();
  return m;
}

/** Forget the system. The scene that owned it is going away with it. */
export function resetFireFlames(): void {
  sps = null;
  sparks = [];
  tongues = [];
  burning = [];
  clock = 0;
  lit = BOWLS;
}

/** How many sparks are alight, for tests. */
export function flameParticleCount(): number {
  return Math.min(burning.length, BOWLS) * SPARKS;
}

/**
 * Burn the bowls nearest the camera. Called once a frame by `updateFireLights`,
 * on that module's clock so the flame and the light it throws breathe together.
 */
export function updateFireFlames(near: readonly FireSpot[], now: number): void {
  if (!sps) return;
  burning = near;
  clock = now;
  for (let b = 0; b < BOWLS; b++) {
    const s = near[b];
    const tongue = tongues[b];
    if (!s) {
      tongue?.mesh.setEnabled(false);
      continue;
    }
    if (!tongue) continue;
    const ph = now + s.phase;
    tongue.mesh.position.set(s.x, TONGUE_Y, s.z);
    tongue.mesh.setEnabled(true);
    const cam = tongue.mesh.getScene().activeCamera;
    if (cam) tongue.mat.setVector3("uEye", cam.globalPosition.subtractToRef(tongue.mesh.position, tongue.eye));
    tongue.mat.setFloat("uTime", ph);
    // Half the light's swing: the body is the steady part of a fire.
    tongue.mat.setFloat("uFlick", 0.5 + 0.5 * fireFlicker(ph));
  }
  // Only the bowls alight now, plus any that went out since last frame so their
  // sparks get parked once. Every bowl beyond both is already parked.
  const alight = Math.min(near.length, BOWLS);
  const span = Math.max(alight, lit);
  lit = alight;
  if (span > 0) sps.setParticles(0, span * SPARKS - 1);
}

function updateParticle(p: SolidParticle): SolidParticle {
  const b = (p.idx / SPARKS) | 0;
  const s = burning[b];
  if (!s || b >= BOWLS) {
    // Parked, not merely invisible: a zero-scale particle still has a position,
    // and one left at the world origin stretches the mesh's bounds from the
    // brazier to the middle of the map. Stack them on a bowl that IS burning.
    p.scaling.setAll(0);
    const anchor = burning[0];
    if (anchor) p.position.set(anchor.x, BASE_Y, anchor.z);
    return p;
  }
  sparkPose(sparks[p.idx]!, clock, pose);
  p.position.set(s.x + pose.x, BASE_Y + pose.y, s.z + pose.z);
  // The prototype's corners sit at half its scale.
  p.scaling.setAll(pose.radius * 2);
  sparkRgb(pose.u, rgb);
  const c = p.color!;
  c.r = rgb[0]! / 255;
  c.g = rgb[1]! / 255;
  c.b = rgb[2]! / 255;
  c.a = pose.alpha;
  return p;
}
