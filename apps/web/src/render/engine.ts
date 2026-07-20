import {
  ArcRotateCamera,
  Camera,
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Texture,
  Vector3,
  type Engine,
} from "@babylonjs/core";

/** Half-height of the orthographic view in world units (smaller = more zoomed in). */
const ORTHO_HALF_HEIGHT = 10;

/** Flagstone texture repeats across the 200u floor (25 → ~8u per tile). */
const FLOOR_TILES = 25;

export interface SceneHandle {
  scene: Scene;
  camera: ArcRotateCamera;
}

export function createScene(engine: Engine): SceneHandle {
  const scene = new Scene(engine);
  // Dark background so the greybox arena reads against the page (default is white,
  // which made a white ground plane invisible on a white page).
  scene.clearColor = new Color4(0.09, 0.1, 0.12, 1);

  // Top-down-ish camera: positioned above the origin, looking down at the
  // ground plane (xz). Alpha=0, beta=π/4 gives a comfortable isometric feel.
  // alpha=-π/2 puts the camera on the -Z side looking toward +Z, so world +x =
  // screen-right and world +z (sim +y) = screen-up — WASD then matches the view.
  // beta ~0.72 (≈49° elevation) is the isometric tilt.
  const camera = new ArcRotateCamera(
    "cam",
    -Math.PI / 2,
    0.72,
    40,
    Vector3.Zero(),
    scene,
  );
  // Orthographic projection: no perspective vanishing point, so grid lines stay
  // parallel — a flat high-isometric ARPG look, not a wide receding "CCTV" plane.
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  const applyOrtho = () => {
    const aspect = engine.getRenderWidth() / engine.getRenderHeight();
    camera.orthoTop = ORTHO_HALF_HEIGHT;
    camera.orthoBottom = -ORTHO_HALF_HEIGHT;
    camera.orthoLeft = -ORTHO_HALF_HEIGHT * aspect;
    camera.orthoRight = ORTHO_HALF_HEIGHT * aspect;
  };
  applyOrtho();
  engine.onResizeObservable.add(applyOrtho);

  // Dim sky fill so shadowed sides stay readable instead of going black...
  const fill = new HemisphericLight("fill", new Vector3(0, 1, 0), scene);
  fill.intensity = 0.5;
  // ...and a key light raking across the arena, which is what gives the actors
  // a lit side and a dark side instead of the flat cutout look. Cast shadows are
  // faked per-actor in meshes.ts: a real directional shadow map would need its
  // frustum dragged along with the follow camera across the whole 200u floor.
  const sun = new DirectionalLight("sun", new Vector3(-0.55, -1, -0.4), scene);
  sun.intensity = 0.85;

  // Pickable greybox floor. bindings.ts resolves click-to-move and pointer aim
  // via scene.pick().hit; without a ground mesh, picks on empty space miss and
  // those inputs only fire when the cursor is over an entity mesh. 200 = 2×
  // WORLD_MAX (movement.ts fp(±100)) so every reachable position is pickable;
  // bump this if WORLD bounds grow.
  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: 200, height: 200 },
    scene,
  );
  const groundMat = new StandardMaterial("groundMat", scene);
  try {
    // Real flagstone floor, tiled across the plane. Texture load is async and
    // non-fatal under NullEngine (no canvas), so tests keep the unloaded texture.
    const floor = new Texture("/textures/floor.png", scene);
    floor.uScale = FLOOR_TILES;
    floor.vScale = FLOOR_TILES;
    groundMat.diffuseTexture = floor;
  } catch {
    groundMat.diffuseColor = new Color3(0.2, 0.22, 0.27); // headless fallback
  }
  groundMat.specularColor = new Color3(0, 0, 0); // matte, no hotspot
  ground.material = groundMat;

  return { scene, camera };
}
