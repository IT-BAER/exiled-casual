/**
 * The asset viewer's scene: one exhibit on black, turned by the mouse.
 *
 * This is a workshop, not a screen of the game. Nothing here is lit or framed
 * the way play is, because the questions it answers are the ones play hides —
 * whether a pauldron sits on both shoulders, whether a coat clips on the
 * diagonal, whether a weapon is welded to the wrong hand. The play camera looks
 * down from a fixed quarter angle and can ask none of them. Where play's own
 * look matters, the "game" light and camera presets put it back.
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
  GlowLayer,
  HemisphericLight,
  ImageProcessingConfiguration,
  Light,
  Mesh,
  MeshBuilder,
  PointLight,
  Scene,
  ShadowGenerator,
  SkeletonViewer,
  StandardMaterial,
  Vector3,
  type AbstractMesh,
  type AnimationGroup,
  type LinesMesh,
  type Skeleton,
} from "@babylonjs/core";
import { buildSkyEnvironment, ENVIRONMENT_INTENSITY, GROUND_COLOR, SKY_COLOR } from "./environment";
import { attachProp, loadProps, PROP_KINDS, type PropKind } from "./props";
import { attachCreature, loadMonsters, type CreatureRig } from "./monsters";
import { loadPet, PetActor, type PetAction } from "./pet";
import { disposeRagdoll, dropDead, enablePhysics } from "./ragdoll";
import { blinkBurst, meleeImpact, setStreakLength } from "./skill-fx";
import { makeMesh, updateChargePath, updateTelegraph, Y_LIFT } from "./meshes";
import {
  BETA_AT_DEFAULT,
  CAMERA_ALPHA,
  CAMERA_FOV,
  FILL_INTENSITY,
  SUN_DIRECTION,
  SUN_INTENSITY,
  TORCH_HEIGHT,
  TORCH_INTENSITY,
  TORCH_RANGE,
  torchColor,
} from "./engine";
import { DEFAULT_SETTINGS } from "../settings";
import {
  CHARACTER_SUBJECT,
  PET_SUBJECT,
  creatureTelegraph,
  mainGroup,
  ONE_SHOTS,
  rawClipLabel,
  telegraphFrame,
  type CreatureAction,
  type CreatureTelegraph,
  type FxPreview,
  type ViewerCamera,
  type ViewerLight,
} from "./viewer-catalogue";
import {
  attachRig,
  BODIES,
  isRigReady,
  libraryClips,
  loadPlayerRig,
  resetPlayerRig,
  BASE_LOOKS,
  NO_LOOKS,
  SLOTS,
  type ReactionClip,
  type Looks,
  type RigActor,
} from "./rig";

export { CHARACTER_SUBJECT, PET_SUBJECT, VIEWER_SUBJECTS, type ViewerSubject } from "./viewer-catalogue";

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
    const [slot, look] = name.split(".");
    if (slot === undefined || look === undefined) continue;
    const list = (bySlot[slot] ??= []);
    if (!list.includes(look)) list.push(look);
  }
  return bySlot;
}

/**
 * The default body, plus whatever gear the wardrobe ships.
 *
 * The BODY is pinned rather than picked: `BASE_LOOKS`' male, the one the viewer
 * opens on, while the Inspector switches to any other loaded body. Checked
 * against the vocabulary anyway, so an asset that stopped shipping the male
 * body opens on nothing rather than a silent lie.
 *
 * GEAR is picked first-available, because this is the workshop screen and a
 * piece nothing here can put on is a piece nobody can look at. In play a slot
 * fills only when the item is equipped.
 */
export function dressedFromVocabulary(vocab: Record<string, string[]>): Looks {
  const looks = { ...NAKED };
  for (const slot of SLOTS) {
    const wired = BASE_LOOKS[slot];
    if (wired !== null) {
      if (vocab[slot]?.includes(wired)) looks[slot] = wired;
      continue;
    }
    const first = vocab[slot]?.[0];
    if (first !== undefined) looks[slot] = first;
  }
  return looks;
}

