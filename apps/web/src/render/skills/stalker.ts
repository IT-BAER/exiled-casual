import { Color3, Mesh, MeshBuilder, Vector3 } from "@babylonjs/core";
import type { Scene, TransformNode } from "@babylonjs/core";
import { ARROW_NAME, buildArrow, SKILL_FX, type FxProfile } from "../skill-fx";
import {
  addMat, auraSigil, bindToNode, blendMat, buffSwirl, clamp01, cloneOf, core, fire, frostBurst, Fx, fxMesh, Geo, iceCrystalCluster,
  kitFlash, kitPools, litMat, markReticle, puff, pulseRingTemplate, ragged, rand, rgba, ribbonTrail,
  shockRing, skyFall, sparks, TAU, template, throwChunks,
  type Rgb,
} from "./kit";
import type {
  ActorRef, AreaLook, AreaState, BuffLook, BurstHandle, CastLook, CastState, ClassSkillLooks, FxHandle,
  LookContext, ProjectileHandle, ProjectileLook, StatusLook, TravelLook,
} from "./types";

/**
 * The Stalker's six (spec 2026-11-01 section 1): cold arrows that burst into ice,
 * a lightning arrow whose chains leap body to body, a sniper's reticle, a volley
 * that rises and rains, and a teal speed aura. Every piece is kit geometry or
 * pooled motes; nothing is a card.
 *
 * Bow skills keep the shipped arrow (`projectileFx`): every bow skill must fly a
 * real arrow mesh. What each arrow carries on top (frost sheath and trail, the
 * crackle, the burst where it lands, the chain arcs) is its `projectile` look,
 * handed that arrow by the dispatcher (`arrowLook`).
 */

const FROST: Rgb = [0.55, 0.85, 1];
const ICE_HOT: Rgb = [0.9, 0.98, 1];
const SHOCK: Rgb = [0.55, 0.72, 1];
const SHOCK_HOT: Rgb = [0.95, 0.97, 1];
const MARK: Rgb = [1, 0.18, 0.1];
const VOLLEY: Rgb = [1, 0.86, 0.55];
const HASTE: Rgb = [0.3, 0.95, 0.82];

const ARROW = SKILL_FX["skill.snap_shot.v1"]!;

/** Each wake is its own colour, so the three arrows read apart in flight. */
const ESCAPE_FX: FxProfile = {
  ...ARROW, core: new Color3(0.8, 0.94, 1), wake: new Color3(0.55, 0.85, 1), trailWidth: 0.06,
  streakLength: 1.5, streakAlpha: 0.5, motes: 1.5, flash: 0.35, arrowImpact: "chip",
};
const ICE_FX: FxProfile = {
  ...ARROW, core: new Color3(0.86, 0.97, 1), wake: new Color3(0.45, 0.8, 1), trailWidth: 0.14,
  streakLength: 3.2, streakAlpha: 0.85, motes: 4, flash: 0.6, arrowImpact: "pierce",
};
const LIGHTNING_FX: FxProfile = {
  ...ARROW, core: new Color3(0.92, 0.95, 1), wake: new Color3(0.6, 0.7, 1), trailWidth: 0.08,
  streakLength: 2.6, streakAlpha: 0.65, motes: 3, flash: 0.5, arrowImpact: "pierce",
};

// ── Adapters: kit `Fx` (update(dt)) onto the dispatcher's handles ────────────────

function lasting<S>(fx: Fx, each?: (ctx: LookContext, s: S) => void): FxHandle<S> {
  return {
    update(ctx, s) {
      each?.(ctx, s);
      fx.update(ctx.dt);
    },
    fade(ctx) {
      fx.stop();
      fx.update(ctx.dt);
      return !fx.done;
    },
    dispose: () => fx.dispose(),
  };
}

function burst(fx: Fx): BurstHandle {
  return {
    update(ctx) {
      fx.update(ctx.dt);
      return !fx.done;
    },
    dispose: () => fx.dispose(),
  };
}

/** A group of one-shots run as one burst. */
function group(...parts: Fx[]): Fx {
  const fx = new Fx(() => false);
  for (const p of parts) fx.child(p);
  return fx;
}

const floorAt = (n: TransformNode, y = 0): Vector3 => {
  const p = n.getAbsolutePosition();
  return new Vector3(p.x, p.y + y, p.z);
};

// ── Arrow decoration ─────────────────────────────────────────────────────────────

/** A chained arrow's source: the struck body it left (`chainFrom`), at the arrow's height. */
type ChainSrc = Vector3 | null;

interface ArrowDecor {
  /** Flight dressing riding `arrow`; returns the run, stopped when the arrow goes. */
  flight(scene: Scene, arrow: Mesh, head: () => Vector3): Fx | null;
  /** The arrow struck something: `at` is where, `dirX/dirZ` the way it flew, `src` the body a chain left. */
  impact(scene: Scene, at: Vector3, dirX: number, dirZ: number, born: Vector3, src: ChainSrc): void;
  /** First drawn frame, where the arrow was loosed (or chained from `src`). */
  born?(scene: Scene, arrow: Mesh, at: Vector3, head: () => Vector3, src: ChainSrc): Fx | null;
}

/**
 * A decor as the skill's projectile look: the dispatcher hands it the shipped arrow
 * on its first drawn frame (already at the bow), and its impact once struck. The
 * flight runs are let go on dispose and finish under the dispatcher (`ctx.adopt`).
 */
function arrowLook(d: ArrowDecor): ProjectileLook {
  return {
    create(ctx, p): ProjectileHandle {
      const scene = ctx.scene;
      const arrow = p.node as Mesh;
      const last = arrow.getAbsolutePosition().clone();
      const head = () => {
        if (!arrow.isDisposed()) last.copyFrom(arrow.computeWorldMatrix(true).getTranslation());
        return last;
      };
      const born = head().clone();
      const src: ChainSrc = p.chainFrom ? new Vector3(p.chainFrom.x, born.y, p.chainFrom.z) : null;
      const runs: Fx[] = [];
      const b = d.born?.(scene, arrow, born, head, src);
      if (b) runs.push(b);
      const f = d.flight(scene, arrow, head);
      if (f) runs.push(f);
      let c = ctx;
      return {
        update(next) {
          c = next;
          head();
          for (const r of runs) r.update(next.dt);
        },
        impact(next, s) {
          d.impact(next.scene, head().clone(), s.dirX, s.dirY, born, src);
        },
        dispose() {
          for (const r of runs) {
            r.stop();
            if (c.adopt) c.adopt({ update: (n) => { r.update(n.dt); return !r.done; }, dispose: () => r.dispose() });
            else fire(scene, r);
          }
        },
      };
    },
  };
}

