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
  type Camera,
  DynamicTexture,
  Engine,
  FreeCamera,
  HemisphericLight,
  Light,
  Matrix,
  Mesh,
  MeshBuilder,
  PointLight,
  Scene,
  StandardMaterial,
  Texture,
  Vector3,
} from "@babylonjs/core";
import { attachRig, loadPlayerRig, resetPlayerRig, type Looks, type RigActor } from "./rig";
import {
  buildSkyEnvironment,
  ENVIRONMENT_INTENSITY,
  GROUND_COLOR,
  SKY_COLOR,
} from "./environment";
import { dissolveAway, dissolveIn, primeDissolve } from "./dissolve";

/**
 * The scene's floor height. Arbitrary: the camera is solved from the painting
 * (below), so only `EYE` above this matters. The lights are placed against it.
 */
const FLOOR_Y = -0.5;

/** `select_backdrop.jpg`'s width over its height. The camera is solved in its pixels. */
const BACKDROP_ASPECT = 1672 / 941;
/**
 * The plate's horizon, as a fraction down the image: where its floor seams meet
 * (Hough lines on the tile joints, both diagonals). The painting is a LEVEL
 * camera, its columns stay vertical, so the 3D camera is level too and the
 * horizon is placed by shifting the lens, never by tilting it.
 */
const HORIZON = 0.66;
/**
 * Camera height above the floor: a standing man's shoulder, which is where the
 * horizon crosses a figure in PoE's own select screen. A floor painted from one
 * height under a body rendered from another is what read as the wrong angle.
 */
const EYE = 1.35;
/** How far in front of the camera he stands. With `EYE` this fixes the focal length. */
const DISTANCE = 8.4;
/**
 * Where his soles land, as fractions of the image. Near the bottom like PoE's
 * line-up, and no lower: a 21:9 window crops `cover` to 0.88 of the image.
 * Left of the throne, which keeps his silhouette off the carved plinth.
 */
export const FEET_IMAGE = { x: 0.29, y: 0.86 };
/** Focal length in image heights, solved so the soles land on `FEET_IMAGE.y`. */
const FOCAL = ((FEET_IMAGE.y - HORIZON) * DISTANCE) / EYE;
/**
 * Where the character's feet sit. +X is LEFT on screen: the camera looks down
 * -Z, and Babylon's left-handed world flips which side +X lands on.
 */
export const FEET = new Vector3(((0.5 - FEET_IMAGE.x) * BACKDROP_ASPECT * DISTANCE) / FOCAL, FLOOR_Y, 0);
const CAMERA = new Vector3(0, FLOOR_Y + EYE, DISTANCE);

/**
 * The shadow is CAST, not pooled: long toward the camera, narrow across.
 *
 * The painting says where from. `select_backdrop.jpg` is lit by one shaft
 * falling through the dome behind the throne, high and near the middle of the
 * room — so anything standing on that floor throws its shadow forward, out of
 * the picture toward the viewer, and a little further from the centre line than
 * it stands. A disc centred under the feet is what you draw when you have not
 * looked at the plate; it belongs to a light directly overhead, which this hall
 * does not have.
 *
 * Three earlier cuts were wrong. A soft 1.7-unit pool at 0.7 read as nothing
 * (the camera is nearly level with the floor, so a ground quad foreshortens to
 * a band, and a soft band hides its own darkest part under the boots). A tight
 * dark stain read as a sticker's drop shadow. Short and strong at 3.2/0.9 read
 * as a splat of dirt on the tiles, which is the failure to watch for: at this
 * angle a shadow is believable in proportion to how LONG and how FAINT it is,
 * and any of it dark enough to have an edge is a mark on the floor instead.
 */
const SHADOW_SIZE = { width: 1.45, depth: 2.4 };
/** Alpha where it touches the boots. Everything past that is falloff. */
const SHADOW_STRENGTH = 0.75;
/**
 * Which way the shadow is thrown, from the soles: forward toward the camera and
 * outward along +X, away from the dome's shaft. A direction, not a distance —
 * the quad starts AT the feet and runs `SHADOW_SIZE.depth` along this.
 *
 * It used to be an offset, and that is what put a gap under him: a round blob
 * offset forward moves its DARK CORE forward too, and the core is the contact.
 * At 1.35 the core sat a boot length ahead of the soles (0.057 of the canvas,
 * ~70px at 1202) with nothing but falloff under him — a man hovering over his
 * own shadow. Pulling the core back onto the feet instead makes it vanish: this
 * camera is nearly level with the floor, so the ground at the soles projects
 * into a band the boots themselves cover. The falloff has to be asymmetric, and
 * that is why the gradient below is drawn instead of borrowed.
 */
