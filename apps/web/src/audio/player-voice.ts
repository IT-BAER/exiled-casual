import type { Snapshot, SnapshotEntity } from "@exiled/protocol";
import { playSfx } from "./sfx";

/**
 * The player's own voice: a grunt when a hit lands hard, a line when life runs
 * low, a streak, a boss, a drop worth stopping for, a level, a death, a new map.
 *
 * Read off the snapshot DIFF like everything in soundscape.ts, never at the
 * dispatch site, so he never shouts about a hit that did not land. One mouth: a
 * new line is dropped while the last still sounds, except a death, which always
 * speaks. Lines that react to a STATE (a boss awake, life low, kills in the
 * window) retry until the mouth is free; lines that react to an EDGE wait in a
 * short queue and go stale after LATE_S.
 *
 * A speaker is a class on a body (`stalker-male`): a class is one body today, and
 * a second body for a class is a second speaker, not a code change.
 */

export const PLAYER_GROUPS = {
  hurt: 6, pain: 3, low: 3, streak: 4, boss: 3, slain: 3, loot: 3, level: 2, death: 2, enter: 3,
} as const;
type Group = keyof typeof PLAYER_GROUPS;

export const SPEAKERS = ["ironsworn-male", "stalker-male", "emberbound-female"] as const;

/** `class.stalker` on a `male` body speaks as `stalker-male`. */
export const speakerFor = (classId: string, body: string): string => `${classId.replace(/^class\./, "")}-${body}`;

const lines = (speaker: string, g: Group): string[] =>
  Array.from({ length: PLAYER_GROUPS[g] }, (_, i) => `voice-${speaker}-${g}-${i + 1}`);

/** Every cue a speaker can say, for the game to preload. */
export const playerVoiceSfx = (speaker: string): readonly string[] =>
  (Object.keys(PLAYER_GROUPS) as Group[]).flatMap((g) => lines(speaker, g));

/** A hit for this share of life + energy shield grunts; this much cries out. */
export const HURT_FRAC = 0.08;
export const PAIN_FRAC = 0.25;
export const GRUNT_GAP_S = 1.5;
/** Life below this share speaks once; above the second it may speak again. */
export const LOW_LIFE = 0.3;
export const LOW_REARM = 0.6;
export const STREAK_KILLS = 5;
export const STREAK_WINDOW_S = 4;
export const STREAK_GAP_S = 25;
/** After the drop's own sound, and no oftener than the gap. */
export const LOOT_DELAY_S = 0.6;
export const LOOT_GAP_S = 20;
/** After the level-up cue has had its moment. */
export const LEVEL_DELAY_S = 0.8;
export const ENTER_CHANCE = 0.4;
export const ENTER_DELAY_S = 1;
/** A queued line this long past its time is no longer about anything. */
const LATE_S = 3;

export interface PlayerVoice {
  /**
   * Called once per snapshot; `before` is null on the first one in an area.
   * Says whether a grunt or cry played, so the generic hurt cue can stand down.
   */
  observe(before: Snapshot | null, snap: Snapshot): boolean;
}

interface Options {
  /** Plays a cue on the player and says how many seconds it sounds (0 when nothing started). */
  play?: (name: string) => number;
  /** Seconds, monotonic. */
  now?: () => number;
  /** [0, 1), for the line picked and the map-enter roll. */
  random?: () => number;
}

const isBoss = (e: SnapshotEntity): boolean => e.kind === "monster" && e.boss === true;

export function createPlayerVoice(speaker: string, opts: Options = {}): PlayerVoice {
  const play = opts.play ?? ((name: string) => playSfx(name));
  const now = opts.now ?? (() => performance.now() / 1000);
  const random = opts.random ?? Math.random;
  let busyUntil = -Infinity;
  let gruntAt = -Infinity;
  let streakAt = -Infinity;
  let lootAt = -Infinity;
  let lowArmed = true;
  let bossGreeted = false;
  const kills: number[] = [];
  const queue: { group: Group; at: number }[] = [];
  const last = new Map<Group, string>();

  const say = (g: Group, force = false): boolean => {
    const t = now();
    if (!force && t < busyUntil) return false;
    const pool = lines(speaker, g).filter((l) => l !== last.get(g));
    const line = pool[Math.floor(random() * pool.length)]!;
    last.set(g, line);
    busyUntil = t + play(line);
    return true;
  };

  return {
    observe(before, snap) {
      const t = now();
      if (before === null) {
        // A new area: nothing carries over but the cooldowns.
        bossGreeted = false;
        kills.length = 0;
        queue.length = 0;
        if (snap.area === "map" && random() < ENTER_CHANCE) queue.push({ group: "enter", at: t + ENTER_DELAY_S });
        return false;
      }
      const p = snap.player;
      const q = before.player;
      if (q.alive && !p.alive) {
        queue.length = 0;
        say("death", true);
        return false;
      }
      if (!p.alive) return false;

      // A pool that shrank is a refund or an unequip, not damage (soundscape.ts).
      let grunted = false;
      const pool = p.maxLife + p.maxEnergyShield;
      if (p.maxLife >= q.maxLife && p.maxEnergyShield >= q.maxEnergyShield && pool > 0) {
        const hit = (q.life + q.energyShield - p.life - p.energyShield) / pool;
        if (hit >= HURT_FRAC && t - gruntAt >= GRUNT_GAP_S && say(hit >= PAIN_FRAC ? "pain" : "hurt")) {
          gruntAt = t;
          grunted = true;
        }
      }

      const was = new Map<number, SnapshotEntity>();
      for (const e of before.entities) was.set(e.id, e);
      const here = new Set(snap.entities.map((e) => e.id));
      for (const [id, e] of was) {
        if (here.has(id) || e.kind !== "monster") continue;
        kills.push(t);
        if (isBoss(e)) queue.push({ group: "slain", at: t });
      }
      for (const e of snap.entities) {
        if (e.kind !== "groundItem" || was.has(e.id)) continue;
        if ((e.rarity === "rare" || e.rarity === "unique") && t - lootAt >= LOOT_GAP_S) {
          lootAt = t;
          queue.push({ group: "loot", at: t + LOOT_DELAY_S });
        }
      }
      if (p.level > q.level) queue.push({ group: "level", at: t + LEVEL_DELAY_S });

      const share = p.maxLife > 0 ? p.life / p.maxLife : 1;
      if (share > LOW_REARM) lowArmed = true;
      if (lowArmed && share < LOW_LIFE && say("low")) lowArmed = false;

      while (kills.length > 0 && t - kills[0]! > STREAK_WINDOW_S) kills.shift();
      if (kills.length >= STREAK_KILLS && t - streakAt >= STREAK_GAP_S && say("streak")) {
        streakAt = t;
        kills.length = 0;
      }

      if (!bossGreeted && snap.entities.some((e) => isBoss(e) && e.bossAwake) && say("boss")) bossGreeted = true;

      for (let i = queue.length - 1; i >= 0; i--) if (t - queue[i]!.at > LATE_S) queue.splice(i, 1);
      const due = queue.findIndex((w) => t >= w.at);
      if (due >= 0 && say(queue[due]!.group)) queue.splice(due, 1);
      return grunted;
    },
  };
}