/** Ice crystals clad round the head: a hex point and two shards, lit so they read as ice without bloom. */
function iceTip(scene: Scene): Mesh {
  return template(scene, "stalker-ice-tip", () => {
    const m = MeshBuilder.CreateCylinder("stalker-ice-tip", { height: 0.42, diameterTop: 0, diameterBottom: 0.13, tessellation: 6 }, scene);
    m.rotation.x = Math.PI / 2;
    m.bakeCurrentTransformIntoVertices();
    m.convertToFlatShadedMesh();
    m.material = litMat(scene, "stalker-ice", [0.62, 0.85, 1], [0.3, 0.55, 0.8], 0.15, 0.9);
    return m;
  });
}

/** Ice shards riding the arrow; children of it, so they go with it. */
function clad(scene: Scene, arrow: Mesh, shards: number): void {
  const tpl = iceTip(scene);
  for (let i = 0; i < shards; i++) {
    const m = cloneOf(scene, tpl, "stalker-ice-tip");
    m.parent = arrow;
    if (i === 0) {
      m.position.set(0, 0, 0.42);
      m.scaling.setAll(1.15);
    } else {
      const a = (i / shards) * TAU;
      m.position.set(Math.sin(a) * 0.05, Math.cos(a) * 0.05, 0.2 - i * 0.08);
      m.rotation.set(Math.cos(a) * 0.35, -Math.sin(a) * 0.35, 0);
      m.scaling.setAll(0.65);
    }
  }
}

/** Frost flaking off a flying arrow: pale ice motes falling out of the wake. */
function frostFlakes(scene: Scene, head: () => Vector3, rate: number): Fx {
  let owed = 0;
  return new Fx((f, dt) => {
    if (f.stopped) return false;
    const at = head();
    owed += rate * dt;
    for (; owed >= 1; owed--) {
      kitPools(scene).motes.emit({
        x: at.x + rand(-0.12, 0.12), y: at.y + rand(-0.1, 0.1), z: at.z + rand(-0.12, 0.12),
        vx: rand(-0.4, 0.4), vy: rand(-1.4, -0.4), vz: rand(-0.4, 0.4), drag: 1, life: rand(0.35, 0.7), size: 0.06, thick: 0.02,
        r: ICE_HOT[0], g: ICE_HOT[1], b: ICE_HOT[2], a: 0.95, r1: FROST[0] * 0.6, g1: FROST[1] * 0.7, b1: FROST[2] * 0.8,
      });
    }
    return true;
  });
}

/** A cold burst for the arrow's explode radius: shards, a cyan floor ring, a little low mist (kit defaults are a white blob). */
function coldBurst(scene: Scene, at: Vector3, radius: number, flash: number, crystals: boolean): void {
  const floor = new Vector3(at.x, 0, at.z);
  fire(scene, frostBurst(scene, floor, { radius, colour: FROST, shards: Math.round(14 + radius * 10), mist: 2, flash, crystals: false }));
  if (crystals) fire(scene, iceCrystalCluster(scene, floor, { count: 5, height: 0.8, radius: radius * 0.4, hold: 0.5 }));
  core(scene, at, radius * 0.6, ICE_HOT, FROST, 0.14);
  sparks(scene, at, 16, ICE_HOT, FROST, { speed: [3, 7], up: [0, 0.8], gravity: -6, life: [0.15, 0.35], length: 0.22 });
}

const ESCAPE_ARROW: ArrowDecor = {
  flight(scene, arrow, head) {
    clad(scene, arrow, 1);
    const fx = new Fx(() => true);
    fx.child(ribbonTrail(scene, head, { colour: FROST, life: 0.22, height: 0.18, width: 0.22, lift: -0.09, alpha: 0.55 }));
    fx.child(frostFlakes(scene, head, 22));
    return fx;
  },
  impact(scene, at) {
    coldBurst(scene, at, 1.2, 0.45, false);
  },
};

const ICE_ARROW: ArrowDecor = {
  born(scene, _arrow, at) {
    // The loose snaps frost off the string: hard ice chips and glints, no soft ball.
    throwChunks(scene, "ice", at, { count: 7, speed: [1.5, 3], up: [0.5, 2], size: [0.03, 0.07] });
    sparks(scene, at, 10, ICE_HOT, FROST, { speed: [2.5, 5], up: [-0.2, 0.5], gravity: -6, life: [0.1, 0.22], length: 0.12, thick: 0.014 });
    return null;
  },
  flight(scene, arrow, head) {
    clad(scene, arrow, 3);
    const fx = new Fx(() => true);
    // The frost trail: a wide pale ribbon that hangs a beat behind the arrow.
    // Wide and bright: the flight lasts a quarter second, so it must read at a glance.
    fx.child(ribbonTrail(scene, head, { colour: FROST, life: 0.5, height: 0.45, width: 0.75, lift: -0.2, alpha: 0.9, motes: 6 }));
    fx.child(frostFlakes(scene, head, 80));
    return fx;
  },
  impact(scene, at) {
    // The shatter is the skill: a cold flash, a standing ring of frost out to the burst radius, ice thrown.
    coldBurst(scene, at, 1.8, 0.9, true);
    const floor = new Vector3(at.x, 0, at.z);
    kitFlash(scene, floor, 0.8, FROST);
    throwChunks(scene, "ice", floor, { count: 16, speed: [2, 5], up: [2, 4.5], size: [0.05, 0.14] });
    fire(scene, shockRing(scene, floor, { radius: 1.9, duration: 0.3, colour: FROST, lip: 0.5, width: 0.4, dust: 0, flash: 0 }));
  },
};

/**
 * The shipped physical arrows (Piercing Shot, Split Arrow): a pale wake, and a hit that
 * punches through, sparks and grit thrown on along the flight. Before, a hairline landed silent.
 */