const SHADOW_CAST = { x: 0.28, z: 1 };
/**
 * How much of the quad lies BEHIND the soles, as a fraction of its length.
 *
 * Nothing to do with where the light is: it is there so the contact is not the
 * quad's own boundary. Put the darkest part exactly on the back edge and the
 * shadow ends in a straight line across the tiles at his heels — a cut, and the
 * lower the camera the more of that cut the floor shows.
 */
const SHADOW_CONTACT = 0.18;

/**
 * The occlusion pool under the boots: how big, and how dark at its middle.
 *
 * Deliberately smaller than a stride is wide. This is not a shadow standing in
 * for the cast one — that would be the disc the comment above rules out — it is
 * the ambient the floor cannot see because a body is sitting on it, and that
 * patch is about the size of the thing's footprint. Wider than the boots by
 * half so it is not a rectangle of dark with two boots on it, and no wider,
 * because past that it stops being contact and starts being a stain.
 */
const CONTACT_SIZE = { width: 1.61, depth: 0.59 };
const CONTACT_STRENGTH = 0.8;
/**
 * Where it sits against the rig's origin.
 *
 * Not zero, and neither number is arbitrary. The x is because the stance is not
 * centred on the root — he stands with his weight off to one side — and a pool
 * centred on the root leaves one boot with daylight under it, which is the exact
 * thing being fixed. The z is because this camera is nearly level with the
 * floor, so half a ground quad centred on the soles is BEHIND them and hidden by
 * the body: pushing it toward the viewer is what puts the visible half where the
 * boots meet the tiles rather than out the far side.
 */
const CONTACT_OFFSET = { x: -0.09, z: 0.12 };

/**
 * A slight turn off square-on.
 *
 * This used to be a hard three-quarter turn, and it was not a stylistic choice:
 * `base.head` was generated geometry pinned to one flat skin texel, so it had no
 * features at all, and turning it away was the honest thing to do with a head
 * that did not have a face. It has one now — cut off the author's base male with
 * its own uvs, so the painted face in the skin atlas finally lands on a head —
 * and hiding it would be throwing the whole point away. What is left is staging:
 * dead square-on is a passport photo, and a few degrees is what puts a light
 * side and a shadow side on the same nose.
 */
const FACING = -0.15;

/** Cold wash from the dome, and the one knob that says how much of the face you
 *  get. Weak on purpose: this room is lit by fire, not by sky, and the plate
 *  agrees with the braziers rather than with a front key. It used to be weak for
 *  a second reason that is gone — a bright fill was exactly what would have lit
 *  up a featureless head — so the ceiling here is now taste, not the asset. */
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
  new Vector3(FEET.x - 3.9, 0.6, -2.2),
  new Vector3(FEET.x + 2.9, 0.6, -2.2),
];

/**
 * A cold kicker from behind, which is what separates a dark figure from a dark
 * room. Without it the silhouette merges into the statue's plinth entirely.
 */
const RIM_COLOR = new Color3(0.62, 0.74, 0.95);
const RIM_INTENSITY = 4.6;

/** Where a floor-level or body point lands, as a fraction down the backdrop image. */
function imageY(y: number, z: number): number {
  return HORIZON + (FOCAL * (CAMERA.y - y)) / (CAMERA.z - z);
}

/** Where the soles land, as a fraction down the backdrop image. */
export function floorImageY(): number {
  return imageY(FEET.y, FEET.z);
}

/**
 * Solve the camera against the backdrop as `cover` lays it out in a boxW x boxH
 * box, for a w x h canvas at that box's top-left corner (it spans only the open
 * half of the hall): same focal length in image pixels, the lens's centre on the
 * painted horizon. So the figure stands on the same spot of the painting in
 * every window shape. Any one unit, CSS pixels or drawing-buffer pixels.
 */
export function frameCamera(
  camera: Camera, w: number, h: number, boxW: number, boxH: number, halfZRange = false,
): void {
  const shown = Math.max(boxW / BACKDROP_ASPECT, boxH); // the image's drawn height
  const focal = FOCAL * shown;
  const horizon = (boxH - shown) / 2 + HORIZON * shown; // from the canvas's top
  const centre = boxW / 2; // from the canvas's left
  const lens = Matrix.PerspectiveFovLH(2 * Math.atan(h / (2 * focal)), w / h, camera.minZ, camera.maxZ, halfZRange);
  camera.freezeProjectionMatrix(lens.multiply(Matrix.Translation((2 * centre) / w - 1, 1 - (2 * horizon) / h, 0)));
}

