import type { Snapshot } from "@exiled/protocol";
import { playSfx } from "./sfx";

/**
 * Varkis talking: a greeting on the first approach of a hideout visit, a line when
 * his window opens and another when it closes.
 *
 * One line at a time, so a new one is dropped (not queued) while the last still
 * sounds: a man talking over himself is two men. The window is React state, not
 * world state, so it is told here directly; the approach is read off the snapshot.
 */

const GROUP = { greet: 4, shop: 4, bye: 3 } as const;
type Group = keyof typeof GROUP;

const lines = (g: Group): string[] =>
  Array.from({ length: GROUP[g] }, (_, i) => `npc-varkis-${g}-${i + 1}`);

/** Every cue he can say, for the hideout to preload. */
export const VARKIS_SFX: readonly string[] = (Object.keys(GROUP) as Group[]).flatMap(lines);

/** Inside this many units of him counts as walking up to him; the hideout spawn is 5.4 away. */
const GREET_RADIUS = 3.5;

export interface VarkisVoice {
  observe(snap: Snapshot): void;
  /** His window's open state, every time it may have changed; only edges speak. */
  window(open: boolean): void;
}

interface Options {
  /** Plays a cue and says how many seconds it sounds (0 when nothing started). */
  play?: (name: string) => number;
  /** Seconds, monotonic. */
  now?: () => number;
}

export function createVarkisVoice(opts: Options = {}): VarkisVoice {
  const play = opts.play ?? ((name: string) => playSfx(name));
  const now = opts.now ?? (() => performance.now() / 1000);
  let busyUntil = -Infinity;
  /** True until he has greeted this hideout visit. */
  let armed = true;
  let open = false;
  const last = new Map<Group, string>();

  const say = (g: Group): void => {
    const t = now();
    if (t < busyUntil) return;
    const pool = lines(g).filter((l) => l !== last.get(g));
    const line = pool[Math.floor(Math.random() * pool.length)]!;
    last.set(g, line);
    busyUntil = t + play(line);
  };

  return {
    observe(snap) {
      if (snap.area !== "hideout") { armed = true; return; }
      if (!armed) return;
      const him = snap.entities.find((e) => e.kind === "vendor");
      if (!him || Math.hypot(him.x - snap.player.x, him.y - snap.player.y) > GREET_RADIUS) return;
      armed = false;
      say("greet");
    },
    window(next) {
      if (next === open) return;
      open = next;
      say(next ? "shop" : "bye");
    },
  };
}
