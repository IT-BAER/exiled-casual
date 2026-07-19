import {
  ArcRotateCamera,
  HemisphericLight,
  Scene,
  Vector3,
  type Engine,
} from "@babylonjs/core";

export interface SceneHandle {
  scene: Scene;
  camera: ArcRotateCamera;
}

export function createScene(engine: Engine): SceneHandle {
  const scene = new Scene(engine);

  // Top-down-ish camera: positioned above the origin, looking down at the
  // ground plane (xz). Alpha=0, beta=π/4 gives a comfortable isometric feel.
  const camera = new ArcRotateCamera(
    "cam",
    0,
    Math.PI / 4,
    30,
    Vector3.Zero(),
    scene,
  );
  camera.lowerRadiusLimit = 5;
  camera.upperRadiusLimit = 80;

  new HemisphericLight("sun", new Vector3(0, 1, 0), scene);

  return { scene, camera };
}
