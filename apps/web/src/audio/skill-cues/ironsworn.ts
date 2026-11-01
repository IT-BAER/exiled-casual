import type { ClassSkillCues } from "./types";

/**
 * The Ironsworn's cues (spec 2026-11-01), A4 masters in sfx.ts VOICES. The loud ones
 * are the leap's landing and the aftershock; auras and statuses stay quiet.
 */
export const IRONSWORN_CUES: ClassSkillCues = {
  skills: {
    // The gather on the cast, the roar on the resolve: a recast while the buff is still up is heard too.
    "skill.infernal_cry.v1": { cast: "skill-infernal-cry-cast", release: "skill-infernal-cry-impact" },
    // The landing is an area, so it sounds once there and not again on the travel's end.
    "skill.leap_slam.v1": { cast: "skill-leap-slam-cast", travel: "skill-leap-slam-whoosh", areaImpact: "skill-leap-slam-impact" },
    // The cone lands at once, the aftershock disc a second later.
    "skill.earthquake.v1": {
      cast: "skill-earthquake-cast",
      areaImpact: (a) => (a.shape === "cone" ? "skill-earthquake-impact" : "skill-earthquake-aftershock"),
    },
    "skill.determination.v1": {},
    // The first burst is the slam, every one after it a burst racing out.
    "skill.sunder.v1": { cast: "skill-sunder-cast", areaImpact: ["skill-sunder-impact", "skill-sunder-burst"] },
    "skill.blood_rage.v1": { cast: "skill-blood-rage-cast" },
  },
  buffs: {
    determination: { on: "skill-determination-cast" },
    blood_rage: { loop: "skill-blood-rage-heartbeat" },
  },
  statuses: {
    scorched: "skill-status-scorched",
    stunned: "skill-status-stunned",
  },
};
