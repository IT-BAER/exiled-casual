import type { ClassSkillCues } from "./types";

/**
 * The Emberbound's cues (spec 2026-11-01), the A4 masters in sfx.ts VOICES. A ground
 * loop sounds per patch, so the dash's trail and the herald's kill patches carry
 * none (eight stacked beds on one dash); the trail is heard as the rush itself.
 */
export const EMBERBOUND_CUES: ClassSkillCues = {
  skills: {
    "skill.flame_dash.v1": {
      cast: "skill-flame-dash-cast", travel: "skill-flame-dash-trail", land: "skill-flame-dash-impact", groundLoop: null,
    },
    "skill.ember_nova.v1": { cast: "skill-ember-nova-cast", areaImpact: "skill-ember-nova-impact" },
    "skill.flammability.v1": { cast: "skill-flammability-cast" },
    "skill.solar_orb.v1": { cast: "skill-solar-orb-cast", groundOn: "skill-solar-orb-impact", groundLoop: "skill-solar-orb-loop" },
    // The first meteor is the storm breaking (the heavy master); every one after, a meteor.
    "skill.firestorm.v1": { cast: "skill-firestorm-cast", areaImpact: ["skill-firestorm-impact", "skill-firestorm-meteor"] },
    // The toggle is heard as the buff comes up (`buffs.on`), not twice.
    "skill.herald_of_ash.v1": { groundOn: "skill-herald-of-ash-burst", groundLoop: null },
  },
  buffs: {
    herald_of_ash: { on: "skill-herald-of-ash-cast", off: "skill-aura-off" },
  },
  statuses: {
    flammable: "skill-status-flammable",
  },
};
