import type { ClassSkillCues } from "./types";

/**
 * The Stalker's cues (spec 2026-11-01). A bow skill's `-cast` master is its loose,
 * so it plays as the arrow leaves (`launch`), like the shipped bow skills; the
 * non-bow casts play on the accepted cast. Rain of Arrows' first landing takes the
 * heavy `-impact` and every arrow after it the `-arrow` pool, so the full volley is
 * the loudest Stalker moment; the aura and statuses keep to their quiet masters.
 */
export const STALKER_CUES: ClassSkillCues = {
  skills: {
    "skill.escape_shot.v1": { launch: "skill-escape-shot-cast", impact: "skill-escape-shot-impact" },
    "skill.ice_shot.v1": { launch: "skill-ice-shot-cast", impact: "skill-ice-shot-impact" },
    "skill.snipers_mark.v1": { cast: "skill-snipers-mark-cast" },
    "skill.lightning_arrow.v1": {
      launch: "skill-lightning-arrow-cast", chain: "skill-lightning-arrow-chain", impact: "skill-lightning-arrow-impact",
    },
    "skill.rain_of_arrows.v1": {
      cast: "skill-rain-of-arrows-cast",
      // A list, not a pick: `allSkillCueNames` preloads only names it can read.
      areaImpact: ["skill-rain-of-arrows-impact", "skill-rain-of-arrows-arrow"],
    },
    // The aura's sound is its buff appearing (below), so a refused toggle stays silent.
    "skill.haste.v1": {},
  },
  buffs: {
    haste: { on: "skill-haste-cast", off: "skill-aura-off" },
  },
  statuses: {
    chilled: "skill-status-chilled",
    marked: "skill-status-marked",
  },
};