/**
 * Where the far end of the shadow lands, same convention. Its dark end is pinned
 * to the soles, so this minus `floorImageY()` is how much of it the eye gets.
 */
export function shadowReachImageY(): number {
  const dir = Math.hypot(SHADOW_CAST.x, SHADOW_CAST.z);
  const forward = SHADOW_SIZE.depth * (1 - SHADOW_CONTACT);
  return imageY(FEET.y, FEET.z + (SHADOW_CAST.z / dir) * forward);
}

/**
 * The shadow's falloff, drawn rather than fetched.
 *
 * It was a round blob borrowed from the ambient haze, and a round blob is the
 * wrong shape for a cast: its falloff is symmetric, so the darkest part is
 * always in the middle of the quad and the contact is always somewhere the
 * light did not put it. Stretching its UVs to fake an asymmetric falloff only
 * moves the problem — the stretch drags the blob's black rim off the quad and
 * what is left ends at the geometry, which is the hard rectangle edge that reads
 * as a black box on the floor.
 *
 * So: dark at the contact, fading to nothing before it reaches ANY edge of the
 * quad. Half an ellipse, its centre on the edge that meets the boots, narrow
 * across and long down the cast.
 */
/**
 * The occlusion pool's falloff: symmetric, because occlusion is.
 *
 * A single radial ramp with no hard stop anywhere near the quad's edge, so the
 * patch has no boundary of its own to catch the eye. The steep tail is what
 * keeps it reading as dirt in the seam between boot and tile rather than as a
 * grey oval painted on the floor.
 */
