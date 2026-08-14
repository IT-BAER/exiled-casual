/**
 * The asset viewer's scene: one exhibit on black, turned by the mouse.
 *
 * This is a workshop, not a screen of the game. Nothing here is lit or framed
 * the way play is, because the questions it answers are the ones play hides —
 * whether a pauldron sits on both shoulders, whether a coat clips on the
 * diagonal, whether a weapon is welded to the wrong hand. The play camera looks
 * down from a fixed quarter angle and can ask none of them.
 *
 * The subject list and the gear vocabulary are both DERIVED (from the gallery's
 * spawnables and from the wardrobe's own part names), so an asset added to the
 * game shows up here without anybody remembering to add it twice.
 */
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Mesh,
  Scene,
  Vector3,
  type AbstractMesh,
} from "@babylonjs/core";
import { attachProp, loadProps, PROP_KINDS, type PropKind } from "./props";
import { attachCreature, loadMonsters } from "./monsters";
import { SPAWNABLE, type Spawnable } from "./gallery";
import {
  attachRig,
  loadPlayerRig,
  resetPlayerRig,
  type Looks,
  type RigActor,
  type RigClip,
} from "./rig";

/**
 * What can stand on the turntable: the gallery's own spawnables, plus the
 * character, which the gallery has no entry for because the game never spawns a
 * second one.
 */
export interface ViewerSubject {
  id: string;
  label: string;
  group: Spawnable["group"] | "Character";
}

/** The character is subject zero: it is the reason the screen exists. */
export const CHARACTER_SUBJECT: ViewerSubject = {
  id: "character",
  label: "Character",
  group: "Character",
};

/** Everything that can stand on the turntable. */
export const VIEWER_SUBJECTS: readonly ViewerSubject[] = [CHARACTER_SUBJECT, ...SPAWNABLE];

/**
 * Clips on the number row.
 *
 * These are the clips a RigActor can be ASKED for from outside. Locomotion is a
 * speed rather than a name (`clipForSpeed` owns the walk/run hysteresis and
 * duplicating its thresholds here would let the viewer lie about which clip play
 * actually picks), so idle, walk and run are speeds and the rest are calls.
 */
export interface ViewerClip {
  key: string;
  clip: RigClip;
  label: string;
  /** Locomotion speed that selects this clip, or undefined for a one-shot. */
  speed?: number;
}

export const VIEWER_CLIPS: readonly ViewerClip[] = [
  { key: "1", clip: "idle", label: "Idle", speed: 0 },
  { key: "2", clip: "walk", label: "Walk", speed: 2 },
  { key: "3", clip: "run", label: "Run", speed: 6 },
  { key: "4", clip: "cast", label: "Cast" },
  { key: "5", clip: "strikeA", label: "Strike" },
];

/** Head geometry is cut from a separate base and is not a look anyone picks. */
const HEAD_PREFIX = "base.head.";

/**
 * The looks each slot ships, read off `slot.look.part` mesh names.
 *
 * Taking this from the asset rather than from a table is the whole point: the
 * panel is here to check what the wardrobe HAS, so a list that had to be edited
 * alongside it would be able to hide the one look somebody forgot to build.
 */
export function looksFromPartNames(names: readonly string[]): Record<string, string[]> {
  const bySlot: Record<string, string[]> = {};
  for (const name of names) {
    if (name.startsWith(HEAD_PREFIX)) continue;
    const [slot, look] = name.split(".");
    if (slot === undefined || look === undefined) continue;
    const list = (bySlot[slot] ??= []);
    if (!list.includes(look)) list.push(look);
  }
  return bySlot;
}

/**
 * Camera distance that fits a subject of this radius in the frame.
 *
 * Derived from the vertical field of view rather than picked per asset, so a
 * beetle and a behemoth both arrive filling the same share of the screen and
 * the wheel starts from somewhere useful.
 */
export const VIEWER_FOV = 0.8;
export function frameDistance(radius: number): number {
  return Math.max(0.8, radius / Math.tan(VIEWER_FOV / 2)) * 1.15;
}

export interface ViewerScene {
  /** Stand one subject on the turntable, taking the last one down. */
  show(id: string): Promise<void>;
  /** Dress the character. Ignored while a prop or creature is the subject. */
  setLooks(looks: Looks): void;
  /** What the wardrobe ships, `slot` -> looks. Empty until the character loads. */
  vocabulary(): Record<string, string[]>;
  /** Play a clip by its hotkey entry. */
  play(clip: ViewerClip): void;
  dispose(): void;
}

/**
 * Build the viewer on `canvas`, or null where there is no WebGL (jsdom, CI).
 * Null is not an error here for the same reason it is not on the menu stage:
 * the screen keeps its panels and loses only the picture.
 */