const PHYS_ARROW: ArrowDecor = {
  flight(scene, _arrow, head) {
    return ribbonTrail(scene, head, { colour: [1, 0.95, 0.85], life: 0.16, height: 0.12, width: 0.2, lift: -0.06, alpha: 0.4 });
  },
  impact(scene, at, dirX, dirZ) {
    const yaw = Math.atan2(dirX, dirZ);
    kitFlash(scene, at, 0.35);
    core(scene, at, 0.45, [1, 0.95, 0.85], [1, 0.7, 0.4], 0.08);
    sparks(scene, at, 16, [1, 0.95, 0.8], [1, 0.55, 0.2], { yaw, cone: 0.45, speed: [4, 9], up: [0.1, 0.6], life: [0.1, 0.25], length: 0.24 });
    const floor = new Vector3(at.x, 0, at.z);
    throwChunks(scene, "rock", floor, { count: 5, yaw, cone: 0.6, speed: [1.5, 3], up: [1.5, 3], size: [0.03, 0.07] });
    fire(scene, shockRing(scene, floor, { radius: 0.7, duration: 0.18, colour: [0.75, 0.68, 0.55], lip: 0.12, width: 0.3, dust: 2, flash: 0, floorFlash: false }));
  },
};

// ── Lightning Arrow ──────────────────────────────────────────────────────────────

/** A strand of live lightning: a white core tube in a feathered blue halo, sharing one jagged path. */
interface Strand { core: Mesh; halo: Mesh; path: Vector3[]; r: number }

function strand(scene: Scene, points: number, r: number): Strand {
  const path = Array.from({ length: points }, (_, i) => new Vector3(0, 0, i * 0.1));
  const tube = (name: string, radius: number, glow: Rgb, feather: boolean) => fxMesh(scene, MeshBuilder.CreateTube(name, {
    path, radius, tessellation: 4, cap: Mesh.NO_CAP, updatable: true,
  }, scene), addMat(scene, glow, feather));
  return { core: tube("stalker-arc-core", r, [0.9, 0.95, 1], false), halo: tube("stalker-arc-halo", r * 3.5, SHOCK, true), path, r };
}

function relay(scene: Scene, s: Strand): void {
  s.core = MeshBuilder.CreateTube("stalker-arc-core", { path: s.path, radius: s.r, instance: s.core }, scene);
  s.halo = MeshBuilder.CreateTube("stalker-arc-halo", { path: s.path, radius: s.r * 3.5, instance: s.halo }, scene);
}

interface LiveArcOptions {
  /** Core radius (the halo is 3.5x), kinks, sideways wander as a share of the length. */
  r: number;
  segs: number;
  amp: number;
  /** A fork off the middle. */
  branch?: boolean;
  /** Seconds between re-jags. */
  rejag?: number;
}

const sA = new Vector3(), sB = new Vector3();

/**
 * Lightning between two moving ends that holds until stopped: re-jagged several
 * times a second, laid every frame so it never comes adrift of either end. No
 * flash ball of its own (the kit bolt drops one at its far end every strike).
 */
function liveArc(scene: Scene, from: () => Vector3, to: () => Vector3, o: LiveArcOptions): Fx {
  const main = strand(scene, o.segs + 1, o.r);
  const fork = o.branch ? strand(scene, 4, o.r * 0.6) : null;
  const side = new Float32Array(o.segs + 1), up = new Float32Array(o.segs + 1);
  const forkOff = { yaw: 0, len: 0, at: 0, j: [0, 0, 0, 0] };
  const rejag = o.rejag ?? 0.035;
  let since = rejag;
  const fx = new Fx((f, dt) => {
    since += dt;
    if (since >= rejag) {
      since = 0;
      for (let i = 1; i < o.segs; i++) { side[i] = rand(-1, 1); up[i] = rand(-0.6, 0.6); }
      forkOff.yaw = rand(0.5, 1.1) * (Math.random() < 0.5 ? -1 : 1);
      forkOff.len = rand(0.25, 0.4);
      forkOff.at = 1 + Math.floor(Math.random() * (o.segs - 1));
      forkOff.j = [0, rand(-1, 1), rand(-1, 1), rand(-1, 1)];
    }
    sA.copyFrom(from());
    sB.copyFrom(to());
    const dx = sB.x - sA.x, dy = sB.y - sA.y, dz = sB.z - sA.z;
    const len = Math.hypot(dx, dy, dz) || 1e-3;
    const fl = Math.hypot(dx, dz) || 1;
    const px = -dz / fl, pz = dx / fl;
    for (let i = 0; i <= o.segs; i++) {
      const t = i / o.segs;
      const env = Math.sin(t * Math.PI) ** 0.7 * o.amp * len;
      main.path[i]!.set(sA.x + dx * t + px * side[i]! * env, sA.y + dy * t + up[i]! * env, sA.z + dz * t + pz * side[i]! * env);
    }
    relay(scene, main);
    if (fork) {
      const root = main.path[forkOff.at]!;
      const c = Math.cos(forkOff.yaw), sn = Math.sin(forkOff.yaw);
      const ux = dx / len, uz = dz / len;
      const fx2 = ux * c - uz * sn, fz2 = ux * sn + uz * c;
      for (let i = 0; i < 4; i++) {
        const t = (i / 3) * forkOff.len * len;
        const j = forkOff.j[i]! * 0.12 * forkOff.len * len;
        fork.path[i]!.set(root.x + fx2 * t + px * j, root.y - t * 0.3, root.z + fz2 * t + pz * j);
      }
      relay(scene, fork);
    }
    // Lightning strobes; it never holds steady.
    const k = f.fade * rand(0.6, 1);
    main.core.visibility = k;
    main.halo.visibility = k * 0.85;
    if (fork) {
      fork.core.visibility = k * rand(0.4, 1);
      fork.halo.visibility = fork.core.visibility * 0.8;
    }
    return true;
  }, 0.06);
  for (const s of fork ? [main, fork] : [main]) {
    fx.own({ dispose: () => s.core.dispose() });
    fx.own({ dispose: () => s.halo.dispose() });
  }
  return fx;
}

function shockShell(scene: Scene): Mesh {
  return template(scene, "stalker-shock-shell", () => fxMesh(scene, MeshBuilder.CreateSphere("stalker-shock-shell", { diameter: 1, segments: 8 }, scene), addMat(scene, SHOCK, true)));
}