/** Every slot empty. Exported so the panel and the scene agree on the word. */
export const NAKED: Looks = { ...NO_LOOKS };

/**
 * Camera distance that fits a subject of this radius in the frame.
 *
 * Derived from the vertical field of view rather than picked per asset, so a
 * beetle and a behemoth both arrive filling the same share of the screen and
 * the wheel starts from somewhere useful.
 */
export const VIEWER_FOV = 0.8;
export function frameDistance(radius: number, fov = VIEWER_FOV): number {
  return Math.max(0.8, radius / Math.tan(fov / 2)) * 1.15;
}

/**
 * Where each camera preset puts the eye. The character faces +Z, so "front"
 * stands on +Z (alpha PI/2) and "side" on his right. "game" is play's own pitch
 * and yaw, through play's long lens.
 */
export const CAMERA_ANGLES: Record<Exclude<ViewerCamera, "free">, { alpha: number; beta: number }> = {
  front: { alpha: Math.PI / 2, beta: 1.35 },
  side: { alpha: 0, beta: 1.35 },
  back: { alpha: -Math.PI / 2, beta: 1.35 },
  top: { alpha: Math.PI / 2, beta: 0.06 },
  game: { alpha: CAMERA_ALPHA, beta: BETA_AT_DEFAULT },
};

/** Which way an exhibit faces, for what the FX previews throw and where. */
const FACING = new Vector3(0, 0, 1);
/** How long a charged body stands on its landing point before going home. */
const TELL_HOLD_S = 0.6;

/** The clip the timeline is showing, where it is in it, and the clock it runs on. */
export interface TimelineState {
  label: string;
  frame: number;
  from: number;
  to: number;
  paused: boolean;
  speed: number;
}

export interface SubjectStats {
  triangles: number;
  meshes: number;
  materials: number;
  bones: number;
}

export interface ViewToggles {
  grid: boolean;
  wireframe: boolean;
  skeleton: boolean;
  turntable: boolean;
}

export interface ViewerScene {
  /** Stand one subject on the turntable, taking the last one down. */
  show(id: string): Promise<void>;
  /** Dress the character. Ignored while a prop or creature is the subject. */
  setLooks(looks: Looks): void;
  /** What the wardrobe ships, `slot` -> looks. Empty until the character loads. */
  vocabulary(): Record<string, string[]>;
  /**
   * Walk or run the subject at `speed` toward `rel` off its facing; 0 stands.
   * A speed, never a clip name: `clipForSpeed` and the direction blend pick the
   * clip as in play, so the viewer cannot show one play would not.
   */
  locomote(speed: number, rel: number): void;
  /** One of `ONE_SHOTS` on the character. */
  oneShot(id: string): void;
  /** A creature's own clip, or its death through the ragdoll. */
  creatureAction(action: CreatureAction): Promise<boolean>;
  /** One of the companion cat's clips over the origin, repeating; asking again restarts it. */
  petAction(action: PetAction): void;
  /** Library take names, for the raw browser. Empty until the rig loads. */
  rawClips(): string[];
  /** Loop a library take on the character, or stop the raw take with null. */
  playRaw(name: string | null): boolean;
  /** Fire a skill's effect from the subject, with the clip that casts it. */
  fireFx(fx: FxPreview): void;
  /** Replay the last action whenever it ends. */
  setRepeat(on: boolean): void;
  timeline(): TimelineState | null;
  setPaused(paused: boolean): void;
  /** Put the shown clip at a fraction 0..1 of its length. */
  seek(fraction: number): void;
  /** Move the shown clip by whole frames; pauses first. */
  step(frames: number): void;
  setSpeed(scale: number): void;
  setLight(light: ViewerLight): void;
  setCamera(camera: ViewerCamera): void;
  setToggles(toggles: ViewToggles): void;
  stats(): SubjectStats;
  /** The last frame drawn, as a PNG data URL. */
  capture(): Promise<string>;
  dispose(): void;
}