function contactFalloff(scene: Scene): DynamicTexture {
  const size = 128;
  const tex = new DynamicTexture("menu-contact-falloff", { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.30, "#c8c8c8");
  g.addColorStop(0.62, "#4a4a4a");
  g.addColorStop(1, "#000000");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.update();
  tex.getAlphaFromRGB = true;
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}

function shadowFalloff(scene: Scene): DynamicTexture {
  const size = 256;
  const tex = new DynamicTexture("menu-shadow-falloff", { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  const contactY = size * (1 - SHADOW_CONTACT); // canvas y of the soles
  // The quad's back edge is v=0 and a dynamic texture flips y, so the far end is
  // the TOP of this canvas and the soles sit a little up from the bottom.
  ctx.translate(size / 2, contactY);
  ctx.scale(0.34, 1); // narrow across, long along: a cast, not a pool
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, contactY * 0.92);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.22, "#b4b4b4");
  g.addColorStop(0.55, "#3c3c3c");
  g.addColorStop(1, "#000000");
  ctx.fillStyle = g;
  ctx.fillRect(-size * 3, -size, size * 6, size * 2);
  // The strip behind the soles is the ellipse's other half, and it would run off
  // the quad's back edge mid-gradient — a straight cut across the tiles right at
  // his heels. Multiply it down to nothing by that edge.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const heel = ctx.createLinearGradient(0, size, 0, contactY);
  heel.addColorStop(0, "#000000");
  heel.addColorStop(1, "#ffffff");
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = heel;
  ctx.fillRect(0, contactY, size, size - contactY);
  ctx.globalCompositeOperation = "source-over";
  tex.update();
  tex.getAlphaFromRGB = true; // grey on black: the RGB IS the falloff
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}

export interface MenuStage {
  /**
   * Dress the character, or empty the hall with null.
   *
   * Null is a real state and not an absence of one: with no character selected
   * there is nobody to draw, and defaulting to some class instead stands a
   * stranger in the hall wearing gear nobody owns.
   *
   * Visibility only, so it never restarts the idle.
   */
  setLooks(looks: Looks | null): void;
  /** Dust the character away, resolving when the hall is empty. */
  dissolve(): Promise<void>;
  dispose(): void;
}

/** The level camera `frameCamera` solves the lens for. */
export function createMenuCamera(scene: Scene): FreeCamera {
  const camera = new FreeCamera("menu-cam", CAMERA.clone(), scene);
  camera.setTarget(CAMERA.subtract(new Vector3(0, 0, 1)));
  camera.minZ = 0.1;
  camera.maxZ = 40;
  return camera;
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
  // A live WebGL canvas has no readable colour buffer once the frame is
  // presented: capture it and you get the rig's alpha with white where its
  // pixels were. Capturing this screen is not optional (the devlog rule), so the
  // dev build hands the scene out and a capture script renders first.
  if (import.meta.env.DEV) {
    (globalThis as { __menuScene?: Scene }).__menuScene = scene;
  }

  const camera = createMenuCamera(scene);
  // Re-solved whenever the drawing buffer changes size, which is not only on a
  // window resize: at creation the canvas may not have its layout size yet.
  let framed = "";
  const frame = () => {
    const box = canvas.parentElement ?? canvas;
    const sizes = [canvas.clientWidth, canvas.clientHeight, box.clientWidth, box.clientHeight] as const;
    if (sizes.join() === framed || sizes.some((n) => n === 0)) return;
    framed = sizes.join();
    frameCamera(camera, ...sizes, engine.isNDCHalfZRange);
  };

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

  const rim = new PointLight("menu-rim", new Vector3(FEET.x + 0.4, 2.6, -3.2), scene);
  rim.diffuse = RIM_COLOR;
  rim.specular = RIM_COLOR;
  rim.intensity = RIM_INTENSITY;
  rim.range = 12;
  rim.falloffType = Light.FALLOFF_GLTF;

  await loadPlayerRig(scene);

  // Same ordering rule as the contact shadow below, and for the same reason:
  // anything that starts a texture across the wardrobe's glTF import leaves
  // every wardrobe material flat. This cube is what gives the plate's metal a
  // specular lobe to sample, so without it the armour on this plate is black.
  buildSkyEnvironment(scene, {
    sky: SKY_COLOR,
    ground: GROUND_COLOR,
    intensity: ENVIRONMENT_INTENSITY,
  });

  const host = new Mesh("menu-actor", scene);
  host.position.copyFrom(FEET);
  // The glTF loader's right-to-left-handed conversion already points these
  // characters at +Z (see RIG_YAW in rig.ts) and the camera stands on +Z, so
  // zero is square-on to the viewer and a half turn shows his back — which,
  // from behind a hood, looks enough like a face to be worth stating.
  // Turned against the line to the camera, not the world's Z: he stands off-axis.
  host.rotation.y = FACING + Math.atan2(-FEET.x, DISTANCE);
  const rig: RigActor | null = attachRig(scene, host);
  // Standing still is a locomotion speed of zero, which is the idle clip. Asking
  // for the clip by name would duplicate the walk/run hysteresis that already
  // lives in `clipForSpeed`. Settled rather than fresh: he has been waiting in
  // this hall, he did not run in and stop the instant the screen opened.
  rig?.standSettled();

  // Contact shadow, and it must be built HERE, after the wardrobe is in.
  //
  // Placing his feet on the painted floor is only half of standing on it: with
  // nothing under him he still reads as a cut-out laid over the matte, because
  // the one thing every real object does to a floor is dirty it. Flat black,
  // unlit, alpha from the blob — not a shadow map, which would need a caster, a
  // receiver and a light the painting does not have.
  //
  // The ordering is not taste. Construct this `Texture` BEFORE `loadPlayerRig`
  // and every wardrobe material comes back sampling flat white: a white
  // silhouette of the character, correct in shape, lit by nothing. Bisected to
  // the texture alone — the mesh and the material are harmless in either place,
  // and only starting a texture download across the glTF import does it.
  const shadow = MeshBuilder.CreateGround(
    "menu-shadow",
    { width: SHADOW_SIZE.width, height: SHADOW_SIZE.depth },
    scene,
  );
  // A hair BELOW the soles, not above: the rig's origin is its sole plane, and a
  // stain that starts above it is a stain the boots stand on top of. Centred so
  // that `SHADOW_CONTACT` of its length lies behind the feet and the rest ahead.
  const cast = new Vector3(SHADOW_CAST.x, 0, SHADOW_CAST.z)
    .normalize()
    .scale(SHADOW_SIZE.depth * (0.5 - SHADOW_CONTACT));
  shadow.position.set(FEET.x + cast.x, FEET.y - 0.01, FEET.z + cast.z);
  // Turn the long axis onto the cast direction, so the ellipse points where the
  // light throws it instead of straight down the camera's own Z.
  shadow.rotation.y = Math.atan2(SHADOW_CAST.x, SHADOW_CAST.z);
  shadow.isPickable = false;
  const shadowMat = new StandardMaterial("menu-shadow-mat", scene);
  shadowMat.disableLighting = true;
  shadowMat.diffuseColor = Color3.Black();
  shadowMat.emissiveColor = Color3.Black();
  shadowMat.specularColor = Color3.Black();
  shadowMat.opacityTexture = shadowFalloff(scene);
  shadowMat.alpha = SHADOW_STRENGTH;
  shadow.material = shadowMat;

  // ...and the dark directly under him, which is a different thing.
  //
  // The cast above is the shaft's shadow and it is thrown forward and out, so
  // by construction none of it is under the boots. That is correct for a light
  // and wrong for a body: what says an object is ON a floor is the ambient the
  // floor CANNOT get, and that patch sits under the object whatever the light
  // is doing. Without it the soles showed daylight and he read as a cut-out
  // hung over the plate — which is exactly what a cast shadow cannot fix,
  // because moving the cast onto the feet only takes the cast off its own
  // direction.
  //
  // Small, soft, and centred on the soles rather than offset by anything.
  const contact = MeshBuilder.CreateGround(
    "menu-contact",
    { width: CONTACT_SIZE.width, height: CONTACT_SIZE.depth },
    scene,
  );
  // Above the cast by a hair so the two add rather than fight for the same
  // depth, and still under the soles.
  contact.position.set(FEET.x + CONTACT_OFFSET.x, FEET.y - 0.005, FEET.z + CONTACT_OFFSET.z);
  contact.isPickable = false;
  const contactMat = new StandardMaterial("menu-contact-mat", scene);
  contactMat.disableLighting = true;
  contactMat.diffuseColor = Color3.Black();
  contactMat.emissiveColor = Color3.Black();
  contactMat.specularColor = Color3.Black();
  contactMat.opacityTexture = contactFalloff(scene);
  contactMat.alpha = CONTACT_STRENGTH;
  contact.material = contactMat;


  const render = () => { frame(); scene.render(); };
  engine.runRenderLoop(render);

  const onResize = () => engine.resize();
  window.addEventListener("resize", onResize);

  /** The rig's own geometry: every descendant of the host that has any. */
  const worn = () => host.getChildMeshes().filter((m) => m.getTotalVertices() > 0) as Mesh[];

  /** Show or empty the hall. The shadow goes with him: it is a separate unlit
   *  quad, so left alone it stays as a stain on the floor under nobody. */
  /** Has anyone finished condensing on this stage yet? Only the FIRST character
   *  to stand here builds up; arrowing along a roster must not restage the
   *  arrival every time the selection moves. */
  let arrived = false;

  const stand = (there: boolean) => {
    host.setEnabled(there);
    shadow.setEnabled(there);
    contact.setEnabled(there);
    shadowMat.alpha = SHADOW_STRENGTH;
    contactMat.alpha = CONTACT_STRENGTH;
  };

  return {
    setLooks(looks) {
      if (looks === null) {
        stand(false);
        arrived = false;
        return;
      }
      stand(true);
      rig?.setLooks(looks);
      // After dressing, not before: re-texturing a slot for a gear base CLONES
      // its material, and a clone does not carry the plugin (it is deliberately
      // not serialized), so the thing that needs compiling only exists once the
      // character is wearing it.
      //
      // Primed to GONE the first time, and the character then condenses out of
      // the ash he would leave in. Standing in an empty hall waiting for a
      // wardrobe to arrive and then having a finished man appear is the moment
      // that says "that was loading"; building him is the same wait spent
      // saying the hall meant to do it.
      const dressed = worn();
      if (arrived) {
        void primeDissolve(dressed);
        return;
      }
      arrived = true;
      // Nothing to see until the shader is compiled, which is the whole reason
      // the prime is awaited rather than fired off: with the plugin attached
      // late he is drawn solid for a few frames and only then starts eroding.
      void primeDissolve(dressed, 1).then(() => {
        shadowMat.alpha = 0;
        contactMat.alpha = 0;
        return dissolveIn(scene, dressed, (gone) => {
          shadowMat.alpha = SHADOW_STRENGTH * (1 - gone) * (1 - gone);
          contactMat.alpha = CONTACT_STRENGTH * (1 - gone) * (1 - gone);
        });
      });
    },
    async dissolve() {
      await dissolveAway(scene, worn(), (gone) => {
        // Squared, so the stain is mostly gone by the time the body is, rather
        // than lingering under someone who is no longer there to cast it.
        shadowMat.alpha = SHADOW_STRENGTH * (1 - gone) * (1 - gone);
        contactMat.alpha = CONTACT_STRENGTH * (1 - gone) * (1 - gone);
      });
      stand(false);
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
