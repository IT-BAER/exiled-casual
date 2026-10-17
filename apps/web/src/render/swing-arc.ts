import { Color3, Mesh, StandardMaterial, Vector3, VertexBuffer, VertexData } from "@babylonjs/core";
import type { GlowLayer, Scene } from "@babylonjs/core";

/**
 * The 3D crescent a melee swing cuts through the air: a strip from the weapon
 * tip in toward the swinger's chest, bright at the blade edge and gone at its
 * inner side, every sample fading on its own clock. Pooled per scene (a couple
 * of meshes, one material), so a swing allocates nothing.
 */
export const SWING_ARC_NAME = "fx-swing-arc";

export interface SwingStyle {
  /** Units the crescent reaches in from the tip toward the chest. */
  width: number;
  /** Seconds one sample of the arc stays visible. */
  seconds: number;
  colour: Color3;
  /** Peak alpha at the blade edge. */
  alpha: number;
}

/** Strike: a quick, narrow, pale steel arc that is gone almost at once. */
export const STRIKE_ARC: SwingStyle = { width: 0.38, seconds: 0.11, colour: new Color3(0.92, 0.94, 1), alpha: 0.5 };
/** Heavy Strike: wide and warm, and it hangs in the air for the weight. */
export const HEAVY_STRIKE_ARC: SwingStyle = { width: 0.85, seconds: 0.2, colour: new Color3(1, 0.8, 0.5), alpha: 0.72 };
/** Ground Slam: the widest, hottest overhead arc, cut short by the floor. */
export const GROUND_SLAM_ARC: SwingStyle = { width: 1.05, seconds: 0.24, colour: new Color3(1, 0.62, 0.3), alpha: 0.8 };

export const SWING_STYLE: Record<string, SwingStyle> = {
  "skill.strike.v1": STRIKE_ARC,
  "skill.heavy_strike.v1": HEAVY_STRIKE_ARC,
  "skill.ground_slam.v1": GROUND_SLAM_ARC,
};

export function swingStyle(skillId: string | undefined): SwingStyle {
  return (skillId === undefined ? undefined : SWING_STYLE[skillId]) ?? STRIKE_ARC;
}

/** Samples one arc holds, and the largest angle between two before it is subdivided. */
const SAMPLES = 40;
const MAX_STEP = 0.12;
/** Share of the width the soft outer lip extends past the blade edge. */
const LIP = 0.14;
/** Meshes per scene: a swing may start while the last one is still fading. */
const ARCS = 2;

class Arc {
  readonly mesh: Mesh;
  private readonly pos = new Float32Array(SAMPLES * 3 * 3);
  private readonly col = new Float32Array(SAMPLES * 3 * 4);
  /** Ring of samples: tip xyz, inner xyz, birth time. */
  private readonly tip = new Float32Array(SAMPLES * 3);
  private readonly inner = new Float32Array(SAMPLES * 3);
  private readonly born = new Float64Array(SAMPLES);
  private count = 0;
  private head = 0;
  style: SwingStyle = STRIKE_ARC;
  /** Newest sample time, or -Infinity when idle. */
  last = -Infinity;
  private prevTip: Vector3 | null = null;
  private prevCentre: Vector3 | null = null;

  constructor(scene: Scene, name: string, mat: StandardMaterial) {
    this.mesh = new Mesh(name, scene);
    const idx: number[] = [];
    for (let k = 0; k < SAMPLES - 1; k++) {
      for (let r = 0; r < 2; r++) {
        const a = k * 3 + r, b = a + 1, c = a + 3, d = a + 4;
        idx.push(a, c, b, b, c, d);
      }
    }
    const vd = new VertexData();
    vd.positions = this.pos;
    vd.colors = this.col;
    vd.indices = idx;
    vd.applyToMesh(this.mesh, true);
    this.mesh.material = mat;
    this.mesh.hasVertexAlpha = true;
    this.mesh.isPickable = false;
    this.mesh.receiveShadows = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.doNotSyncBoundingInfo = true;
  }

  start(style: SwingStyle): void {
    this.style = style;
    this.count = 0;
    this.head = 0;
    this.prevTip = null;
    this.prevCentre = null;
  }

  add(tipAt: Vector3, centre: Vector3 | null, now: number): void {
    const c = centre ?? tipAt.subtract(new Vector3(0, this.style.width, 0));
    // Fill a fast drop with points swung round the centre, so a low frame rate
    // still draws a curve instead of a polyline.
    if (this.prevTip && this.prevCentre) {
      const a = this.prevTip.subtract(this.prevCentre);
      const b = tipAt.subtract(c);
      const la = a.length(), lb = b.length();
      const angle = la > 1e-4 && lb > 1e-4 ? Math.acos(Math.min(1, Math.max(-1, Vector3.Dot(a, b) / (la * lb)))) : 0;
      const steps = Math.min(6, Math.floor(angle / MAX_STEP));
      for (let s = 1; s <= steps; s++) {
        const k = s / (steps + 1);
        const dir = a.scale(1 / la).scale(1 - k).add(b.scale(1 / lb).scale(k)).normalize();
        const cen = Vector3.Lerp(this.prevCentre, c, k);
        this.push(cen.add(dir.scale(la + (lb - la) * k)), cen, now);
      }
    }
    this.push(tipAt, c, now);
    this.prevTip = tipAt.clone();
    this.prevCentre = c.clone();
    this.last = now;
  }

