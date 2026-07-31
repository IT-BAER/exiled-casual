import {
  Color3,
  Constants,
  Mesh,
  StandardMaterial,
  Texture,
  Vector3,
  VertexBuffer,
  type Scene,
} from "@babylonjs/core";
import type { FireSpot } from "./lights";

/** The single batched mesh used by every visible brazier flame. */
export const FLAME_MESH = "fire-flames";

/** Past this distance a bowl is outside the camera framing. */
export const FLAME_RANGE = 14;

const FIRE_ATLAS = "/textures/effects/brazier-fire.png";
const COLS = 8;
const ROWS = 6;
const FRAMES = COLS * ROWS;
const FPS = 24;
const BOWLS = 4;
const TILE = 128;
// The procedural plane has stable empty margins. Cropping those margins here
// makes the burning body fill the bowl without resampling every baked frame.
const CROP_LEFT = 24;
const CROP_RIGHT = 104;
const CROP_TOP = 2;
const CROP_BOTTOM = 102;
const BASE_Y = 0.83;
const HEIGHT = 1.18;
const WIDTH = 0.82;

let flameMesh: Mesh | null = null;
let flameScene: Scene | null = null;
let burning: readonly FireSpot[] = [];

/**
 * Build four updatable quads in one draw call.
 *
 * The source is Matthew Ames's procedural Blendkit fire. Blender bakes it to
 * the RGB atlas at build time because the 127-node material cannot be exported
 * to Babylon. Black pixels disappear under additive blending, while the bowl
 * still occludes the lower edge through the ordinary depth test.
 */
export function createFireFlames(scene: Scene): Mesh | null {
  const found = scene.getMeshByName(FLAME_MESH) as Mesh | null;
  if (found && flameMesh === found) return found;
  found?.dispose();

  const mesh = new Mesh(FLAME_MESH, scene);
  const positions = new Array<number>(BOWLS * 4 * 3).fill(0);
  const uvs = new Array<number>(BOWLS * 4 * 2).fill(0);
  const indices: number[] = [];
  for (let bowl = 0; bowl < BOWLS; bowl++) {
    const vertex = bowl * 4;
    indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
  }
  mesh.setVerticesData(VertexBuffer.PositionKind, positions, true);
  mesh.setVerticesData(VertexBuffer.UVKind, uvs, true);
  mesh.setIndices(indices);

  const texture = new Texture(FIRE_ATLAS, scene, false, true);
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  const material = new StandardMaterial("fire-flame-mat", scene);
  material.emissiveTexture = texture;
  material.emissiveColor = Color3.Black();
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.disableLighting = true;
  material.alphaMode = Constants.ALPHA_ADD;
  // The atlas is RGB. A value just below one puts it in the transparent pass;
  // additive black then contributes nothing without needing a second alpha map.
  material.alpha = 0.999;
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  mesh.alwaysSelectAsActiveMesh = true;

  flameMesh = mesh;
  flameScene = scene;
  updateGeometry(0);
  return mesh;
}

/** Forget scene-owned state when the renderer is rebuilt. */
export function resetFireFlames(): void {
  flameMesh = null;
  flameScene = null;
  burning = [];
}

/** Number of vertices currently carrying visible fire, for focused tests. */
export function flameParticleCount(): number {
  return Math.min(burning.length, BOWLS) * 4;
}

/** Advance each visible bowl's independently phased flipbook. */
export function updateFireFlames(near: readonly FireSpot[], now: number): void {
  if (!flameMesh) return;
  burning = near;
  updateGeometry(now);
}

function updateGeometry(now: number): void {
  if (!flameMesh) return;
  const positions = new Array<number>(BOWLS * 4 * 3).fill(0);
  const uvs = new Array<number>(BOWLS * 4 * 2).fill(0);

  const right = flameScene?.activeCamera?.getDirection(Vector3.Right()) ?? Vector3.Right();
  right.y = 0;
  if (right.lengthSquared() < 0.001) right.copyFromFloats(1, 0, 0);
  right.normalize().scaleInPlace(WIDTH / 2);

  for (let bowl = 0; bowl < BOWLS; bowl++) {
    const spot = burning[bowl];
    const anchor = spot ?? burning[0];
    if (!anchor) continue;
    const p = bowl * 12;
    const leftX = anchor.x - right.x;
    const leftZ = anchor.z - right.z;
    const rightX = anchor.x + right.x;
    const rightZ = anchor.z + right.z;
    positions.splice(p, 12,
      leftX, BASE_Y, leftZ,
      rightX, BASE_Y, rightZ,
      rightX, BASE_Y + HEIGHT, rightZ,
      leftX, BASE_Y + HEIGHT, leftZ,
    );
    if (!spot) continue;

    const frame = Math.floor(Math.max(0, now + spot.phase) * FPS) % FRAMES;
    const row = Math.floor(frame / COLS);
    const col = frame % COLS;
    // Half a texel keeps linear filtering out of the neighbouring frame.
    const u0 = (col * TILE + CROP_LEFT + 0.5) / (COLS * TILE);
    const u1 = (col * TILE + CROP_RIGHT - 0.5) / (COLS * TILE);
    const v0 = (row * TILE + CROP_TOP + 0.5) / (ROWS * TILE);
    const v1 = (row * TILE + CROP_BOTTOM - 0.5) / (ROWS * TILE);
    const uv = bowl * 8;
    uvs.splice(uv, 8, u0, v1, u1, v1, u1, v0, u0, v0);
  }

  flameMesh.updateVerticesData(VertexBuffer.PositionKind, positions, true);
  flameMesh.updateVerticesData(VertexBuffer.UVKind, uvs);
}
