import type { Snapshot, SnapshotEntity } from "@exiled/protocol";
import { playSfx, playSfxAt } from "./sfx";

/**
 * The hideout's people talking: a greeting on the first approach of a hideout
 * visit, a line when their window opens and another when it closes.
 *
 * One line at a time per speaker, so a new one is dropped (not queued) while the
 * last still sounds: a man talking over himself is two men. The window is React
 * state, not world state, so it is told here directly; the approach is read off
 * the snapshot. Every line sounds from where the speaker stands, as the last
 * hideout snapshot saw them.
 *
 * No shared mouth between speakers: Varkis and Maren stand 8.4 units apart, so two
 * GREET_RADIUS circles never hold the player at once.
 */

const GROUPS = { greet: 4, shop: 4, bye: 3 } as const;
type Group = keyof typeof GROUPS | "idle";

export interface Npc {
  /** The cue prefix: `npc-<id>-<group>-<n>`. */
  readonly id: string;
  /** The snapshot entity that is this speaker. */
  readonly kind: SnapshotEntity["kind"];
  /** Asides said now and then to nobody in particular; 0 = none. */
  readonly idle: number;
}

export const VARKIS: Npc = { id: "varkis", kind: "vendor", idle: 0 };
export const MAREN: Npc = { id: "maren", kind: "cartographer", idle: 4 };

const lines = (npc: Npc, g: Group): string[] =>
  Array.from({ length: g === "idle" ? npc.idle : GROUPS[g] }, (_, i) => `npc-${npc.id}-${g}-${i + 1}`);

/** Every cue a speaker can say, for the hideout to preload. */
const cues = (npc: Npc): readonly string[] =>
  ([...Object.keys(GROUPS), "idle"] as Group[]).flatMap((g) => lines(npc, g));
export const VARKIS_SFX: readonly string[] = cues(VARKIS);
export const MAREN_SFX: readonly string[] = cues(MAREN);

/** Inside this many units of a speaker counts as walking up to them; the hideout spawn is 5.4 from Varkis. */
const GREET_RADIUS = 3.5;
/** Asides: none in the first seconds of a visit, then one per random gap, heard within about a screen. */
export const IDLE_FIRST_S = 40;
export const IDLE_GAP_S: readonly [number, number] = [60, 150];
export const IDLE_RADIUS = 9;

export interface NpcVoice {
  observe(snap: Snapshot): void;
  /** Their window's open state, every time it may have changed; only edges speak. */
  window(open: boolean): void;
}

interface At { x: number; y: number }

interface Options {
  /** Plays a cue from `at` (sim units; null = on the player) and says how many
   *  seconds it sounds (0 when nothing started). */
  play?: (name: string, at: At | null) => number;
  /** Seconds, monotonic. */
  now?: () => number;
  /** [0, 1), for the line picked and the gap before the next aside. */
  random?: () => number;
}

export function createNpcVoice(npc: Npc, opts: Options = {}): NpcVoice {
  const play = opts.play
    ?? ((name: string, at: At | null) => (at ? playSfxAt(name, at.x, at.y) : playSfx(name)));
  const now = opts.now ?? (() => performance.now() / 1000);
  const random = opts.random ?? Math.random;
  let busyUntil = -Infinity;
  /** When the next aside is due; null outside the hideout, so every visit waits IDLE_FIRST_S again. */
  let asideAt: number | null = null;
  /** True until they have greeted this hideout visit. */
  let armed = true;
  let open = false;
  /** Where they were last seen; null before the first hideout snapshot. */
  let at: At | null = null;
  const last = new Map<Group, string>();

  const say = (g: Group): void => {
    const t = now();
    if (t < busyUntil) return;
    const pool = lines(npc, g).filter((l) => l !== last.get(g));
    const line = pool[Math.floor(random() * pool.length)]!;
    last.set(g, line);
    busyUntil = t + play(line, at);
  };

  return {
    observe(snap) {
      if (snap.area !== "hideout") { armed = true; asideAt = null; return; }
      const t = now();
      asideAt ??= t + IDLE_FIRST_S;
      const self = snap.entities.find((e) => e.kind === npc.kind);
      if (!self) return;
      at = { x: self.x, y: self.y };
      const d = Math.hypot(self.x - snap.player.x, self.y - snap.player.y);
      if (armed && d <= GREET_RADIUS) {
        armed = false;
        say("greet");
        return;
      }
      // Due and spoken or not, the next one is a fresh gap away: an aside cut off is spent.
      if (npc.idle > 0 && !open && t >= asideAt && d <= IDLE_RADIUS) {
        say("idle");
        asideAt = t + IDLE_GAP_S[0] + random() * (IDLE_GAP_S[1] - IDLE_GAP_S[0]);
      }
    },
    window(next) {
      if (next === open) return;
      open = next;
      say(next ? "shop" : "bye");
    },
  };
}
