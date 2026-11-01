// @vitest-environment node
import { describe, it, expect } from "vitest";
import { SKILLS } from "@exiled/content-runtime";
import { SKILL_FX } from "../skill-fx";
import { CLIP_NAME } from "../rig";
import { SKILL_LOOKS, mergeLooks, skillFx } from "./index";
import { SKILL_CUES } from "../../audio/skill-cues";

/** Spec 2026-11-01 section 1: the 18 class skills, guarded even before their defs land. */
const SPEC_SKILLS = [
  "infernal_cry", "leap_slam", "earthquake", "determination", "sunder", "blood_rage",
  "escape_shot", "ice_shot", "snipers_mark", "lightning_arrow", "rain_of_arrows", "haste",
  "flame_dash", "ember_nova", "flammability", "solar_orb", "firestorm", "herald_of_ash",
].map((s) => `skill.${s}.v1`);
const SPEC_BUFFS = ["infernal_cry", "blood_rage", "determination", "haste", "herald_of_ash"];
const SPEC_STATUSES = ["scorched", "chilled", "stunned", "marked", "flammable", "taunted"];

/** Every class skill that is not one of the shipped kit (those keep their own tables). */
function classSkills(): string[] {
  const authored = [...SKILLS.values()].filter((d) => d.classId !== undefined && SKILL_FX[d.id] === undefined).map((d) => d.id);
  return [...new Set([...SPEC_SKILLS, ...authored])];
}

/** Buff and status ids the skill defs actually apply, read off their effects. */
function effectIds(): { buffs: Set<string>; statuses: Set<string> } {
  const buffs = new Set<string>();
  const statuses = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if (node === null || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (typeof o["buffId"] === "string") buffs.add(o["buffId"]);
    if (typeof o["statusId"] === "string") statuses.add(o["statusId"]);
    if (typeof o["stunTicks"] === "number" && o["stunTicks"] > 0) statuses.add("stunned");
    // A ground `slowPct` shows as `chilled` (A1 deviation 6).
    if (o["type"] === "spawnGroundArea" && typeof o["slowPct"] === "number") statuses.add("chilled");
    for (const v of Object.values(o)) walk(v);
  };
  for (const def of SKILLS.values()) walk(def.effects);
  return { buffs, statuses };
}

describe("class skill registry", () => {
  it("gives every class skill a look with a cast clip the rig ships, and a cue entry", () => {
    for (const id of classSkills()) {
      const look = SKILL_LOOKS.skills[id];
      expect(look, `no look for ${id}`).toBeDefined();
      expect(look!.cast, `no cast for ${id}`).toBeDefined();
      expect(CLIP_NAME[look!.cast!.clip], id).toBeDefined();
      expect(SKILL_CUES.skills[id], `no cues for ${id}`).toBeDefined();
    }
  });

  it("draws every buff and status the defs apply, and the spec's", () => {
    const { buffs, statuses } = effectIds();
    for (const id of new Set([...SPEC_BUFFS, ...buffs])) expect(SKILL_LOOKS.buffs[id], `buff ${id}`).toBeDefined();
    for (const id of new Set([...SPEC_STATUSES, ...statuses])) expect(SKILL_LOOKS.statuses[id], `status ${id}`).toBeDefined();
  });

  it("keeps every shipped projectile on its own profile", () => {
    for (const [id, fx] of Object.entries(SKILL_FX)) expect(skillFx(id)).toBe(fx);
  });

  it("refuses an id registered by two classes", () => {
    const one = { skills: { a: {} }, buffs: {}, statuses: {} };
    expect(() => mergeLooks([one, one])).toThrow(/twice/);
  });
});