/** Why a group is playing, for the timeline's label: `viewer-character-cast` -> "cast". */
function groupLabel(group: AnimationGroup): string {
  return group.name.split(/[-|]/).pop()?.replace(/\.\d+$/, "") ?? group.name;
}

/**
 * Build the viewer on `canvas`, or null where there is no WebGL (jsdom, CI).
 * Null is not an error here for the same reason it is not on the menu stage:
 * the screen keeps its panels and loses only the picture.
 */
export async function createViewerScene(canvas: HTMLCanvasElement): Promise<ViewerScene | null> {
  let engine: Engine;
  try {
    // preserveDrawingBuffer so a capture taken from a click reads the frame, not black.
    engine = new Engine(canvas, true, { preserveDrawingBuffer: true });
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

  // A dev handle on the camera and the scene. Judging a fit means putting the
  // eye at one repeatable place, which dragging the canvas cannot do, and the
  // arc camera is otherwise reachable only through the pointer.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__viewer = {
      scene,
      camera,
      buildSkyEnvironment,
      SKY_COLOR,
      GROUND_COLOR,
      ENVIRONMENT_INTENSITY,
    };
  }

  // Three-point-ish and deliberately plain: play's warm low sun flatters a
  // silhouette from one side, which is exactly what a viewer must not do.
  //
  // The KEY is as strong as play's sun (`SUN_INTENSITY`, 6.0) on purpose. A
  // gentler one looked reasonable and was not: these are PBR materials with no
  // environment texture behind them, so nothing but the lights reaches them, and
  // at a third of play's sun every armour base rendered near-black and the
  // palettes this screen exists to compare were indistinguishable by eye.
  const WORKSHOP_KEY = new Vector3(-0.4, -0.8, 0.5);
  const key = new DirectionalLight("viewer-key", WORKSHOP_KEY.clone(), scene);
  key.intensity = 6;
  const rim = new DirectionalLight("viewer-rim", new Vector3(0.6, -0.2, -0.8), scene);
  rim.intensity = 2.4;
  rim.diffuse = new Color3(0.75, 0.82, 1);
  // Up from play's 0.45: with no sky and no bounce, the fill is the only thing
  // keeping the shadow side from being a hole in the model.
  const fill = new HemisphericLight("viewer-fill", new Vector3(0, 1, 0), scene);
  fill.intensity = 1.2;
  // The light play's player carries, dark until the "game" preset: without it the
  // low sun and thin fill leave him a silhouette he never is in play.
  const torch = new PointLight("viewer-torch", new Vector3(0, TORCH_HEIGHT, 0), scene);
  torch.diffuse = torchColor(DEFAULT_SETTINGS.graphics.torchWarmth);
  torch.specular = Color3.Black();
  torch.range = TORCH_RANGE;
  torch.falloffType = Light.FALLOFF_GLTF;
  torch.intensity = 0;

  // Same roll-off play uses, for the same reason: a 6.0 key drives the lit faces
  // past 1.0, and clipped they flatten into white patches on the facets the
  // shading is there to show.
  try {
    const ip = scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.15;
    ip.contrast = 1.1;
  } catch {
    /* no image processing under NullEngine */
  }
  await Promise.all([
    loadPlayerRig(scene, BODIES).catch(() => undefined),
    loadProps(scene).catch(() => undefined),
    loadMonsters(scene).catch(() => undefined),
    loadPet(scene),
  ]);

  // After the imports, so the viewer judges armour under the same environment
  // the game and the menu give it.
  buildSkyEnvironment(scene, {
    sky: SKY_COLOR,
    ground: GROUND_COLOR,
    intensity: ENVIRONMENT_INTENSITY,
  });
  // Play blooms emissive (bolt heads, fire); without it the FX previews are flat paint.
  // After the imports: a render target made before the wardrobe lands leaves it unlit.
  try {
    new GlowLayer("glow", scene).intensity = 0.85;
  } catch {
    /* no render target under NullEngine */
  }

  engine.runRenderLoop(() => scene.render());
  const onResize = () => engine.resize();
  window.addEventListener("resize", onResize);

  let host: Mesh | null = null;
  let rig: RigActor | null = null;
  let creature: CreatureRig | null = null;
  let pet: PetActor | null = null;
  let looks: Looks | null = null;
  // Locomotion is re-asserted every frame, as the game does: the hips ease into
  // their turn and the direction blend follows them.
  let moving: { speed: number; rel: number } | null = null;
  let attackTick = 0;
  let rawName: string | null = null;
  let dead = false;
  let paused = false;
  let repeat = false;
  /** The last action asked for, and the group it plays through, so repeat can tell when it ended. */
  let lastAction: { run: () => void; group: () => AnimationGroup | null } | null = null;
  let repeatAt = 0;
  let toggles: ViewToggles = { grid: false, wireframe: false, skeleton: false, turntable: false };
  let ground: Mesh | null = null;
  let gridLines: LinesMesh | null = null;
  let shadows: ShadowGenerator | null = null;
  let skeletonViews: SkeletonViewer[] = [];
  let floorY = 0;
  /** Timers FX previews left running, so a subject change cancels them. */
  let timers: number[] = [];
  let subjectId: string | null = null;
  /** A ground tell playing out; ending it puts a charged body back where it stood. */
  let tell: { mesh: Mesh; tick: ReturnType<typeof scene.onBeforeRenderObservable.add>; home: Vector3 } | null = null;

  scene.onBeforeRenderObservable.add(() => {
    if (moving !== null) {
      rig?.setMoveAngle(moving.rel);
      rig?.setLocomotion(moving.speed);
      if (!dead) creature?.setLocomotion(moving.speed);
    }
    if (!paused) pet?.previewTick((engine.getDeltaTime() / 1000) * scene.animationTimeScale);
    if (!repeat || paused || lastAction === null) return;
    const group = lastAction.group();
    if (group?.isPlaying || tell !== null) { repeatAt = 0; return; }
    const now = performance.now();
    if (repeatAt === 0) repeatAt = now + 400;
    else if (now >= repeatAt) { repeatAt = 0; lastAction.run(); }
  });

  const later = (ms: number, fn: () => void) => {
    timers.push(window.setTimeout(fn, ms / Math.max(scene.animationTimeScale, 0.05)));
  };

  const groupsNow = (): AnimationGroup[] => {
    if (rig) return [rig.rawGroup, ...rig.clipGroups.values()].filter((g): g is AnimationGroup => g !== null);
    if (creature) return [...creature.clipGroups.values()];
    if (pet) return [...pet.clipGroups.values()];
    return [];
  };

  const subjectMeshes = (): AbstractMesh[] =>
    host === null ? [] : host.getChildMeshes(false).filter((m) => m.isEnabled() && m.getTotalVertices() > 0);

  const clearSkeletons = () => {
    for (const v of skeletonViews) v.dispose();
    skeletonViews = [];
  };

  const showSkeletons = () => {
    clearSkeletons();
    if (!toggles.skeleton) return;
    const seen = new Set<Skeleton>();
    for (const mesh of subjectMeshes()) {
      const skeleton = mesh.skeleton;
      if (!skeleton || seen.has(skeleton) || !(mesh instanceof Mesh)) continue;
      seen.add(skeleton);
      const view = new SkeletonViewer(skeleton, mesh, scene, false, 1, {
        displayMode: SkeletonViewer.DISPLAY_LINES,
      });
      view.color = new Color3(1, 0.78, 0.35);
      skeletonViews.push(view);
    }
  };

  const clearGround = () => {
    shadows?.dispose();
    shadows = null;
    gridLines?.dispose();
    gridLines = null;
    ground?.material?.dispose();
    ground?.dispose();
    ground = null;
  };

  /** A floor under the subject: a faint grid at its soles that catches the key's shadow. */
  const showGround = (radius: number) => {
    clearGround();
    if (!toggles.grid) return;
    const half = Math.max(2, Math.ceil(radius * 2.5));
    ground = MeshBuilder.CreateGround("viewer-ground", { width: half * 2, height: half * 2 }, scene);
    ground.position.y = floorY;
    ground.isPickable = false;
    const mat = new StandardMaterial("viewer-ground-mat", scene);
    // Near the clear colour under the 6.0 key, so the floor reads as shadow, not as a slab.
    mat.diffuseColor = new Color3(0.012, 0.012, 0.014);
    mat.specularColor = Color3.Black();
    ground.material = mat;
    ground.receiveShadows = true;
    const lines: Vector3[][] = [];
    const step = half > 8 ? 1 : 0.5;
    for (let v = -half; v <= half + 1e-6; v += step) {
      lines.push([new Vector3(v, floorY + 0.002, -half), new Vector3(v, floorY + 0.002, half)]);
      lines.push([new Vector3(-half, floorY + 0.002, v), new Vector3(half, floorY + 0.002, v)]);
    }
    gridLines = MeshBuilder.CreateLineSystem("viewer-grid", { lines }, scene);
    gridLines.color = new Color3(0.22, 0.2, 0.17);
    gridLines.isPickable = false;
    shadows = new ShadowGenerator(2048, key);
    shadows.useBlurExponentialShadowMap = true;
    shadows.blurKernel = 16;
    for (const m of subjectMeshes()) shadows.addShadowCaster(m, false);
  };

  const endTell = () => {
    if (tell === null) return;
    scene.onBeforeRenderObservable.remove(tell.tick);
    if (!tell.mesh.isDisposed()) tell.mesh.dispose();
    host?.position.copyFrom(tell.home);
    creature?.setLocomotion(0);
    tell = null;
  };

  /**
   * A charge or slam as the game draws it: the swing starts with the wind-up
   * (the sim stamps `lastAttackTick` then), the tell fills on the game's own
   * mesh, a charger runs down its path after the root, and the tell is gone at
   * impact. The body holds there a beat before going home, so Repeat can loop it.
   */
  const playTell = (c: CreatureRig, tg: CreatureTelegraph) => {
    endTell();
    if (host === null) return;
    const h = host;
    const home = h.position.clone();
    const kind = tg.kind === "charge" ? "chargePath" : "telegraph";
    const at = home.add(FACING.scale(tg.distance));
    const mesh = makeMesh(scene, kind, `viewer-tell-${tg.kind}-${performance.now()}`);
    mesh.position.set(at.x, floorY + Y_LIFT[kind], at.z);
    if (kind === "telegraph") mesh.scaling.set(tg.radius, 1, tg.radius);
    moving = null;
    c.noteAttack(++attackTick);
    let t = 0;
    const tick = scene.onBeforeRenderObservable.add(() => {
      if (paused) return;
      t += (engine.getDeltaTime() / 1000) * scene.animationTimeScale;
      const f = telegraphFrame(tg, t);
      if (!mesh.isDisposed()) {
        if (kind === "chargePath") {
          h.position.copyFrom(home.add(FACING.scale(f.travelled)));
          c.setLocomotion(f.travelled > 0 && !f.done ? tg.speed : 0);
          updateChargePath(mesh, f.progress, { x: h.position.x, y: h.position.z });
        } else updateTelegraph(mesh, f.progress);
        if (f.done) {
          mesh.dispose();
          c.setLocomotion(0);
        }
      }
      if (t >= tg.durationS + TELL_HOLD_S) endTell();
    });
    tell = { mesh, tick, home };
  };

  const takeDown = () => {
    endTell();
    for (const t of timers) window.clearTimeout(t);
    timers = [];
    clearSkeletons();
    clearGround();
    lastAction = null;
    moving = null;
    rawName = null;
    rig?.dispose();
    rig = null;
    creature?.dispose();
    creature = null;
    pet?.dispose();
    pet = null;
    if (host) disposeRagdoll(host);
    // Every exhibit shares its container's materials: disposing them here
    // leaves the next copy of that prop or creature untextured white.
    host?.dispose();
    host = null;
    dead = false;
  };

  /**
   * Point the camera at the subject's middle and back off far enough to hold it.
   *
   * Measured from the assembled meshes, never authored per asset: the wardrobe's
   * origin is its sole plane and a creature's is between its feet, so a fixed
   * target frames a man on his knees and a behemoth on its chin.
   */
  let framedRadius = 1;
  const frame = () => {
    // An undressed body enables nothing yet, so it is measured whole.
    const shown = subjectMeshes();
    const meshes = shown.length > 0 ? shown
      : host?.getChildMeshes(false).filter((m) => m.getTotalVertices() > 0) ?? [];
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
    framedRadius = max.subtract(min).length() / 2;
    camera.radius = frameDistance(framedRadius, camera.fov);
    floorY = Math.min(0, min.y);
    showGround(framedRadius);
    showSkeletons();
  };

  /** Where an effect leaves the subject: the weapon hand, or the chest of anything without one. */
  const muzzle = (): Vector3 => {
    const hand = rig?.castPoint();
    if (hand) return hand.clone();
    return camera.target.clone();
  };

  /** A projectile thrown from the muzzle along the facing; its dispose is the impact burst. */
  const fly = (fx: FxPreview) => {
    const from = muzzle();
    const mesh = makeMesh(scene, "projectile", `viewer-fx-${fx.skillId}-${performance.now()}`, from, undefined, fx.skillId);
    if (fx.kind === "arrow") mesh.rotation.y = Math.atan2(FACING.x, FACING.z);
    const speed = 12;
    const seconds = 0.8;
    let t = 0;
    const tick = scene.onBeforeRenderObservable.add(() => {
      if (paused) return;
      t += (engine.getDeltaTime() / 1000) * scene.animationTimeScale;
      mesh.position.copyFrom(from.add(FACING.scale(speed * t)));
      if (fx.kind === "arrow") setStreakLength(mesh, speed * t);
      if (t >= seconds) {
        scene.onBeforeRenderObservable.remove(tick);
        mesh.dispose();
      }
    });
  };

  const fireFx = (fx: FxPreview) => {
    const anchor = host?.getAbsolutePosition() ?? Vector3.Zero();
    if (fx.kind === "bolt") {
      rig?.playCast(0.6, 0.3);
      later(rig ? 300 : 0, () => fly(fx));
    } else if (fx.kind === "arrow") {
      rig?.playBow(0.6, 0.35);
      later(rig ? 350 : 0, () => fly(fx));
    } else if (fx.kind === "melee") {
      rig?.playStrike(0.5, 0.3);
      later(rig ? 300 : 0, () => meleeImpact(scene, muzzle(), FACING.x, FACING.z, 1));
    } else if (fx.kind === "ground") {
      rig?.playCast(0.6, 0.3);
      later(rig ? 300 : 0, () => {
        const at = anchor.add(FACING.scale(2.5));
        const patch = makeMesh(scene, "groundArea", `viewer-fx-ground-${performance.now()}`, at, undefined, fx.skillId);
        patch.scaling.set(2.5, 1, 2.5);
        later(3000, () => patch.dispose());
      });
    } else {
      blinkBurst(scene, anchor.add(new Vector3(0, 1, 0)), anchor.add(FACING.scale(5)).add(new Vector3(0, 1, 0)));
    }
  };

  const viewer: ViewerScene = {
    async show(id) {
      takeDown();
      host = new Mesh(`viewer-${id}`, scene);
      subjectId = id;
      if (id === CHARACTER_SUBJECT.id) {
        rig = attachRig(scene, host);
        if (rig !== null && looks !== null) rig.setLooks(looks);
        rig?.standSettled();
      } else if ((PROP_KINDS as readonly string[]).includes(id)) {
        attachProp(scene, host, id as PropKind, true);
      } else if (id === PET_SUBJECT.id) {
        pet = new PetActor(scene);
        pet.root.parent = host;
        pet.previewAction("hover");
      } else {
        creature = attachCreature(scene, host, id);
        // The first report only seeds the swing edge (`noteAttack`).
        attackTick = 0;
        creature?.noteAttack(attackTick);
      }
      // The skinned meshes only take their bind pose once the scene has stepped,
      // so a bounding box read in this tick frames the subject at the origin.
      await new Promise<void>((done) => scene.onAfterRenderObservable.addOnce(() => done()));
      frame();
    },
    setLooks(next) {
      looks = next;
      rig?.setLooks(next);
      if (toggles.skeleton || toggles.grid) frame();
    },
    vocabulary() {
      // Bodies are their own imports, so only the one standing here has meshes.
      const vocab = looksFromPartNames(scene.meshes.map((m) => m.name));
      return { ...vocab, base: BODIES.filter((b) => isRigReady(scene, b)) };
    },
    locomote(speed, rel) {
      moving = { speed, rel };
    },
    oneShot(id) {
      const shot = ONE_SHOTS.find((s) => s.id === id);
      const r = rig;
      if (!shot || r === null) return;
      const run = () => {
        if (shot.id === "cast") r.playCast();
        else if (shot.id === "bow") r.playBow();
        else if (shot.id === "strike") r.playStrike();
        else if (shot.id === "heavy") r.playStrike(undefined, undefined, "skill.heavy_strike.v1");
        else if (shot.id === "slam") r.playStrike(undefined, undefined, "skill.ground_slam.v1");
        else if (shot.id === "roll") r.playRoll();
        else r.playReaction(shot.id as ReactionClip);
      };
      run();
      lastAction = {
        run,
        group: () => shot.clips.map((c) => r.clipGroups.get(c)).find((g) => g?.isPlaying) ?? null,
      };
    },
    async creatureAction(action) {
      const c = creature;
      if (c === null || host === null) return false;
      endTell();
      if (action === "charge" || action === "slam") {
        const tg = dead || subjectId === null ? null : creatureTelegraph(subjectId, action);
        if (tg === null) return false;
        const run = () => playTell(c, tg);
        run();
        lastAction = { run, group: () => c.clipGroups.get("attack") ?? null };
        return true;
      }
      if (action === "death") {
        if (dead) return false;
        if (!(await enablePhysics(scene)) || creature !== c || host === null) return false;
        c.stopForDeath();
        lastAction = null;
        dead = dropDead(scene, host, FACING.scale(-1));
        return dead;
      }
      if (dead) return false;
      if (action === "attack") {
        const run = () => c.noteAttack(++attackTick);
        run();
        lastAction = { run, group: () => c.clipGroups.get("attack") ?? null };
        return true;
      }
      moving = { speed: action === "walk" ? 2 : 0, rel: 0 };
      return true;
    },
    petAction(action) {
      const p = pet;
      if (p === null) return;
      const run = () => p.previewAction(action);
      run();
      lastAction = { run, group: () => p.clipGroups.get(action) ?? null };
    },
    rawClips() {
      return libraryClips(scene);
    },
    playRaw(name) {
      if (rig === null) return false;
      lastAction = null;
      rawName = name;
      if (name === null) {
        rig.stopRaw();
        return true;
      }
      return rig.playRaw(name) !== null;
    },
    fireFx(fx) {
      const run = () => fireFx(fx);
      run();
      lastAction = rig
        ? { run, group: () => mainGroup(groupsNow().filter((g) => g.playOrder > 0)) }
        : null;
    },
    setRepeat(on) {
      repeat = on;
      repeatAt = 0;
    },
    timeline() {
      const group = mainGroup(groupsNow());
      if (group === null) return null;
      const raw = rig?.rawGroup === group;
      return {
        label: raw ? `raw ${rawClipLabel(rawName ?? "")}` : groupLabel(group),
        frame: group.animatables[0]?.masterFrame ?? group.from,
        from: group.from,
        to: group.to,
        paused,
        speed: scene.animationTimeScale,
      };
    },
    setPaused(p) {
      paused = p;
      // Stops every animatable AND the rig's per-frame observers, so the pose holds whole.
      scene.animationsEnabled = !p;
    },
    seek(fraction) {
      const group = mainGroup(groupsNow());
      if (group === null) return;
      const f = Math.min(1, Math.max(0, fraction));
      group.goToFrame(group.from + f * (group.to - group.from));
    },
    step(frames) {
      viewer.setPaused(true);
      const group = mainGroup(groupsNow());
      const at = group?.animatables[0]?.masterFrame;
      if (!group || at === undefined) return;
      const span = group.to - group.from;
      const next = group.from + ((((at - group.from + frames) % span) + span) % span);
      group.goToFrame(next);
    },
    setSpeed(s) {
      scene.animationTimeScale = s;
    },
    setLight(light) {
      if (light === "game") {
        key.direction = new Vector3(...SUN_DIRECTION);
        key.intensity = SUN_INTENSITY;
        rim.intensity = 0;
        fill.intensity = FILL_INTENSITY;
        torch.intensity = TORCH_INTENSITY;
      } else {
        torch.intensity = 0;
        key.direction = WORKSHOP_KEY.clone();
        key.intensity = 6;
        rim.intensity = 2.4;
        fill.intensity = 1.2;
      }
    },
    setCamera(preset) {
      camera.fov = preset === "game" ? CAMERA_FOV : VIEWER_FOV;
      if (preset !== "free") {
        const at = CAMERA_ANGLES[preset];
        camera.alpha = at.alpha;
        camera.beta = at.beta;
      }
      camera.radius = frameDistance(framedRadius, camera.fov);
    },
    setToggles(next) {
      const regrid = next.grid !== toggles.grid;
      const rebone = next.skeleton !== toggles.skeleton;
      toggles = { ...next };
      scene.forceWireframe = next.wireframe;
      camera.useAutoRotationBehavior = next.turntable;
      if (camera.autoRotationBehavior) {
        camera.autoRotationBehavior.idleRotationSpeed = 0.35;
        camera.autoRotationBehavior.idleRotationWaitTime = 0;
        camera.autoRotationBehavior.idleRotationSpinupTime = 300;
      }
      if (regrid) showGround(framedRadius);
      if (rebone) showSkeletons();
    },
    stats() {
      const meshes = subjectMeshes();
      const materials = new Set(meshes.map((m) => m.material).filter((m) => m !== null));
      const skeletons = new Set(meshes.map((m) => m.skeleton).filter((s): s is Skeleton => s !== null));
      return {
        triangles: meshes.reduce((n, m) => n + m.getTotalIndices() / 3, 0),
        meshes: meshes.length,
        materials: materials.size,
        bones: [...skeletons].reduce((n, s) => n + s.bones.length, 0),
      };
    },
    capture() {
      return new Promise((done) => {
        scene.onAfterRenderObservable.addOnce(() => done(canvas.toDataURL("image/png")));
      });
    },
    dispose() {
      window.removeEventListener("resize", onResize);
      takeDown();
      resetPlayerRig(scene);
      scene.dispose();
      engine.dispose();
    },
  };
  // The DEV handle also carries the viewer itself: dressing a look the panel
  // does not offer, or playing a clip, from the console.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__viewerScene = viewer;
  }
  return viewer;
}
