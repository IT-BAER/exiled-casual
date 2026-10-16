import { Color4, ParticleSystem, Texture, Vector3, type Scene } from "@babylonjs/core";

/**
 * What an ailment on the player looks like on his body: one particle system per active
 * kind, following him. Driven by the snapshot's debuffs (protocol-bridge), keyed by id,
 * so a new ailment is an entry in LOOKS and nothing else.
 *
 * Kept quiet on purpose: the buff bar names the ailment, this only has to make the body
 * agree with it. Burning is a few embers, not a torch; blood is dark and normally
 * blended, because additive red is light and reads as fire.
 */

export type AilmentKind = "burning" | "poison" | "bleeding";

/** The part of a snapshot buff this reads. */
export interface AilmentBuff { id: string; kind: "buff" | "debuff"; remainingSec: number; stacks?: number }

export const AILMENT_FX_NAME: Record<AilmentKind, string> = {
  burning: "fx-ailment-burning",
  poison: "fx-ailment-poison",
  bleeding: "fx-ailment-bleeding",
};

/** Soft round blob (skill-fx WISP): additive glow. */
const BLOB = "/textures/fx/haze.webp";
/** The same blob as alpha on white (skill-fx SMOKE_PUFF): normally blended matter. */
const PUFF = "/textures/fx/smoke_puff.webp";

/** Body height the emitters are built around: knees to shoulders. */
const BODY_BASE = 0.35;
const BODY_SPAN = 1.15;

interface Look {
  texture: string;
  blend: number;
  colors: readonly [number, Color4][];
  size: readonly [number, number];
  life: readonly [number, number];
  /** Particles per second at one stack. */
  rate: number;
  /** Extra share of `rate` per stack past the first (burning is the one that stacks). */
  perStack: number;
  radius: number;
  power: readonly [number, number];
  gravity: number;
}

const LOOKS: Record<AilmentKind, Look> = {
  burning: {
    texture: BLOB, blend: ParticleSystem.BLENDMODE_ADD,
    colors: [[0, new Color4(1, 0.55, 0.15, 0)], [0.15, new Color4(1, 0.6, 0.2, 0.9)], [1, new Color4(0.8, 0.2, 0.05, 0)]],
    size: [0.05, 0.11], life: [0.6, 1.1], rate: 9, perStack: 0.4, radius: 0.3, power: [0.2, 0.6], gravity: 0.9,
  },
  poison: {
    texture: BLOB, blend: ParticleSystem.BLENDMODE_ADD,
    colors: [[0, new Color4(0.35, 0.9, 0.2, 0)], [0.25, new Color4(0.4, 0.95, 0.25, 0.55)], [1, new Color4(0.15, 0.45, 0.1, 0)]],
    size: [0.08, 0.16], life: [0.9, 1.5], rate: 8, perStack: 0, radius: 0.32, power: [0.05, 0.25], gravity: 0.35,
  },
  bleeding: {
    texture: PUFF, blend: ParticleSystem.BLENDMODE_STANDARD,
    colors: [[0, new Color4(0.45, 0.02, 0.02, 0.95)], [0.8, new Color4(0.35, 0.01, 0.01, 0.9)], [1, new Color4(0.25, 0, 0, 0)]],
    size: [0.04, 0.08], life: [0.35, 0.6], rate: 7, perStack: 0, radius: 0.22, power: [0.1, 0.4], gravity: -9,
  },
};

const KINDS = Object.keys(LOOKS) as AilmentKind[];

function build(scene: Scene, kind: AilmentKind, at: Vector3): ParticleSystem {
  const look = LOOKS[kind];
  const ps = new ParticleSystem(AILMENT_FX_NAME[kind], 64, scene);
  ps.particleTexture = new Texture(look.texture, scene);
  ps.blendMode = look.blend;
  ps.applyFog = true;
  for (const [t, c] of look.colors) ps.addColorGradient(t, c);
  ps.minSize = look.size[0];
  ps.maxSize = look.size[1];
  ps.minLifeTime = look.life[0];
  ps.maxLifeTime = look.life[1];
  ps.minEmitPower = look.power[0];
  ps.maxEmitPower = look.power[1];
  ps.gravity = new Vector3(0, look.gravity, 0);
  ps.emitter = at;
  // Centred on the body, so the cylinder reaches from the knees to the shoulders.
  ps.createDirectedCylinderEmitter(look.radius, BODY_SPAN, 0, new Vector3(-0.2, 1, -0.2), new Vector3(0.2, 1, 0.2));
  ps.disposeOnStop = true;
  ps.start();
  return ps;
}

export class PlayerAilmentFx {
  private readonly live = new Map<AilmentKind, { ps: ParticleSystem; at: Vector3 }>();

  constructor(private readonly scene: Scene) {}

  /** Once per frame, with the player's drawn position in sim units. */
  update(buffs: readonly AilmentBuff[] | undefined, x: number, y: number): void {
    for (const kind of KINDS) {
      const b = buffs?.find((d) => d.kind === "debuff" && d.id === kind);
      let fx = this.live.get(kind);
      if (!b) {
        // Stop, not dispose: what is already in the air finishes its life.
        if (fx) { fx.ps.stop(); this.live.delete(kind); }
        continue;
      }
      if (!fx) {
        const at = new Vector3(x, BODY_BASE + BODY_SPAN / 2, y);
        fx = { ps: build(this.scene, kind, at), at };
        this.live.set(kind, fx);
      }
      fx.at.x = x;
      fx.at.z = y;
      const look = LOOKS[kind];
      fx.ps.emitRate = look.rate * (1 + look.perStack * (Math.max(1, b.stacks ?? 1) - 1));
    }
  }

  dispose(): void {
    for (const { ps } of this.live.values()) ps.dispose();
    this.live.clear();
  }
}
