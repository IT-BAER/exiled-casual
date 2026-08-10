import { isUnlocked } from "@exiled/rules";
import { SKILLS } from "@exiled/content-runtime";
import { MOVE_SOCKET } from "@exiled/protocol";
import { Simulation } from "../loop";
import { normalizeBar } from "../persist";
import type { ProgressC, SessionC, SkillsC } from "../components";

/**
 * The action bar, and nothing else. Kept apart from skillCast because a swap is
 * a durable change to the character and a cast is not, and because the bar is
 * what the experience split reads — putting both in one system would make the
 * order of two unrelated things load-bearing.
 */
export function registerSkillsSystem(sim: Simulation): void {
  sim.register("skills", (world, _tick, commands) => {
    for (const cmd of commands) {
      if (cmd.type !== "setSkillBar" || !cmd.bar) continue;
      const e = world.query("session")[0];
      if (e === undefined) continue;
      const skills = world.get<SkillsC>(e, "skills");
      if (!skills) continue;
      const level = world.get<ProgressC>(e, "progress")?.level ?? 1;
      const classId = world.get<SessionC>(e, "session")?.classId ?? "";
      // The client's list is a request, not a fact: an id this character has not
      // unlocked empties its socket rather than being honoured.
      const bar = normalizeBar(cmd.bar).map((id) => {
        if (id === null || id === MOVE_SOCKET) return id;
        const def = SKILLS.get(id);
        return def && isUnlocked(def, level, classId) ? id : null;
      });
      world.set<SkillsC>(e, "skills", { ...skills, bar });
    }
  });
}
