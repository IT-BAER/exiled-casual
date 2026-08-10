/**
 * Turning a character to ash.
 *
 * Deleting someone used to be a state change with no event: the row vanished
 * and the figure in the hall was simply not drawn on the next frame. A character
 * you have played for hours deserves the frame it takes to lose him, and the
 * reference is the obvious one — Infinity War's dusting, which works because it
 * is SLOW, because the body goes from the bottom up rather than fading
 * uniformly, and because what leaves the body is lit while the body is not.
 *
 * A uniform alpha fade cannot do any of that: it dims every pixel by the same
 * amount at the same time, which reads as a light going out, not as a person
 * coming apart. So this erodes instead. A noise field is evaluated in WORLD
 * space and pixels are discarded where it falls under a rising threshold, which
 * gives a ragged edge that eats into the silhouette; a narrow band just above
 * the threshold is pushed bright, so the erosion front glows like a burning
 * paper edge; and the threshold is biased by height, so his boots go before his
 * hood. Ash lifts off the front as it climbs.
 *
 * World space and not UV space, deliberately: a UV-space dissolve breaks at
 * every seam in the atlas, and this character is assembled from eight parts
 * across three materials — the coat would come apart on a different schedule
 * from the arm inside it.
 */
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Material } from "@babylonjs/core/Materials/material";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Color3, Color4, Quaternion, Vector3 } from "@babylonjs/core/Maths/math";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";

/**
 * How long the whole thing takes. Slow is the effect; hurried, it is a glitch.
 *
 * 3.0 is the length the owner watched and liked. It went to 4.5 on the strength
 * of a separate "nice slow", which was a guess at what he meant rather than
 * anything he saw, so it is back at the judged value: a number nobody has
 * watched is not a tuned number.
 */
export const DISSOLVE_SECONDS = 3.0;

/**
 * How much of the erosion is spent sweeping up the body rather than eating in
 * everywhere at once. 0 dissolves the whole figure uniformly (a fizzle); 1 is a
 * hard waterline climbing him, which reads as sinking rather than crumbling.
 * Just over half keeps a recognisable head while the legs are already going.
 */
const SWEEP = 0.55;

/** Width of the glowing band behind the front, in noise units. */
const EDGE = 0.075;

/** Noise frequency. High enough to read as grain, not as marble. */
const SCALE = 24.0;

/** Ember, not fire: this hall is lit by braziers and the edge has to belong. */
const EDGE_COLOR = new Color3(1.0, 0.44, 0.13);

/** How hard the edge burns. Above the 1.0 the shader would clamp to, so it blooms. */
const EDGE_GAIN = 3.4;

const ASH_COUNT = 1600;

/**
 * How far his head goes back, in radians, and how it is shared down the neck.
 *
 * Split rather than all in the skull, because a head that pivots alone on a
 * fixed neck is a doll looking up. Most of it in `Head` with the rest in
 * `neck_01` bends the whole column, which is what a person does.
 */
const LOOK_UP = 0.66;
const LOOK_SHARE: readonly [string, number][] = [
  ["Head", 0.62],
  ["neck_01", 0.38],
];

/**
 * The axis his head pitches back around, in each joint's own space.
 *
 * X is the pitch axis for this rig's Unreal-named joints, and the sign is the
 * one that tips the chin up rather than down onto his chest. Both were settled
 * on screen, because a bone's local axes after the glTF importer's two
 * handedness conversions are not something to reason about from the file.
 */
const LOOK_AXIS = new Vector3(-1, 0, 0);

/**
 * The dissolve, as a patch over whatever material a part already had.
 *
 * A plugin rather than a replacement `ShaderMaterial`, because the character has
 * to keep being lit and textured the entire way out. Swapping in a bespoke
 * shader would drop the PBR lighting, the skin atlas and the gear palettes at
 * frame one, so he would change appearance before he started to leave.
 */
class DissolvePlugin extends MaterialPluginBase {
  /** 0 is solid and costs a discard test; 1 is gone. */
  amount = 0;

  constructor(material: Material) {
    // Late priority: the discard has to see the final surface, and nothing that
    // runs after it cares that the pixel is gone.
    super(material, "ExiledDissolve", 400, {}, true, true);
    // Cloning a material serializes its plugins, and `Material.Parse` revives
    // each one with `Tools.Instantiate("BABYLON." + className)` — a lookup on a
    // global that does not exist in an ES-module build, so it throws. `rig.ts`
    // clones PBR materials to re-palette gear, which put that clone squarely on
    // the path of dressing the character. Nothing here belongs in a saved
    // material anyway: it is an effect that runs once and takes the mesh with it.
    this.doNotSerialize = true;
  }