/** The arrow's electric body: an arc down the shaft, two micro-arcs leaping off it, and a crackling glow round the head. */
function electricBody(scene: Scene, arrow: Mesh, head: () => Vector3): Fx {
  const fwd = new Vector3();
  const aim = () => {
    const yaw = arrow.isDisposed() ? 0 : arrow.rotation.y;
    return fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
  };
  const along = (t: number, out: Vector3) => {
    const h = head(), d = aim();
    return out.set(h.x - d.x * 1.1 * t, h.y, h.z - d.z * 1.1 * t);
  };
  const tail = new Vector3();
  const fx = new Fx(() => true, 0.06);
  fx.child(liveArc(scene, () => along(1, tail), head, { r: 0.022, segs: 7, amp: 0.09 }));
  let clock = 0;
  for (let k = 0; k < 2; k++) {
    const root = new Vector3(), tip = new Vector3();
    fx.child(liveArc(scene, () => along(0.25 + 0.45 * k, root), () => {
      // A micro-arc jumping off the shaft, its far end whirling round it.
      const d = aim();
      const th = clock * 22 + k * 3;
      along(0.15 + 0.45 * k, tip);
      return tip.set(tip.x + d.z * Math.cos(th) * 0.3, tip.y + Math.sin(th) * 0.3, tip.z - d.x * Math.cos(th) * 0.3);
    }, { r: 0.011, segs: 4, amp: 0.25, rejag: 0.03 }));
  }
  const shell = cloneOf(scene, shockShell(scene), "stalker-shock-shell");
  let owed = 0;
  fx.child(new Fx((f, dt) => {
    clock += dt;
    const h = head();
    shell.position.copyFrom(h);
    const s = 0.42 * rand(0.85, 1.15);
    shell.scaling.set(s, s, s);
    shell.visibility = f.fade * rand(0.5, 0.8);
    if (f.stopped) return true;
    owed += 50 * dt;
    for (; owed >= 1; owed--) {
      const a = Math.random() * TAU;
      kitPools(scene).shards.emit({
        x: h.x, y: h.y, z: h.z, vx: Math.sin(a) * rand(2, 4.5), vy: rand(-1, 2), vz: Math.cos(a) * rand(2, 4.5), drag: 3,
        life: rand(0.06, 0.14), size: 0.16, thick: 0.016, stretch: 0.03,
        r: SHOCK_HOT[0], g: SHOCK_HOT[1], b: SHOCK_HOT[2], a: 1, r1: SHOCK[0], g1: SHOCK[1], b1: SHOCK[2],
      });
    }
    return true;
  }, 0.06));
  fx.own(shell);
  return fx;
}

/** A struck body lit up: tinted flash, white-blue core, spark burst, ring. `big` for the first hit of a cast. */
function shockHit(scene: Scene, at: Vector3, big: boolean): void {
  kitFlash(scene, at, big ? 0.9 : 0.6, [0.6, 0.75, 1]);
  // Blue, not white: a white core this size whited out the struck body.
  core(scene, at, big ? 1.2 : 0.8, [0.7, 0.82, 1], SHOCK, big ? 0.16 : 0.12);
  sparks(scene, at, big ? 36 : 18, SHOCK_HOT, SHOCK, { speed: [3, big ? 10 : 7], up: [0, 1], life: [0.1, 0.32], length: 0.24 });
  fire(scene, shockRing(scene, new Vector3(at.x, 0, at.z), { radius: big ? 1.6 : 0.9, duration: 0.22, colour: SHOCK, lip: big ? 0.3 : 0.15, dust: 0, flash: 0 }));
}

/** An arc held `hold` seconds, then strobed out. */
function heldArc(scene: Scene, from: () => Vector3, to: () => Vector3, hold: number, o: LiveArcOptions): Fx {
  const arc = liveArc(scene, from, to, o);
  const fx = new Fx((f) => {
    if (f.age >= hold) arc.stop();
    return !arc.done;
  });
  fx.child(arc);
  return fx;
}

const LIGHTNING_ARROW: ArrowDecor = {
  born(scene, _arrow, at, head, src) {
    if (!src) {
      // The loose: a small blue crackle at the bow, where the arrow is first drawn.
      const a = at.clone(), b = new Vector3();
      sparks(scene, a, 14, SHOCK_HOT, SHOCK, { speed: [2, 5], up: [0, 0.8], life: [0.08, 0.2], length: 0.16 });
      fire(scene, heldArc(scene, () => a, () => b.set(a.x + rand(-0.35, 0.35), a.y + rand(-0.2, 0.3), a.z + rand(-0.35, 0.35)), 0.12, { r: 0.014, segs: 4, amp: 0.3, branch: true }));
      return null;
    }
    // A chain: the arc leaps off the struck body and rides the arrow until it lands.
    kitFlash(scene, src, 0.6, [0.6, 0.75, 1]);
    core(scene, src, 0.9, [0.7, 0.82, 1], SHOCK, 0.14);
    sparks(scene, src, 12, SHOCK_HOT, SHOCK, { speed: [2, 6], up: [0, 1], life: [0.1, 0.25], length: 0.2 });
    return liveArc(scene, () => src, head, { r: 0.045, segs: 9, amp: 0.12, branch: true });
  },
  flight(scene, arrow, head) {
    return electricBody(scene, arrow, head);
  },
  impact(scene, at, _dx, _dz, _born, src) {
    // The first body of a cast takes the big burst; every chain link a smaller one.
    shockHit(scene, at, src === null);
    if (src === null) {
      // The first body discharges into the floor round it: short forked arcs out, never up.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + rand(-0.4, 0.4), d = rand(1, 1.5);
        const from = at.clone(), to = new Vector3(at.x + Math.sin(a) * d, 0.05, at.z + Math.cos(a) * d);
        fire(scene, heldArc(scene, () => from, () => to, 0.15, { r: 0.022, segs: 6, amp: 0.18, branch: i % 2 === 0 }));
      }
    } else if (Math.hypot(src.x - at.x, src.z - at.z) > 0.3) {
      // The leap held a beat after it lands: thick, forked, bright at both ends.
      const a = src.clone(), b = at.clone();
      kitFlash(scene, a, 0.5, [0.6, 0.75, 1]);
      core(scene, a, 0.8, [0.7, 0.82, 1], SHOCK, 0.14);
      fire(scene, heldArc(scene, () => a, () => b, 0.3, { r: 0.05, segs: 10, amp: 0.13, branch: true, rejag: 0.04 }));
    }
  },
};

// ── Escape Shot travel ───────────────────────────────────────────────────────────

