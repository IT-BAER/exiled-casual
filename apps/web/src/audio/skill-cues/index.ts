import { IRONSWORN_CUES } from "./ironsworn";
import { STALKER_CUES } from "./stalker";
import { EMBERBOUND_CUES } from "./emberbound";
import type { AreaCue, AreaCueInfo, BuffCues, ClassSkillCues, SkillCues } from "./types";

export type * from "./types";

/** The aura's default way out, when its own table names none. */
export const AURA_OFF = "skill-aura-off";

/** The three class tables merged. A key in two of them is a programmer error. */
export function mergeCues(parts: readonly ClassSkillCues[]): ClassSkillCues {
  const out: ClassSkillCues = { skills: {}, buffs: {}, statuses: {} };
  for (const part of parts) {
    for (const table of ["skills", "buffs", "statuses"] as const) {
      for (const [id, cue] of Object.entries(part[table])) {
        if (Object.hasOwn(out[table], id)) throw new Error(`[skill-cues] ${table} "${id}" is registered twice`);
        (out[table] as Record<string, unknown>)[id] = cue;
      }
    }
  }
  return out;
}

export const SKILL_CUES: ClassSkillCues = mergeCues([IRONSWORN_CUES, STALKER_CUES, EMBERBOUND_CUES]);

export const skillCues = (id: string | undefined): SkillCues | undefined =>
  id === undefined ? undefined : SKILL_CUES.skills[id];
export const buffCues = (id: string): BuffCues | undefined => SKILL_CUES.buffs[id];

/** The cue one landed impact makes, or null. */
export function areaCue(cue: AreaCue | undefined, a: AreaCueInfo): string | null {
  if (cue === undefined) return null;
  if (typeof cue === "string") return cue;
  if (typeof cue === "function") return cue(a);
  const list = cue as readonly string[];
  return list.length === 0 ? null : list[Math.min(a.index, list.length - 1)]!;
}

/** Every name the tables can play, for the VOICES guard and the preload. */
export function allSkillCueNames(): string[] {
  const names = new Set<string>([AURA_OFF]);
  const add = (v: unknown) => { if (typeof v === "string") names.add(v); else if (Array.isArray(v)) for (const n of v) add(n); };
  for (const c of Object.values(SKILL_CUES.skills)) for (const v of Object.values(c)) add(v);
  for (const c of Object.values(SKILL_CUES.buffs)) for (const v of Object.values(c)) add(v);
  for (const v of Object.values(SKILL_CUES.statuses)) add(v);
  return [...names];
}