  override getClassName(): string {
    return "ExiledDissolve";
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return {
      ubo: [
        { name: "dissolveAmount", size: 1, type: "float" },
        { name: "dissolveEdge", size: 1, type: "float" },
        { name: "dissolveScale", size: 1, type: "float" },
        { name: "dissolveSweep", size: 1, type: "float" },
        { name: "dissolveGain", size: 1, type: "float" },
        { name: "dissolveBounds", size: 2, type: "vec2" },
        { name: "dissolveColor", size: 3, type: "vec3" },
      ],
      fragment: `
        uniform float dissolveAmount;
        uniform float dissolveEdge;
        uniform float dissolveScale;
        uniform float dissolveSweep;
        uniform float dissolveGain;
        uniform vec2 dissolveBounds;
        uniform vec3 dissolveColor;
      `,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat("dissolveAmount", this.amount);
    uniformBuffer.updateFloat("dissolveEdge", EDGE);
    uniformBuffer.updateFloat("dissolveScale", SCALE);
    uniformBuffer.updateFloat("dissolveSweep", SWEEP);
    uniformBuffer.updateFloat("dissolveGain", EDGE_GAIN);
    uniformBuffer.updateFloat2("dissolveBounds", bounds.min, bounds.max);
    uniformBuffer.updateColor3("dissolveColor", EDGE_COLOR);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    return {
      // Value noise, four octaves. Cheap, and the grain is what sells it: a
      // smooth field erodes in soft blobs that read as melting rather than
      // crumbling.
      CUSTOM_FRAGMENT_DEFINITIONS: `
        float dissolveGlow;

        float exDissolveHash(vec3 p) {
          p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }

        float exDissolveNoise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(exDissolveHash(i + vec3(0.0, 0.0, 0.0)), exDissolveHash(i + vec3(1.0, 0.0, 0.0)), f.x),
                mix(exDissolveHash(i + vec3(0.0, 1.0, 0.0)), exDissolveHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
            mix(mix(exDissolveHash(i + vec3(0.0, 0.0, 1.0)), exDissolveHash(i + vec3(1.0, 0.0, 1.0)), f.x),
                mix(exDissolveHash(i + vec3(0.0, 1.0, 1.0)), exDissolveHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
            f.z);
        }

        float exDissolveFbm(vec3 p) {
          float sum = 0.0;
          float amp = 0.5;
          for (int i = 0; i < 4; i++) {
            sum += amp * exDissolveNoise(p);
            p *= 2.03;
            amp *= 0.5;
          }
          return sum;
        }
      `,
      // Discard first, so an eroded pixel never pays for the lighting it was
      // about to be given.
      CUSTOM_FRAGMENT_MAIN_BEGIN: `
        dissolveGlow = 0.0;
        if (dissolveAmount > 0.0) {
          vec3 exPos = vPositionW;
          float exSpan = max(dissolveBounds.y - dissolveBounds.x, 0.0001);
          float exUp = clamp((exPos.y - dissolveBounds.x) / exSpan, 0.0, 1.0);
          float exNoise = exDissolveFbm(exPos * dissolveScale);
          // Runs from below every noise value to above every one of them, so
          // amount 0 discards nothing anywhere and amount 1 discards everything.
          // The sweep term is what makes the boots leave before the hood.
          float exCut = dissolveAmount * (1.0 + dissolveSweep + 0.05)
                      - dissolveSweep * exUp - 0.05;
          float exDepth = exNoise - exCut;
          if (exDepth < 0.0) discard;
          dissolveGlow = 1.0 - smoothstep(0.0, dissolveEdge, exDepth);
        }
      `,
      // Added after tone mapping rather than into the albedo, or the edge would
      // be a lit surface the braziers get a vote on instead of its own light.
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
        finalColor.rgb += dissolveColor * dissolveGlow * dissolveGain;
      `,
    };
  }
}

/**
 * Vertical extent of the figure, in world units, shared by every plugin instance.
 *
 * One object rather than a uniform per material because every part of one
 * character has to erode on the SAME schedule: give the boots their own bounds
 * and they compute their own 0..1 height, so each part dissolves bottom-to-top
 * within itself and the character comes apart in slices.
 */
const bounds = { min: 0, max: 2 };

/** Soft round mote. Drawn, because one 32px dot is not worth a fetch. */
function ashSprite(scene: Scene): DynamicTexture {
  const size = 64;
  const tex = new DynamicTexture("menu-ash", { width: size, height: size }, scene, false);
  const ctx = tex.getContext();
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

/**
 * Ash coming off the erosion front.
 *
 * Emitted from a horizontal slab that rides the front up the body rather than
 * from the mesh surface. At this camera the figure is about a hundred pixels
 * tall, so a slab tracking the right height is indistinguishable from true
 * surface emission, and it does not need the skinned world positions — which are
 * on the GPU, and would have to be read back every frame to get at them.
 */
function ashAt(scene: Scene, box: { min: Vector3; max: Vector3 }): ParticleSystem {
  const ash = new ParticleSystem("menu-ash", ASH_COUNT, scene);
  ash.particleTexture = ashSprite(scene);
  ash.blendMode = ParticleSystem.BLENDMODE_ADD;

  const mid = box.min.add(box.max).scale(0.5);
  ash.emitter = new Vector3(mid.x, box.min.y, mid.z);
  const halfX = (box.max.x - box.min.x) * 0.5;
  const halfZ = (box.max.z - box.min.z) * 0.5;
  ash.minEmitBox = new Vector3(-halfX, 0, -halfZ);
  ash.maxEmitBox = new Vector3(halfX, 0.06, halfZ);

  // Ember at birth, cold grey by the time it has risen: the mote cools as it
  // leaves, which is the difference between ash and sparks.
  ash.color1 = new Color4(1.0, 0.52, 0.18, 1.0);
  ash.color2 = new Color4(0.95, 0.30, 0.08, 1.0);
  ash.colorDead = new Color4(0.36, 0.34, 0.33, 0.0);

  ash.minSize = 0.006;
  ash.maxSize = 0.02;
  ash.minLifeTime = 0.9;
  ash.maxLifeTime = 2.2;
  ash.emitRate = 0;

  // Up and slightly downwind, with almost no gravity: this is dust caught in the
  // hall's air, not sparks thrown off a fire.
  ash.direction1 = new Vector3(-0.14, 0.55, -0.1);
  ash.direction2 = new Vector3(0.14, 1.1, 0.12);
  ash.gravity = new Vector3(0, 0.035, 0);
  ash.minEmitPower = 0.06;
  ash.maxEmitPower = 0.24;
  ash.updateSpeed = 0.012;
  ash.minAngularSpeed = 0;
  ash.maxAngularSpeed = Math.PI;
  return ash;
}

/** Smooth at both ends: no jolt when it starts, no snap when it finishes. */
function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** The world-space box every given mesh sits inside. */
function unionBox(meshes: AbstractMesh[]): { min: Vector3; max: Vector3 } {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    const info = mesh.getBoundingInfo().boundingBox;
    min.minimizeInPlace(info.minimumWorld);
    max.maximizeInPlace(info.maximumWorld);
  }
  return { min, max };
}

/** The plugin already on this material, if it has ever dissolved. */
function existingPlugin(material: Material): DissolvePlugin | null {
  return (material.pluginManager?.getPlugin("ExiledDissolve") as DissolvePlugin | null) ?? null;
}

/**
 * The plugin on this material, attaching one if needed.
 *
 * Attaching is not free — it invalidates the material's shader and pays a
 * recompile — so it happens when someone actually starts to leave, never on the
 * way in. Dressing the character used to attach it to all three of his materials
 * for nothing.
 */
function pluginOf(material: Material): DissolvePlugin {
  return existingPlugin(material) ?? new DissolvePlugin(material);
}

/** Every distinct material worn by these meshes. */
function materialsOf(meshes: AbstractMesh[]): Material[] {
  const seen = new Set<Material>();
  for (const mesh of meshes) {
    if (mesh.material) seen.add(mesh.material);
  }
  return [...seen];
}

/**
 * Attach the effect and compile it NOW, while nobody is being deleted.
 *
 * Attaching a material plugin invalidates that material's shader, and a mesh
 * whose shader is still compiling is not drawn — so attaching it at the moment
 * someone hits DELETE blanked the character for a handful of frames and then
 * popped him back, which read as the screen reloading right before the effect.
 * The compile has to happen somewhere; the only place it is free is here, behind
 * the wardrobe fetch that is already going on when a character is dressed.
 *
 * Also resets `amount`, so whoever stands here next does not inherit the last
 * one's erosion.
 */
export async function primeDissolve(meshes: AbstractMesh[], amount = 0): Promise<void> {
  const first = new Map<Material, AbstractMesh>();
  for (const mesh of meshes) {
    if (mesh.material && !first.has(mesh.material)) first.set(mesh.material, mesh);
  }
  await Promise.all(
    [...first].map(async ([material, mesh]) => {
      pluginOf(material).amount = amount;
      // Needs a mesh that actually wears it: compilation is per material AND the
      // defines its meshes bring (skinning, here).
      await material.forceCompilationAsync(mesh);
    }),
  );
}

/**
 * Dust `meshes` away over `seconds`, resolving once there is nothing left.
 *
 * Driven off the render loop rather than a timer, so it cannot advance while the
 * tab is hidden and come back finished. `fade` is called with the same 0..1 so
 * the caller can take anything the shader does not own with it — the contact
 * shadow, which is a separate unlit quad and would otherwise be a stain on the
 * floor under nobody.
 */
export function dissolveAway(
  scene: Scene,
  meshes: Mesh[],
  /** Anything the shader does not own: the contact shadow, chiefly. */
  fade: (gone: number) => void,
  seconds = DISSOLVE_SECONDS,
): Promise<void> {
  return sweep(scene, meshes, fade, seconds, 1);
}

/**
 * ...and the same thing backwards: a character condensing out of the ash.
 *
 * The one place a body arrives on this stage is the select screen, where the
 * wardrobe is a fetch and a dress, and until both land there is nothing there at
 * all. Popping a finished man into the hall is the giveaway that it was loading;
 * assembling him out of the same dust he leaves in says the hall did it on
 * purpose. Same shader, same ash, same easing, run from gone to solid.
 *
 * Callers must `primeDissolve(meshes, 1)` and AWAIT it first. Attaching the
 * plugin invalidates the material's shader and a compiling mesh is not drawn, so
 * priming late shows a solid character for a few frames and then starts eroding
 * him, which reads as a glitch rather than as an arrival.
 */
export function dissolveIn(
  scene: Scene,
  meshes: Mesh[],
  fade: (gone: number) => void,
  seconds = DISSOLVE_SECONDS,
): Promise<void> {
  return sweep(scene, meshes, fade, seconds, -1);
}

/**
 * One erosion sweep. `way` is +1 for leaving and -1 for arriving.
 *
 * The head is the one thing that is not symmetric. On the way out he looks UP
 * first and leaves second, which is what makes it read as being taken rather
 * than destroyed; on the way in he arrives already looking up and lowers his
 * chin as he solidifies, which is the same gesture finishing rather than the
 * same gesture rewound.
 */
function sweep(
  scene: Scene,
  meshes: Mesh[],
  fade: (gone: number) => void,
  seconds: number,
  way: 1 | -1,
): Promise<void> {
  const alive = meshes.filter((m) => m.isEnabled() && m.isVisible);
  if (alive.length === 0) return Promise.resolve();

  const box = unionBox(alive);
  bounds.min = box.min.y;
  bounds.max = box.max.y;

  const plugins = materialsOf(alive).map((m) => pluginOf(m));
  const ash = ashAt(scene, box);
  ash.start();

  /**
   * The neck, snapshotted before anything touches it.
   *
   * Written every frame from this snapshot rather than multiplied into whatever
   * is there: the idle clip may or may not key these joints, and a tilt composed
   * onto its own previous output winds the head all the way round in four
   * seconds. Snapshotting also stops the head's idle drift for the duration,
   * which is the right read anyway — he goes still, and then he goes up.
   */
  const neck = LOOK_SHARE.map(([name, share]) => {
    const node = scene.getTransformNodeByName(name);
    return node === null
      ? null
      : { node, share, base: (node.rotationQuaternion ?? Quaternion.Identity()).clone() };
  }).filter((j): j is { node: TransformNode; share: number; base: Quaternion } => j !== null);

  const restore = () => {
    for (const joint of neck) joint.node.rotationQuaternion = joint.base.clone();
  };

  return new Promise<void>((resolve) => {
    let elapsed = 0;
    const observer = scene.onBeforeRenderObservable.add(() => {
      elapsed += scene.getEngine().getDeltaTime() / 1000;
      const t = ease(Math.min(1, elapsed / seconds));
      const gone = way === 1 ? t : 1 - t;
      for (const plugin of plugins) plugin.amount = gone;
      // Head back on its own curve, and ahead of the erosion: he looks up first
      // and leaves second, which is the order that makes it read as being taken
      // rather than as being destroyed.
      const tilt = ease(Math.min(1, elapsed / (seconds * 0.55)));
      const look = LOOK_UP * (way === 1 ? tilt : 1 - tilt);
      for (const joint of neck) {
        joint.node.rotationQuaternion = joint.base.multiply(
          Quaternion.RotationAxis(LOOK_AXIS, look * joint.share),
        );
      }
      fade(gone);

      // Ash rides the erosion front up the body, and stops being made once the
      // front has run off the top of him.
      const front = box.min.y + (box.max.y - box.min.y) * Math.min(1, gone * (1 + SWEEP));
      (ash.emitter as Vector3).y = front;
      ash.emitRate = gone >= 1 ? 0 : 320 + 1500 * Math.sin(Math.PI * gone);

      if (elapsed < seconds) return;
      scene.onBeforeRenderObservable.remove(observer);
      restore();
      // Let what is already in the air finish drifting; the body is gone by now.
      ash.stop();
      setTimeout(() => {
        ash.dispose(true);
      }, 3000);
      resolve();
    });
  });
}