const ESCAPE_TRAVEL: TravelLook = {
  // The take is a front flip (its pelvis turns the way Roll_RM does): played backwards it is a backflip.
  clip: "jogFlip",
  playback: -1,
  face: "aim",
  arcHeight: 0.7,
  start(ctx, body) {
    const at = floorAt(body.node);
    for (let i = 0; i < 6; i++) puff(ctx.scene, at.x, 0, at.z, { size: 0.6, drift: rand(1, 2), colour: [0.75, 0.88, 0.97], alpha: 0.2 });
    fire(ctx.scene, shockRing(ctx.scene, at, { radius: 1, duration: 0.25, colour: FROST, lip: 0.15, dust: 3, flash: 0 }));
    const fx = new Fx(() => true);
    fx.child(ribbonTrail(ctx.scene, body.node, { colour: FROST, life: 0.3, height: 1.1, width: 0.5, lift: 0.25, alpha: 0.55, motes: 3 }));
    return lasting(fx);
  },
  land(ctx, body) {
    const at = floorAt(body.node);
    for (let i = 0; i < 5; i++) puff(ctx.scene, at.x, 0, at.z, { size: 0.55, drift: rand(1.2, 2.2), alpha: 0.25 });
    throwChunks(ctx.scene, "ice", at, { count: 6, speed: [1, 2.5], up: [1.5, 3], size: [0.04, 0.1] });
    return burst(shockRing(ctx.scene, at, { radius: 1.1, duration: 0.25, colour: FROST, lip: 0.12, dust: 4, flash: 0 }));
  },
};

// ── Sniper's Mark ────────────────────────────────────────────────────────────────

function sightLine(scene: Scene, length: number): Mesh {
  return template(scene, `stalker-sight-${length}`, () => {
    const g = new Geo();
    // A crisp hot hairline down the aim in a soft red sheath, brightest at the far end,
    // and a ring where it points. Additive: on the dark floor a blended red was a smear.
    const n = 12;
    const soft: [number, number, number, number][] = [];
    const hard: [number, number, number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const z = 0.6 + (i / n) * length;
      soft.push([0, z, 0.07, 0.25 + 0.45 * (i / n)]);
      hard.push([0, z, 0.016, 0.6 + 0.4 * (i / n)]);
    }
    g.strip(soft, [1, 0.25, 0.15]);
    g.strip(hard, [1, 0.8, 0.7], 0.003);
    g.lathe([
      { r: 0.3, y: 0, c: [1, 0.25, 0.15, 0] }, { r: 0.42, y: 0, c: [1, 0.75, 0.65, 1] },
      { r: 0.46, y: 0, c: [1, 0.3, 0.2, 0.8] }, { r: 0.6, y: 0, c: [1, 0.25, 0.15, 0] },
    ], 40, 0, TAU, { cz: length + 0.6 });
    return fxMesh(scene, g.mesh(scene, "stalker-sight"), addMat(scene));
  });
}

const MARK_CAST: CastLook = {
  clip: "bowAimNeutral",
  release: 0.3,
  start(ctx: LookContext, body: ActorRef, cast: CastState): FxHandle<ActorRef> {
    const line = cloneOf(ctx.scene, sightLine(ctx.scene, 12), "stalker-sight");
    const yaw = Math.atan2(cast.dirX, cast.dirY);
    const total = Math.max(0.15, cast.windup ?? 0.25);
    let age = 0;
    const place = (b: ActorRef) => {
      line.position.set(b.x, 0.04, b.z);
      line.rotation.y = yaw;
      const k = clamp01(age / total);
      line.scaling.set(1, 1, 0.35 + 0.65 * k);
      line.visibility = 0.4 + 0.6 * k;
    };
    place(body);
    return {
      update(c, b) {
        age += c.dt;
        place(b);
      },
      fade(_c, s) {
        // The line flares wide and hot as it lets go; the snap itself lands on the target (MARK_AREA).
        const k = clamp01(s / 0.18);
        line.scaling.set(1 + 2.5 * k, 1, 1);
        line.visibility = 1.4 * (1 - k);
        return s < 0.18;
      },
      dispose: () => line.dispose(),
    };
  },
};

const MARKED: StatusLook = {
  create(ctx, s) {
    const scene = ctx.scene;
    const R = Math.max(0.5, s.radius);
    const H = 1.3 + R * 0.9;
    // Large on purpose: the one enemy that takes more must be found across the screen.
    const reticle = markReticle(scene, s.body.node, { radius: R * 2.1, height: H, colour: MARK });
    const ring = cloneOf(scene, pulseRingTemplate(scene, MARK, "stalker-mark-floor", true), "stalker-mark-floor");
    // Blended keeps its red on bright sand; the additive one over it burns on a dark floor.
    const glow = cloneOf(scene, pulseRingTemplate(scene, [1, 0.35, 0.22], "stalker-mark-glow", false), "stalker-mark-glow");
    const at = floorAt(s.body.node, H);
    kitFlash(scene, at, 0.3, MARK);
    sparks(scene, at, 12, [1, 0.6, 0.5], MARK, { speed: [2, 4], up: [-0.3, 0.3], gravity: 0, life: [0.15, 0.3], length: 0.2 });
    let age = 0;
    const fx = new Fx((f, dt) => {
      age += dt;
      const p = s.body.node.getAbsolutePosition();
      const ph = (age % 1.1) / 1.1;
      // Snaps in from wide, then throbs.
      const snap = 1 + 1.5 * (1 - clamp01(age / 0.18)) ** 2;
      const r = R * 1.5 * snap * (0.92 + 0.12 * (1 - ph));
      ring.position.set(p.x, p.y + 0.03, p.z);
      ring.scaling.set(r, 1.3, r);
      ring.visibility = clamp01(age / 0.15) * f.fade * (0.7 + 0.3 * (1 - ph) ** 2);
      glow.position.copyFrom(ring.position);
      glow.scaling.copyFrom(ring.scaling);
      glow.visibility = clamp01(age / 0.15) * f.fade * (0.75 + 0.25 * (1 - ph) ** 2);
      return true;
    }, 0.3);
    fx.own(ring);
    fx.own(glow);
    fx.child(reticle);
    bindToNode(fx, s.body.node);
    return lasting(fx, (_c, st) => {
      ring.setEnabled(st.visible);
      glow.setEnabled(st.visible);
    });
  },
};

// ── Chilled ──────────────────────────────────────────────────────────────────────

