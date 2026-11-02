import { fxProfile, type FxProfile } from "../skill-fx";
import { IRONSWORN_LOOKS } from "./ironsworn";
import { STALKER_LOOKS } from "./stalker";
import { EMBERBOUND_LOOKS } from "./emberbound";
import type { BuffLook, ClassSkillLooks, SkillLook, StatusLook } from "./types";

export type * from "./types";

/** The three class modules merged. A key in two of them is a programmer error. */
export function mergeLooks(parts: readonly ClassSkillLooks[]): ClassSkillLooks {
  const out: ClassSkillLooks = { skills: {}, buffs: {}, statuses: {} };
  for (const part of parts) {
    for (const table of ["skills", "buffs", "statuses"] as const) {
      for (const [id, look] of Object.entries(part[table])) {
        if (Object.hasOwn(out[table], id)) throw new Error(`[skills] ${table} "${id}" is registered twice`);
        (out[table] as Record<string, unknown>)[id] = look;
      }
    }
  }
  return out;
}

export const SKILL_LOOKS: ClassSkillLooks = mergeLooks([IRONSWORN_LOOKS, STALKER_LOOKS, EMBERBOUND_LOOKS]);
/** Each class's own looks, by class id: all a character can cast where no one else stands. */
export const CLASS_LOOKS: Readonly<Record<string, ClassSkillLooks>> = {
  "class.ironsworn": IRONSWORN_LOOKS,
  "class.stalker": STALKER_LOOKS,
  "class.emberbound": EMBERBOUND_LOOKS,
};

export const skillLook = (id: string | undefined): SkillLook | undefined =>
  id === undefined ? undefined : SKILL_LOOKS.skills[id];
export const buffLook = (id: string): BuffLook | undefined => SKILL_LOOKS.buffs[id];
export const statusLook = (id: string): StatusLook | undefined => SKILL_LOOKS.statuses[id];

/**
 * The bolt/arrow profile a projectile is drawn with: a class look's own, else the
 * shipped table's. Every projectile read goes through here, so a new skill's arrow
 * is an arrow everywhere (mesh, flight angle, viewer).
 */
export function skillFx(id: string | undefined): FxProfile {
  return skillLook(id)?.projectileFx ?? fxProfile(id);
}

/** Every profile a projectile can be built with, for the warm-up pass. */
export function projectileProfiles(): [string, FxProfile][] {
  return Object.entries(SKILL_LOOKS.skills).flatMap(([id, l]) => (l.projectileFx ? [[id, l.projectileFx] as [string, FxProfile]] : []));
}
