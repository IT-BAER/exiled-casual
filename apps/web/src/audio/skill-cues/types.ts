/**
 * What a class skill sounds like, by snapshot edge (`soundscape.ts` diffs each).
 * Every name is a VOICES entry in `sfx.ts`. Absent = silent for that edge, except
 * where noted.
 */

/** What an impact cue is told about the area that landed. */
export interface AreaCueInfo { index: number; shape: "disc" | "cone"; radius: number }

/** One name, one per impact index (the last repeats), or a pick per impact. */
export type AreaCue = string | readonly string[] | ((a: AreaCueInfo) => string | null);

export interface SkillCues {
  /** The cast the sim accepted (its cooldown going up, or `castSkill` appearing). */
  cast?: string;
  /** The cast RESOLVED (`player.castRelease`): heard on every resolve, a recast while its buff is up included. */
  release?: string;
  /** A player projectile of this skill appearing near him: the loose. */
  launch?: string;
  /** A projectile appearing away from him: a chain leaving a struck body. */
  chain?: string;
  /** Sustained while the projectile flies; null silences the shipped profile's. */
  flight?: string | null;
  /** The projectile struck (an arrow that ran out of range is silent). */
  impact?: string | null;
  /** A skillArea first seen before its impact. */
  areaWarn?: string;
  /** A skillArea landing. */
  areaImpact?: AreaCue;
  /** Sustained while the skill's ground patch exists. Absent = the cinder bed; null = silent. */
  groundLoop?: string | null;
  /** The skill's ground patch appearing. */
  groundOn?: string;
  /** A travel starting, and its landing. */
  travel?: string;
  land?: string;
}

export interface BuffCues {
  /** The buff id appearing in `player.buffs`. */
  on?: string;
  /** Leaving it. Absent on an aura = `skill-aura-off`. */
  off?: string;
  /** Sustained on the player while it is up. */
  loop?: string;
}

export interface ClassSkillCues {
  /** Keyed by full skill id. */
  skills: Record<string, SkillCues>;
  /** Keyed by buff id. */
  buffs: Record<string, BuffCues>;
  /** Keyed by status id (`stunned` for the flag): played as it lands on a monster. */
  statuses: Record<string, string>;
}