function rimeTemplate(scene: Scene): Mesh {
  return template(scene, "stalker-rime", () => {
    const g = new Geo();
    const edge = ragged(0.25, 3.1);
    // A frosted floor patch: pale blue, alpha-blended so it frosts the ground instead of glowing.
    g.lathe([
      { r: 0, y: 0, c: [0.75, 0.88, 1, 0.45] },
      { r: 0.75, y: 0, c: [0.62, 0.82, 0.98, 0.35] },
      { r: 1, y: 0, c: [0.55, 0.78, 0.95, 0] },
    ], 36, 0, TAU, { jitter: (yaw, k) => (k === 0 ? 1 : edge(yaw)) });
    // Spikes of rime round the feet, leaning out, lit so the facets carry it without colour.
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + (i % 2) * 0.17;
      const r = 0.8 + (i % 3) * 0.1;
      const h = 0.22 + ((i * 7) % 5) * 0.06;
      const bx = Math.sin(a) * r, bz = Math.cos(a) * r;
      const tx = Math.sin(a) * (r + 0.2), tz = Math.cos(a) * (r + 0.2);
      const w = 0.06;
      const base: number[] = [];
      for (let k = 0; k < 3; k++) {
        const t = (k / 3) * TAU + a;
        base.push(g.vert(bx + Math.sin(t) * w, 0, bz + Math.cos(t) * w, [0.7, 0.87, 1, 0.9]));
      }
      const tip = g.vert(tx, h, tz, [0.92, 0.98, 1, 0.95]);
      for (let k = 0; k < 3; k++) g.idx.push(base[k]!, base[(k + 1) % 3]!, tip);
    }
    return fxMesh(scene, g.mesh(scene, "stalker-rime"), blendMat(scene), false);
  });
}

function tintTemplate(scene: Scene): Mesh {
  return template(scene, "stalker-chill-tint", () => {
    const m = MeshBuilder.CreateSphere("stalker-chill-tint", { diameter: 1, segments: 10 }, scene);
    // Alpha-blended pale blue, feathered: a cold cast over the body, never a lit bulb.
    return fxMesh(scene, m, blendMat(scene, [0.5, 0.72, 0.95], true), false);
  });
}

const CHILLED: StatusLook = {
  create(ctx, s) {
    const scene = ctx.scene;
    const R = Math.max(0.4, s.radius);
    const H = 1.2 + R * 0.9;
    const rime = cloneOf(scene, rimeTemplate(scene), "stalker-rime");
    const tint = cloneOf(scene, tintTemplate(scene), "stalker-chill-tint");
    let mist = 0, flakes = 0;
    const pools = kitPools(scene);
    const fx = new Fx((f, dt) => {
      const p = s.body.node.getAbsolutePosition();
      const k = clamp01(f.age / 0.25) * f.fade;
      rime.position.set(p.x, p.y + 0.02, p.z);
      rime.scaling.set(R * 1.15, R * (0.3 + 0.7 * k), R * 1.15);
      rime.visibility = k;
      tint.position.set(p.x, p.y + H * 0.5, p.z);
      tint.scaling.set(R * 2.2, H * 1.1, R * 2.2);
      tint.visibility = k * (0.2 + 0.03 * Math.sin(f.age * 3));
      // Slow cold mist pooling at the feet, and a few ice motes drifting down.
      mist += dt * 1.6 * k;
      for (; mist >= 1; mist--) {
        const a = Math.random() * TAU;
        pools.smoke.emit({
          x: p.x + Math.sin(a) * R, y: p.y + 0.08, z: p.z + Math.cos(a) * R,
          vx: Math.sin(a) * 0.2, vy: 0.03, vz: Math.cos(a) * 0.2, drag: 1, life: rand(1.2, 1.8), size: 0.3, sizeEnd: 0.7,
          r: 0.68, g: 0.82, b: 0.96, a: 0.14, r1: 0.55, g1: 0.72, b1: 0.9,
        });
      }
      flakes += dt * 3 * k;
      for (; flakes >= 1; flakes--) {
        const a = Math.random() * TAU;
        pools.motes.emit({
          x: p.x + Math.sin(a) * R * rand(0.3, 1), y: p.y + H * rand(0.5, 1), z: p.z + Math.cos(a) * R * rand(0.3, 1),
          vx: 0, vy: rand(-0.4, -0.2), vz: 0, life: rand(0.8, 1.2), size: 0.045, thick: 0.018,
          r: 0.85, g: 0.95, b: 1, a: 0.8, r1: 0.5, g1: 0.75, b1: 0.95,
        });
      }
      return true;
    }, 0.3);
    fx.own(rime);
    fx.own(tint);
    bindToNode(fx, s.body.node);
    return lasting(fx, (_c, st) => {
      rime.setEnabled(st.visible);
      tint.setEnabled(st.visible);
    });
  },
};

// ── Rain of Arrows ───────────────────────────────────────────────────────────────

const VOLLEY_ARROWS = 9;
/** Twice nocked size: at the game camera a true-size arrow falling is a hair. */
const VOLLEY_ARROW_SCALE = 2;
const volleyArrow = (scene: Scene): TransformNode => {
  const a = buildArrow(scene, "stalker-volley-arrow");
  a.scaling.setAll(VOLLEY_ARROW_SCALE);
  return a;
};
const VOLLEY_WAKE: Rgb = [1, 0.92, 0.7];

const RAIN_CAST: CastLook = {
  clip: "bowAimUp",
  release: 0.5,
  start(ctx, body, cast) {
    const scene = ctx.scene;
    // Early: the cast handle is retired on the tick the sim releases.
    const when = Math.max(0.05, (cast.windup ?? 0.5) - 0.1);
    let last = body;
    let age = 0;
    let loosed = false;
    const loose = (b: ActorRef) => {
      loosed = true;
      const hand = new Vector3(b.x + cast.dirX * 0.3, 1.7, b.z + cast.dirY * 0.3);
      kitFlash(scene, hand, 0.45);
      sparks(scene, hand, 18, [1, 0.95, 0.8], VOLLEY, { speed: [2, 5], up: [1, 3], gravity: -4, life: [0.15, 0.35], length: 0.2 });
      // The volley leaves the bow almost straight up, fanned, into the sky over the target.
      for (let i = 0; i < VOLLEY_ARROWS; i++) {
        const to = new Vector3(hand.x + cast.dirX * rand(1.5, 3) + rand(-1.2, 1.2), 14, hand.z + cast.dirY * rand(1.5, 3) + rand(-1.2, 1.2));
        fire(scene, skyFall(scene, hand.clone(), to, {
          speed: 24, delay: i * 0.025, body: volleyArrow, wake: VOLLEY_WAKE, wakeLength: 3, wakeWidth: 0.13, motes: 3, stick: 0,
        }));
      }
    };
    return {
      update(c, b) {
        age += c.dt;
        last = b;
        if (!loosed && age >= when) loose(b);
      },
      // Retired before the frame that would have loosed it: loose it now, never skip the volley.
      fade() {
        if (!loosed) loose(last);
        return false;
      },
      dispose() {},
    };
  },
};

