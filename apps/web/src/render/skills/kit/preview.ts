import { TransformNode, Vector3 } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import { frameDt, Fx, rand, TAU, type FxHandle, type LastingFx } from "./core";
import { coneWave, fissure, groundBurst, landingImpact, scorch, shockRing } from "./ground";
import { meteor, skyFall } from "./sky";
import { chainArc, lightningBolt } from "./lightning";
import { frostBurst, iceCrystalCluster } from "./frost";
import { fireNova, flameTrailPatch } from "./fire";
import { dashStreak, leapArcTrail } from "./motion";
import { sunOrb } from "./sun-orb";
import { auraSigil, bloodMist, buffSwirl, warcryBlast } from "./buffs";
import { curseSigil, emberSmoulder, frostCrust, markReticle, stunOrbit, tauntRage } from "./status";
import { puff } from "./emit";

/**
 * The kit on the asset viewer's stage: `?viewer&clip=kit:<name>` fires one
 * primitive in front of the subject and repeats it. Statuses ride the subject
 * itself (pick a creature to see them on a monster); movers are preview-owned
 * nodes swept along a path so trails have something to follow.
 */

export interface KitStage {
  /** The subject's feet, and the way it faces. */
  anchor: Vector3;
  facing: Vector3;
  /** What statuses attach to; a stand-in node is made when there is none. */
  subject: TransformNode | null;
  radius: number;
  height: number;
}

export interface KitPreview {
  name: string;
  label: string;
  /** Seconds between repeats; a lasting effect is stopped and restarted on it. */
  period: number;
  run(scene: Scene, stage: KitStage): FxHandle;
}

const ahead = (s: KitStage, d: number, up = 0) => s.anchor.add(s.facing.scale(d)).addInPlaceFromFloats(0, up, 0);

/** A node swept along `path(t)` for `seconds`, then held; owned by the returned effect. */
function mover(scene: Scene, path: (t: number) => Vector3, seconds: number, body: (fx: Fx, node: TransformNode) => void, hold = 0.8): Fx {
  const node = new TransformNode("kit-preview-mover", scene);
  node.position.copyFrom(path(0));
  const fx = new Fx((f) => {
    node.position.copyFrom(path(Math.min(1, f.age / seconds)));
    return f.age < seconds + hold;
  });
  fx.own(node);
  body(fx, node);
  return fx;
}

/** A status needs a body: the subject, or a stand-in where a monster would stand. */
function onSubject(scene: Scene, s: KitStage, make: (node: TransformNode) => Fx): FxHandle {
  if (s.subject) return make(s.subject);
  const stand = new TransformNode("kit-preview-stand-in", scene);
  stand.position.copyFrom(ahead(s, 2.5));
  const fx = make(stand);
  fx.onDispose(() => stand.dispose());
  return fx;
}

/** Timed spawns inside one effect: `at` seconds after start, `spawn` makes a child. */
function sequence(steps: readonly [number, () => FxHandle][], tail = 0): Fx {
  let next = 0;
  const fx = new Fx((f) => {
    while (next < steps.length && f.age >= steps[next]![0]) fx.child(steps[next++]![1]());
    return next < steps.length || f.age < steps[steps.length - 1]![0] + tail;
  });
  return fx;
}

