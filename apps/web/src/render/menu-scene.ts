/**
 * The character standing in the hall on the select screen.
 *
 * The hall is a painting and the character is the real rig, lit to match it.
 * That join is the whole trick and it is also the whole risk: a 3D figure in
 * front of a 2D matte reads as a sticker the instant its key light disagrees
 * with the light in the painting. So the lights here are not "nice lighting" —
 * they are a reconstruction of `select_backdrop.jpg`'s own: a cold, weak wash
 * falling from the dome, and two warm braziers low and wide, one either side,
 * exactly where the art has them.
 *
 * Deliberately its own tiny scene rather than a corner of the game's. The game's
 * scene carries shadow generators, SSAO, fog and a torch that follows the
 * player; none of it applies to one man standing still, and all of it would have
 * to be undone. This is a camera, three lights and a rig.
 */
import {
  Color3,
  Color4,
  Engine,
  FreeCamera,
  HemisphericLight,
  Light,
  Mesh,
  PointLight,
  Scene,
  Vector3,
} from "@babylonjs/core";
import { attachRig, loadPlayerRig, resetPlayerRig, type Looks, type RigActor } from "./rig";

/**
 * Where the character's feet sit, in the backdrop's floor.
 *
 * Left of the throne on screen, which is +X: the camera looks down -Z, and in
 * Babylon's left-handed world that flips which side +X lands on. The throne's
 * plinth runs up the middle of the painting and a figure standing in front of it
 * loses its silhouette against carved stone.
 */
const FEET = new Vector3(0.5, 0, 0);

/**
 * A three-quarter turn away from square-on.
 *
 * Not a stylistic choice. `base.head` is GENERATED (see CLAUDE.md): it is rigid
 * geometry pinned to a flat skin texel, so it has no features at all. At ARPG
 * distance that is invisible; at select-screen distance, lit and face-on, it is
 * a blank mask. Turned, hooded and lit from behind, it reads as a face in
 * shadow, which is the honest thing to do with a head that does not have one.
 */
const FACING = -0.42;
/**
 * Where the virtual camera stands.
 *
 * Set by eye against `select_backdrop.jpg`, and the two numbers that matter are
 * the distance and the height: the distance decides how much of the canvas the
 * character occupies (at this fov he is a little under half its height, which is
 * where PoE's own select screen puts him), and the height has to sit near the
 * painting's horizon or he stands on the floor at one angle while the hall runs
 * at another.
 */
const CAMERA = new Vector3(0, 1.5, 8.4);
const LOOK_AT = new Vector3(0, 0.92, 0);

/** Cold wash from the dome. Weak: this room is lit by fire, not by sky, and a
 *  bright front fill is exactly what would light up the featureless face. */
const FILL_INTENSITY = 0.15;
const FILL_SKY = new Color3(0.52, 0.62, 0.78);
const FILL_GROUND = new Color3(0.08, 0.09, 0.12);

/** The two braziers, in world units either side of the character and low. */
const BRAZIER_COLOR = new Color3(1.0, 0.58, 0.24);
const BRAZIER_INTENSITY = 3.0;
const BRAZIER_RANGE = 14;
/**
 * BEHIND him and to the sides, which is where the painting has them: either side
 * of the throne, upstage of anyone standing on the open floor. Putting them
 * downstage would have been prettier on the armour and wrong about the room.
 */
const BRAZIERS: readonly Vector3[] = [
  new Vector3(-3.4, 0.6, -2.2),
  new Vector3(3.4, 0.6, -2.2),
];

/**
 * A cold kicker from behind, which is what separates a dark figure from a dark
 * room. Without it the silhouette merges into the statue's plinth entirely.
 */
const RIM_COLOR = new Color3(0.62, 0.74, 0.95);
const RIM_INTENSITY = 4.6;

export interface MenuStage {
  /** Dress the character. Visibility only, so it never restarts the idle. */
  setLooks(looks: Looks): void;
  /** Lean the camera with the pointer, so the figure sits in the parallax. */
  setLean(x: number, y: number): void;
  dispose(): void;
}

/**
 * Build the stage on `canvas`, or resolve null when the wardrobe could not be
 * fetched. Null is not an error: the select screen keeps its backdrop and its
 * roster, and loses only the figure — which is exactly what happens headlessly.
 */
export async function createMenuStage(canvas: HTMLCanvasElement): Promise<MenuStage | null> {
  const engine = new Engine(canvas, true, { alpha: true, premultipliedAlpha: false });
  const scene = new Scene(engine);
  // Transparent, so the painted hall behind the canvas IS the background.
  scene.clearColor = new Color4(0, 0, 0, 0);
  scene.autoClear = true;

  const camera = new FreeCamera("menu-cam", CAMERA.clone(), scene);
  camera.setTarget(LOOK_AT);
  camera.fov = 0.62;
  camera.minZ = 0.1;
  camera.maxZ = 40;

  const fill = new HemisphericLight("menu-fill", new Vector3(0, 1, 0), scene);
  fill.intensity = FILL_INTENSITY;
  fill.diffuse = FILL_SKY;
  fill.groundColor = FILL_GROUND;

  for (const [i, at] of BRAZIERS.entries()) {
    const b = new PointLight(`menu-brazier-${i}`, at.clone(), scene);
    b.diffuse = BRAZIER_COLOR;
    b.specular = BRAZIER_COLOR.scale(0.35);
    b.intensity = BRAZIER_INTENSITY;
    b.range = BRAZIER_RANGE;
    b.falloffType = Light.FALLOFF_GLTF;
  }

  const rim = new PointLight("menu-rim", new Vector3(0.9, 2.6, -3.2), scene);
  rim.diffuse = RIM_COLOR;
  rim.specular = RIM_COLOR;
  rim.intensity = RIM_INTENSITY;
  rim.range = 12;
  rim.falloffType = Light.FALLOFF_GLTF;

  await loadPlayerRig(scene);

  const host = new Mesh("menu-actor", scene);
  host.position.copyFrom(FEET);
  // The glTF loader's right-to-left-handed conversion already points these
  // characters at +Z (see RIG_YAW in rig.ts) and the camera stands on +Z, so
  // zero is square-on to the viewer and a half turn shows his back — which,
  // from behind a hood, looks enough like a face to be worth stating.
  host.rotation.y = FACING;
  const rig: RigActor | null = attachRig(scene, host);
  // Standing still is a locomotion speed of zero, which is the idle clip. Asking
  // for the clip by name would duplicate the walk/run hysteresis that already
  // lives in `clipForSpeed`.
  rig?.setLocomotion(0);

  let lean = { x: 0, y: 0 };
  const render = () => {
    // A very small lean: the figure is the anchor of the composition, and moving
    // it as much as the backdrop moves would swim.
    camera.position.set(CAMERA.x + lean.x * 0.11, CAMERA.y - lean.y * 0.05, CAMERA.z);
    camera.setTarget(LOOK_AT);
    scene.render();
  };
  engine.runRenderLoop(render);

  const onResize = () => engine.resize();
  window.addEventListener("resize", onResize);

  return {
    setLooks(looks) {
      rig?.setLooks(looks);
    },
    setLean(x, y) {
      lean = { x, y };
    },
    dispose() {
      window.removeEventListener("resize", onResize);
      engine.stopRenderLoop(render);
      rig?.dispose();
      // The cached wardrobe containers belong to the scene about to be disposed;
      // leaving them cached hands the GAME a rig built against a dead scene.
      // Scoped to THIS scene: an abandoned stage must not clear the cache a live
      // one is using.
      resetPlayerRig(scene);
      scene.dispose();
      engine.dispose();
    },
  };
}