/** The landing shimmer: a gold disc and rim on the floor, tightening as the arrow comes in. */
function warnTemplate(scene: Scene): Mesh {
  return template(scene, "stalker-volley-warn", () => {
    const g = new Geo();
    g.lathe([
      { r: 0, y: 0, c: rgba(VOLLEY, 0.18) },
      { r: 0.8, y: 0, c: rgba(VOLLEY, 0.22) },
      { r: 0.9, y: 0, c: rgba(VOLLEY, 0.9) },
      { r: 1, y: 0, c: rgba(VOLLEY, 0) },
    ], 40);
    // A cross-hair notch at the centre: where the shaft will stand.
    g.strip([[-0.25, 0, 0.02, 0.8], [0.25, 0, 0.02, 0.8]], VOLLEY, 0.002);
    g.strip([[0, -0.25, 0.02, 0.8], [0, 0.25, 0.02, 0.8]], VOLLEY, 0.002);
    return fxMesh(scene, g.mesh(scene, "stalker-volley-warn"), blendMat(scene));
  });
}

/** Area ids whose arrow is already falling, so a landing without one is still dressed. */
const falling = new WeakMap<Scene, Set<number>>();
const FALL_SPEED = 30;
const FALL_HEIGHT = 10;

const RAIN_AREA: AreaLook = {
  warn(ctx, a) {
    const scene = ctx.scene;
    const m = cloneOf(scene, warnTemplate(scene), "stalker-volley-warn");
    const total = Math.max(0.05, a.impactIn);
    const flight = FALL_HEIGHT / FALL_SPEED;
    const to = new Vector3(a.x, 0.05, a.y);
    const drop = Math.min(flight, a.impactIn) * FALL_SPEED;
    const from = to.add(new Vector3(rand(-0.25, 0.25) * drop, drop, rand(-0.25, 0.25) * drop));
    fire(scene, skyFall(scene, from, to, {
      speed: FALL_SPEED, delay: Math.max(0, a.impactIn - flight), body: volleyArrow, wake: VOLLEY_WAKE, wakeLength: 3.5, wakeWidth: 0.14, motes: 3, stick: 0.9,
    }));
    let set = falling.get(scene);
    if (!set) { set = new Set(); falling.set(scene, set); }
    set.add(a.id);
    let age = 0;
    const place = (s: AreaState) => {
      const k = 1 - clamp01(s.impactIn / total);
      const r = s.radius * (1.25 - 0.3 * k);
      m.position.set(s.x, 0.035, s.y);
      m.scaling.set(r, 1, r);
      m.rotation.y = age * 2;
      // A fast shimmer that brightens as the arrow nears.
      m.visibility = (0.45 + 0.55 * k) * (0.75 + 0.25 * Math.sin(age * 40));
    };
    place(a);
    return {
      update(c, s) {
        age += c.dt;
        place(s);
      },
      dispose: () => m.dispose(),
    };
  },
  impact(ctx, a) {
    const scene = ctx.scene;
    const at = new Vector3(a.x, 0, a.y);
    const set = falling.get(scene);
    if (set && !set.delete(a.id)) {
      // Seen only once landed: a short drop so it still arrives as an arrow.
      fire(scene, skyFall(scene, at.add(new Vector3(0, 2.5, 0)), at.clone(), { speed: FALL_SPEED, body: volleyArrow, wake: VOLLEY_WAKE, wakeLength: 1.5, wakeWidth: 0.14, stick: 0.9 }));
    }
    const first = a.index === 0;
    kitFlash(scene, at, first ? 0.6 : 0.25);
    // The shaft punching into the floor: stone chips and grit thrown up, a few dry sparks, a low dust kick.
    throwChunks(scene, "rock", at, { count: first ? 14 : 8, speed: [1.2, 3.2], up: [2.5, 5], size: [0.035, first ? 0.13 : 0.1] });
    sparks(scene, new Vector3(a.x, 0.1, a.y), first ? 8 : 4, [1, 0.92, 0.75], [0.6, 0.45, 0.3], { speed: [2, 4.5], up: [0.4, 1.4], life: [0.1, 0.22], length: 0.1 });
    for (let i = 0; i < (first ? 3 : 1); i++) puff(scene, a.x, 0, a.y, { size: 0.45, drift: rand(0.8, 1.6), alpha: 0.25 });
    return burst(shockRing(scene, at, {
      radius: first ? 0.9 : 0.55, duration: 0.2, colour: [0.55, 0.47, 0.35], width: 0.25, lip: 0, dust: 0, flash: 0, floorFlash: false,
    }));
  },
};

// ── Haste ────────────────────────────────────────────────────────────────────────