  private push(tipAt: Vector3, centre: Vector3, now: number): void {
    const i = this.head;
    this.head = (this.head + 1) % SAMPLES;
    this.count = Math.min(SAMPLES, this.count + 1);
    const toward = centre.subtract(tipAt);
    const reach = Math.min(this.style.width, toward.length());
    if (toward.lengthSquared() > 1e-8) toward.normalize();
    this.tip.set([tipAt.x, tipAt.y, tipAt.z], i * 3);
    this.inner.set([tipAt.x + toward.x * reach, tipAt.y + toward.y * reach, tipAt.z + toward.z * reach], i * 3);
    this.born[i] = now;
  }

  /** Rewrite the strip at `now`; false once every sample has faded. */
  draw(now: number): boolean {
    const { seconds, colour, alpha } = this.style;
    let shown = 0;
    let lastK = -1;
    for (let n = 0; n < SAMPLES; n++) {
      // Oldest first, so the strip runs from where the swing began to the blade.
      const k = n < this.count ? (this.head - this.count + n + SAMPLES) % SAMPLES : lastK;
      const age = k < 0 ? Infinity : now - this.born[k]!;
      const live = n < this.count && age < seconds;
      if (live) shown++;
      if (k >= 0) lastK = k;
      const fade = live ? alpha * (1 - age / seconds) ** 2 : 0;
      for (let r = 0; r < 3; r++) {
        const v = n * 3 + r;
        if (k < 0) {
          this.pos.fill(0, v * 3, v * 3 + 3);
        } else {
          const tx = this.tip[k * 3]!, ty = this.tip[k * 3 + 1]!, tz = this.tip[k * 3 + 2]!;
          const ix = this.inner[k * 3]!, iy = this.inner[k * 3 + 1]!, iz = this.inner[k * 3 + 2]!;
          // Row 0 is the soft lip past the edge, 1 the blade edge, 2 the inner side.
          const m = r === 0 ? -LIP : r === 1 ? 0 : 1;
          this.pos[v * 3] = tx + (ix - tx) * m;
          this.pos[v * 3 + 1] = ty + (iy - ty) * m;
          this.pos[v * 3 + 2] = tz + (iz - tz) * m;
        }
        const a = r === 1 ? fade : r === 2 ? 0 : fade * 0.15;
        this.col.set([colour.r, colour.g, colour.b, a], v * 4);
      }
    }
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.pos);
    this.mesh.updateVerticesData(VertexBuffer.ColorKind, this.col);
    return shown > 0;
  }
}

class SwingArcs {
  private readonly arcs: Arc[] = [];
  private next = 0;
  private clock = 0;
  private active = new Set<Arc>();

  constructor(scene: Scene) {
    const mat = new StandardMaterial(`${SWING_ARC_NAME}-mat`, scene);
    mat.emissiveColor = Color3.White();
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.alphaMode = 1; // ALPHA_ADD
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    const glow = scene.effectLayers?.find((l) => l.name === "glow") as GlowLayer | undefined;
    for (let i = 0; i < ARCS; i++) {
      const arc = new Arc(scene, `${SWING_ARC_NAME}-${i}`, mat);
      glow?.referenceMeshToUseItsOwnMaterial(arc.mesh);
      arc.draw(0);
      this.arcs.push(arc);
    }
    scene.onBeforeRenderObservable.add(() => {
      this.clock += scene.getEngine().getDeltaTime() / 1000;
      for (const arc of this.active) if (!arc.draw(this.clock)) this.active.delete(arc);
    });
  }

  meshes(): Mesh[] {
    return this.arcs.map((a) => a.mesh);
  }

  /** A fresh swing in `style`; the oldest arc is recycled. */
  begin(style: SwingStyle): { follow(at: Vector3, centre?: Vector3): void } {
    const arc = this.arcs[this.next]!;
    this.next = (this.next + 1) % this.arcs.length;
    arc.start(style);
    return {
      follow: (at, centre) => {
        arc.add(at, centre ?? null, this.clock);
        this.active.add(arc);
        arc.draw(this.clock);
      },
    };
  }
}

const arcsByScene = new WeakMap<Scene, SwingArcs>();

/** The scene's swing arcs, built on first use. */
export function swingArcs(scene: Scene): SwingArcs {
  let a = arcsByScene.get(scene);
  if (!a) {
    a = new SwingArcs(scene);
    arcsByScene.set(scene, a);
    scene.onDisposeObservable.addOnce(() => arcsByScene.delete(scene));
  }
  return a;
}
