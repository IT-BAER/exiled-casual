import { bloodDrip, emberSmoulder, frostCreep, frostCrust, poisonSeep, shockCrackle, type Fx, type MeterFx, type Rgb } from "./kit";
import type { AttachedState, ClassSkillLooks, FxHandle, StatusLook } from "./types";

/**
 * What an ailment looks like on a monster, whichever class laid it: frozen and the
 * freeze meter filling, shocked, burning, poisoned, bleeding. PoE shows each on the
 * body itself (an ice shell, a crackle, flames, green seep, blood), never as an icon.
 */

const FIRE: Rgb = [1, 0.45, 0.1];
const heightOf = (radius: number, boss: boolean): number => Math.max(1.1, radius * 3.2) * (boss ? 1.15 : 1);

/** A lasting kit effect as a status handle: paused while its body sleeps off screen, faded on `stop()`. */
function attached(fx: Fx, meter?: MeterFx): FxHandle<AttachedState> {
  let stopped = false;
  return {
    update(ctx, s) {
      if (meter) meter.amount = s.amount ?? 0;
      if (s.visible) fx.update(ctx.dt);
    },
    fade(ctx) {
      if (!stopped) {
        stopped = true;
        fx.stop();
      }
      fx.update(ctx.dt);
      return !fx.done;
    },
    dispose: () => fx.dispose(),
  };
}

const onBody = (make: (scene: Parameters<typeof frostCrust>[0], node: Parameters<typeof frostCrust>[1], o: { radius: number; height: number }) => Fx): StatusLook => ({
  create: (ctx, s) => attached(make(ctx.scene, s.body.node, { radius: s.radius, height: heightOf(s.radius, s.boss) })),
});

export const AILMENT_LOOKS: ClassSkillLooks = {
  skills: {},
  buffs: {},
  statuses: {
    frozen: onBody(frostCrust),
    freezing: {
      create(ctx, s) {
        const fx = frostCreep(ctx.scene, s.body.node, { radius: s.radius, height: heightOf(s.radius, s.boss) });
        fx.amount = s.amount ?? 0;
        return attached(fx, fx);
      },
    },
    shocked: onBody(shockCrackle),
    burning: onBody((scene, node, o) => emberSmoulder(scene, node, { ...o, colour: FIRE })),
    poison: onBody(poisonSeep),
    bleeding: onBody(bloodDrip),
  },
};