const HASTE_BUFF: BuffLook = {
  create(ctx, s) {
    const scene = ctx.scene;
    const node = s.body.node;
    const fx = new Fx(() => true, 0.4);
    fx.child(auraSigil(scene, node, { radius: 1.35, colour: HASTE, runes: 10, motes: 3, spin: 0.9 }));
    // The take-hold swirl, once.
    fx.child(buffSwirl(scene, node, { radius: 0.75, height: 2, colour: HASTE, rate: 30, spin: 9, duration: 0.7 }));
    // Motion trails at his feet: a ribbon only lays samples while he moves, so standing it runs out.
    fx.child(ribbonTrail(scene, node, { colour: HASTE, life: 0.28, height: 0.35, width: 0.4, lift: 0.04, alpha: 0.5 }));
    const last = node.getAbsolutePosition().clone();
    let gust = 0;
    const pools = kitPools(scene);
    fx.child(new Fx((f, dt) => {
      if (f.stopped || dt <= 0) return !f.stopped;
      const p = node.getAbsolutePosition();
      const vx = (p.x - last.x) / dt, vz = (p.z - last.z) / dt;
      last.copyFrom(p);
      const speed = Math.hypot(vx, vz);
      // Wind: a few streaks curling round him idle, a stream of them blown back off him on the move.
      gust += dt * (speed > 0.8 ? 26 : 5);
      for (; gust >= 1; gust--) {
        const a = Math.random() * TAU;
        const r = rand(0.5, 0.9);
        const moving = speed > 0.8;
        const tx = Math.cos(a) * 2.5, tz = -Math.sin(a) * 2.5;
        pools.motes.emit({
          x: p.x + Math.sin(a) * r, y: p.y + rand(0.2, 1.6), z: p.z + Math.cos(a) * r,
          vx: moving ? -vx * 0.6 + rand(-0.3, 0.3) : tx, vy: rand(0, 0.3), vz: moving ? -vz * 0.6 + rand(-0.3, 0.3) : tz,
          drag: 2, life: rand(0.2, 0.4), size: moving ? 0.35 : 0.22, thick: 0.012, stretch: 0.06,
          r: 0.8, g: 1, b: 0.95, a: 0.7, r1: HASTE[0] * 0.6, g1: HASTE[1] * 0.6, b1: HASTE[2] * 0.6,
        });
      }
      return true;
    }));
    const at = floorAt(node);
    fire(scene, shockRing(scene, at, { radius: 2.2, duration: 0.35, colour: HASTE, lip: 0.3, dust: 6, flash: 0.25 }));
    return lasting(fx);
  },
};

const HASTE_CAST: CastLook = { clip: "surprise", release: 0.15, playback: 1.4 };

// ── Bow casts ───────────────────────────────────────────────────────────────────

function bowCast(clip: CastLook["clip"], release?: number, playback?: number): CastLook {
  return {
    clip,
    ...(release !== undefined ? { release } : {}),
    ...(playback !== undefined ? { playback } : {}),
  };
}

/** A hot reticle on the floor: a ring and four inward ticks, additive so it burns on a dark floor. */
function snapTemplate(scene: Scene): Mesh {
  return template(scene, "stalker-mark-snap", () => {
    const g = new Geo();
    g.lathe([
      { r: 0.86, y: 0, c: [1, 0.25, 0.15, 0] }, { r: 0.93, y: 0, c: [1, 0.8, 0.7, 1] },
      { r: 0.96, y: 0, c: [1, 0.35, 0.22, 0.9] }, { r: 1.04, y: 0, c: [1, 0.25, 0.15, 0] },
    ], 56);
    for (let q = 0; q < 4; q++) {
      const a = (q / 4) * TAU;
      g.strip([[Math.sin(a) * 1.15, Math.cos(a) * 1.15, 0.035, 1], [Math.sin(a) * 0.6, Math.cos(a) * 0.6, 0.012, 1]], [1, 0.7, 0.6], 0.002);
    }
    return fxMesh(scene, g.mesh(scene, "stalker-mark-snap"), addMat(scene));
  });
}

/** Where the mark was aimed (the sim's marker area): a reticle slamming shut on it with a red flash. */
const MARK_AREA: AreaLook = {
  impact(ctx, a) {
    const scene = ctx.scene;
    const at = new Vector3(a.x, 0.05, a.y);
    kitFlash(scene, at, 0.45, MARK);
    sparks(scene, new Vector3(a.x, 0.3, a.y), 14, [1, 0.75, 0.65], MARK, { speed: [3, 6], up: [0, 0.4], gravity: 0, life: [0.1, 0.2], length: 0.22 });
    const snap = cloneOf(scene, snapTemplate(scene), "stalker-mark-snap");
    const R = Math.max(0.8, a.radius);
    const fx = new Fx((f) => {
      // Closes from wide to tight in 0.12 s, holds a beat white-hot, then goes.
      const close = clamp01(f.age / 0.12);
      const r = R * (2.2 - 1.6 * (1 - (1 - close) ** 3));
      snap.position.copyFrom(at);
      snap.scaling.set(r, 1, r);
      snap.rotation.y = (1 - close) * 0.8;
      snap.visibility = f.age < 0.25 ? 1.2 : clamp01(1 - (f.age - 0.25) / 0.2);
      return f.age < 0.45;
    });
    fx.own(snap);
    fx.child(shockRing(scene, at, { radius: R * 0.8, duration: 0.2, colour: MARK, lip: 0.1, dust: 0, flash: 0 }));
    return burst(fx);
  },
};

export const STALKER_LOOKS: ClassSkillLooks = {
  skills: {
    // The level-1 and level-8 arrows keep their shipped profile and cast; only the hit is dressed.
    "skill.piercing_shot.v1": { projectileFx: SKILL_FX["skill.piercing_shot.v1"]!, projectile: arrowLook(PHYS_ARROW) },
    "skill.split_arrow.v1": { projectileFx: SKILL_FX["skill.split_arrow.v1"]!, projectile: arrowLook(PHYS_ARROW) },
    "skill.escape_shot.v1": {
      // A hurried snap: the rapid-loose loop, sped to one cycle across the short wind-up.
      cast: bowCast("bowRapid", undefined, 1.8),
      travel: ESCAPE_TRAVEL,
      projectileFx: ESCAPE_FX,
      projectile: arrowLook(ESCAPE_ARROW),
    },
    "skill.ice_shot.v1": {
      // Bow_Notch draws 0..1.2 s of 2.5 then holds: 0.4 lands the loose at full draw inside the 3x pace cap.
      cast: bowCast("bowNotch", 0.4),
      projectileFx: ICE_FX,
      projectile: arrowLook(ICE_ARROW),
    },
    // Every bow skill draws an arrow should it ever fly one (skill-fx.test.ts).
    "skill.snipers_mark.v1": { cast: MARK_CAST, projectileFx: ARROW, area: MARK_AREA },
    "skill.lightning_arrow.v1": {
      cast: bowCast("bow"),
      projectileFx: LIGHTNING_FX,
      projectile: arrowLook(LIGHTNING_ARROW),
    },
    "skill.rain_of_arrows.v1": {
      cast: RAIN_CAST,
      projectileFx: { ...ARROW, wake: new Color3(1, 0.86, 0.55) },
      area: RAIN_AREA,
    },
    "skill.haste.v1": { cast: HASTE_CAST },
  },
  buffs: {
    haste: HASTE_BUFF,
  },
  statuses: {
    chilled: CHILLED,
    marked: MARKED,
  },
};