export const KIT_PREVIEWS: readonly KitPreview[] = [
  { name: "shockRing", label: "Shock ring", period: 1.6, run: (sc, s) => shockRing(sc, ahead(s, 2)) },
  { name: "coneWave", label: "Cone wave", period: 2.2, run: (sc, s) => coneWave(sc, ahead(s, 0.6), s.facing.x, s.facing.z) },
  { name: "groundBurst", label: "Ground burst", period: 2.6, run: (sc, s) => groundBurst(sc, ahead(s, 3)) },
  { name: "fissure", label: "Fissure", period: 3, run: (sc, s) => fissure(sc, ahead(s, 3)) },
  { name: "scorch", label: "Scorch", period: 4, run: (sc, s) => scorch(sc, ahead(s, 3), { glow: [1, 0.45, 0.1] }) },
  { name: "landingImpact", label: "Landing impact", period: 2.2, run: (sc, s) => landingImpact(sc, ahead(s, 2.5)) },
  {
    name: "skyFall", label: "Arrow volley (sky fall)", period: 2.4,
    run: (sc, s) => {
      const centre = ahead(s, 4);
      const steps: [number, () => FxHandle][] = [];
      for (let i = 0; i < 9; i++) {
        const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * 1.6;
        const to = centre.add(new Vector3(Math.sin(a) * d, 0, Math.cos(a) * d));
        const from = to.add(new Vector3(-s.facing.x * 3 + rand(-0.4, 0.4), 11, -s.facing.z * 3 + rand(-0.4, 0.4)));
        steps.push([i * 0.05, () => skyFall(sc, from, to, { onLand: (p) => puff(sc, p.x, p.y, p.z, { size: 0.5, drift: 0.6 }) })]);
      }
      return sequence(steps, 1);
    },
  },
  { name: "meteor", label: "Meteor", period: 3.2, run: (sc, s) => meteor(sc, ahead(s, 4)) },
  { name: "lightningBolt", label: "Lightning bolt", period: 1.2, run: (sc, s) => lightningBolt(sc, ahead(s, 0.4, 1.4), ahead(s, 6, 0.9)) },
  {
    name: "chainArc", label: "Chain lightning", period: 1.6,
    run: (sc, s) => {
      // Hop from the hand to three points fanned out ahead.
      const pts = [ahead(s, 0.4, 1.4), ahead(s, 3, 1), ahead(s, 4.5, 1).add(new Vector3(s.facing.z * 2, 0, -s.facing.x * 2)), ahead(s, 6.5, 1)];
      return sequence(pts.slice(1).map((p, i) => [i * 0.09, () => chainArc(sc, pts[i]!, p)] as [number, () => FxHandle]), 0.3);
    },
  },
  { name: "frostBurst", label: "Frost burst", period: 2.4, run: (sc, s) => frostBurst(sc, ahead(s, 3), { crystals: true }) },
  { name: "iceCrystalCluster", label: "Ice crystals", period: 2.2, run: (sc, s) => iceCrystalCluster(sc, ahead(s, 3)) },
  { name: "fireNova", label: "Fire nova", period: 2, run: (sc, s) => fireNova(sc, s.anchor.clone()) },
  {
    name: "flameTrailPatch", label: "Flame trail", period: 3,
    run: (sc, s) => sequence(Array.from({ length: 7 }, (_, i) => [i * 0.04, () => flameTrailPatch(sc, ahead(s, 0.8 + i * 0.8))] as [number, () => FxHandle]), 2.6),
  },
  {
    name: "dashStreak", label: "Dash streak", period: 1.6,
    run: (sc, s) => mover(sc, (t) => ahead(s, -2 + 8 * t), 0.25, (fx, node) => {
      const trail = fx.child(dashStreak(sc, node));
      fx.child(new Fx((f) => {
        if (f.age > 0.25) trail.stop();
        return f.age < 0.3;
      }));
    }),
  },
  {
    name: "leapArcTrail", label: "Leap", period: 2.2,
    run: (sc, s) => mover(sc, (t) => ahead(s, 6 * t, 2.6 * 4 * t * (1 - t)), 0.55, (fx, node) => {
      const trail = fx.child(leapArcTrail(sc, node));
      let landed = false;
      fx.child(new Fx((f) => {
        if (!landed && f.age >= 0.55) {
          landed = true;
          trail.stop();
          fx.child(landingImpact(sc, ahead(s, 6)));
        }
        return !landed;
      }));
    }),
  },
  {
    name: "sunOrb", label: "Sun orb", period: 5,
    run: (sc, s) => {
      const orb = sunOrb(sc, ahead(s, 1.2));
      let next = 1;
      const fx = new Fx((f) => {
        if (f.age >= next) {
          next += 1.3;
          orb.pulse();
        }
        if (f.age >= 4.4) orb.stop();
        return !orb.done;
      });
      fx.child(orb);
      return fx;
    },
  },
  { name: "warcryBlast", label: "Warcry (ring)", period: 1.8, run: (sc, s) => warcryBlast(sc, s.anchor.clone()) },
  {
    name: "warcryCone", label: "Warcry (cone)", period: 1.8,
    run: (sc, s) => warcryBlast(sc, s.anchor.clone(), { yaw: Math.atan2(s.facing.x, s.facing.z), half: 0.6, radius: 6 }),
  },
  { name: "auraSigil", label: "Aura sigil", period: 5, run: (sc, s) => auraSigil(sc, s.anchor.clone()) },
  { name: "buffSwirl", label: "Buff swirl", period: 2.2, run: (sc, s) => buffSwirl(sc, s.anchor.clone(), { duration: 1.4 }) },
  { name: "bloodMist", label: "Blood mist", period: 5, run: (sc, s) => bloodMist(sc, s.anchor.clone()) },
  { name: "frostCrust", label: "Status: frozen", period: 4, run: (sc, s) => onSubject(sc, s, (n) => frostCrust(sc, n, { radius: s.radius, height: s.height })) },
  { name: "emberSmoulder", label: "Status: smoulder", period: 4, run: (sc, s) => onSubject(sc, s, (n) => emberSmoulder(sc, n, { radius: s.radius, height: s.height })) },
  { name: "stunOrbit", label: "Status: stunned", period: 4, run: (sc, s) => onSubject(sc, s, (n) => stunOrbit(sc, n, { radius: s.radius, height: s.height })) },
  { name: "markReticle", label: "Status: marked", period: 4, run: (sc, s) => onSubject(sc, s, (n) => markReticle(sc, n, { radius: s.radius, height: s.height })) },
  { name: "tauntRage", label: "Status: taunted", period: 4, run: (sc, s) => onSubject(sc, s, (n) => tauntRage(sc, n, { radius: s.radius, height: s.height })) },
  { name: "curseSigil", label: "Status: cursed", period: 4, run: (sc, s) => onSubject(sc, s, (n) => curseSigil(sc, n, { radius: s.radius, height: s.height })) },
];

/** Fire `name` on the stage and keep repeating it until disposed; null for an unknown name. */
export function startKitPreview(scene: Scene, name: string, stage: KitStage): { dispose(): void } | null {
  const p = KIT_PREVIEWS.find((x) => x.name === name);
  if (!p) return null;
  const live: FxHandle[] = [];
  let current: FxHandle | null = null;
  let clock = p.period;
  const obs = scene.onBeforeRenderObservable.add(() => {
    const dt = frameDt(scene);
    clock += dt;
    if (clock >= p.period) {
      clock = 0;
      (current as Partial<LastingFx> | null)?.stop?.();
      current = p.run(scene, stage);
      live.push(current);
    }
    for (const h of live) h.update(dt);
    for (let i = live.length - 1; i >= 0; i--) {
      if (live[i]!.done) {
        live[i]!.dispose();
        live.splice(i, 1);
      }
    }
  });
  return {
    dispose() {
      scene.onBeforeRenderObservable.remove(obs);
      for (const h of live.splice(0)) h.dispose();
    },
  };
}