export async function createViewerScene(canvas: HTMLCanvasElement): Promise<ViewerScene | null> {
  let engine: Engine;
  try {
    engine = new Engine(canvas, true);
  } catch {
    return null;
  }
  const scene = new Scene(engine);
  // Near-black rather than black: a pure black background and an unlit silhouette
  // are the same pixel, and the thing being judged here IS the silhouette.
  scene.clearColor = new Color4(0.05, 0.05, 0.06, 1);

  // Orbit, wheel-zoom and pan, all of it Babylon's own. Beta is clamped just
  // short of the poles because straight overhead an ArcRotateCamera's up vector
  // flips and the subject spins on its own axis under the cursor.
  const camera = new ArcRotateCamera("viewer-cam", Math.PI / 2, 1.15, 4, Vector3.Zero(), scene);
  camera.fov = VIEWER_FOV;
  camera.minZ = 0.01;
  camera.maxZ = 200;
  camera.lowerRadiusLimit = 0.3;
  camera.upperRadiusLimit = 60;
  camera.lowerBetaLimit = 0.05;
  camera.upperBetaLimit = Math.PI - 0.05;
  camera.wheelDeltaPercentage = 0.02;
  camera.panningSensibility = 250;
  camera.attachControl(canvas, true);

  // Three-point-ish and deliberately plain. Play's warm low sun flatters a
  // silhouette from one side and is exactly what a viewer must not do.
  const key = new DirectionalLight("viewer-key", new Vector3(-0.4, -0.8, 0.5), scene);
  key.intensity = 2.2;
  const rim = new DirectionalLight("viewer-rim", new Vector3(0.6, -0.2, -0.8), scene);
  rim.intensity = 1.1;
  rim.diffuse = new Color3(0.75, 0.82, 1);
  const fill = new HemisphericLight("viewer-fill", new Vector3(0, 1, 0), scene);
  fill.intensity = 0.55;

  await Promise.all([
    loadPlayerRig(scene).catch(() => undefined),
    loadProps(scene).catch(() => undefined),
    loadMonsters(scene).catch(() => undefined),
  ]);

  engine.runRenderLoop(() => scene.render());
  const onResize = () => engine.resize();
  window.addEventListener("resize", onResize);

  let host: Mesh | null = null;
  let rig: RigActor | null = null;
  let looks: Looks | null = null;

  const takeDown = () => {
    rig?.dispose();
    rig = null;
    host?.dispose(false, true);
    host = null;
  };

  /**
   * Point the camera at the subject's middle and back off far enough to hold it.
   *
   * Measured from the assembled meshes, never authored per asset: the wardrobe's
   * origin is its sole plane and a creature's is between its feet, so a fixed
   * target frames a man on his knees and a behemoth on its chin.
   */
  const frame = () => {
    if (host === null) return;
    const meshes = host.getChildMeshes().filter((m: AbstractMesh) => m.getTotalVertices() > 0);
    if (meshes.length === 0) return;
    let min = meshes[0]!.getBoundingInfo().boundingBox.minimumWorld.clone();
    let max = meshes[0]!.getBoundingInfo().boundingBox.maximumWorld.clone();
    for (const m of meshes) {
      const b = m.getBoundingInfo().boundingBox;
      min = Vector3.Minimize(min, b.minimumWorld);
      max = Vector3.Maximize(max, b.maximumWorld);
    }
    const centre = min.add(max).scale(0.5);
    camera.setTarget(centre);
    camera.radius = frameDistance(max.subtract(min).length() / 2);
  };

  return {
    async show(id) {
      takeDown();
      host = new Mesh(`viewer-${id}`, scene);
      if (id === CHARACTER_SUBJECT.id) {
        rig = attachRig(scene, host);
        if (rig !== null && looks !== null) rig.setLooks(looks);
        rig?.standSettled();
      } else if ((PROP_KINDS as readonly string[]).includes(id)) {
        attachProp(scene, host, id as PropKind, true);
      } else {
        attachCreature(scene, host, id);
      }
      // The skinned meshes only take their bind pose once the scene has stepped,
      // so a bounding box read in this tick frames the subject at the origin.
      await new Promise<void>((done) => scene.onAfterRenderObservable.addOnce(() => done()));
      frame();
    },
    setLooks(next) {
      looks = next;
      rig?.setLooks(next);
    },
    vocabulary() {
      return looksFromPartNames(scene.meshes.map((m) => m.name));
    },
    play(entry) {
      if (rig === null) return;
      if (entry.speed !== undefined) {
        rig.setLocomotion(entry.speed);
        return;
      }
      if (entry.clip === "cast") rig.playCast();
      else rig.playStrike();
    },
    dispose() {
      window.removeEventListener("resize", onResize);
      takeDown();
      resetPlayerRig(scene);
      scene.dispose();
      engine.dispose();
    },
  };
}
