import {
  ArcRotateCamera,
  Color3,
  Color4,
  DynamicTexture,
  HemisphericLight,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
  type Engine,
} from "@babylonjs/core";

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
  // beta ~0.72 (≈49° elevation) + a narrow fov + long radius gives a flat, near-
  // orthographic high-isometric look like PoE, instead of a wide-angle receding plane.
  const camera = new ArcRotateCamera(
    "cam",
    -Math.PI / 2,
    0.72,
    48,
    Vector3.Zero(),
    scene,
  );
  camera.fov = 0.4;
  camera.lowerRadiusLimit = 20;
  camera.upperRadiusLimit = 90;

  new HemisphericLight("sun", new Vector3(0, 1, 0), scene);

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
    // greybox grid: scale + motion cues (needs a real 2D canvas; NullEngine lacks one)
    groundMat.diffuseTexture = makeGridTexture(scene);
  } catch {
    groundMat.diffuseColor = new Color3(0.2, 0.22, 0.27); // headless fallback
  }
  groundMat.specularColor = new Color3(0, 0, 0); // matte, no hotspot
  ground.material = groundMat;

  return { scene, camera };
}

/** A slate grid drawn to a canvas texture: 4-unit cells across the 200u floor. */
function makeGridTexture(scene: Scene): DynamicTexture {
  const S = 1024;
  const tex = new DynamicTexture("grid", { width: S, height: S }, scene, false);
  const ctx = tex.getContext();
  ctx.fillStyle = "#20242b";
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = "#39414e";
  ctx.lineWidth = 1;
  const cells = 50; // 200u / 50 = 4-unit cells
  const step = S / cells;
  for (let i = 0; i <= cells; i++) {
    const p = i * step;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(S, p);
    ctx.stroke();
  }
  tex.update();
  return tex;
}
