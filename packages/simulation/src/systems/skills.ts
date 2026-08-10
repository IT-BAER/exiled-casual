import { Simulation } from "../loop";
import { normalizeBar, filterUnlockedBar } from "../persist";
import type { ProgressC, SessionC, SkillsC } from "../components";

/**
 * The action bar, and nothing else. Kept apart from skillCast because a swap is
 * a durable change to the character and a cast is not, and because the bar is
 * what the experience split reads — putting both in one system would make the
 * order of two unrelated things load-bearing.
 */
export function registerSkillsSystem(sim: Simulation): void {
  sim.register("skills", (world, _tick, commands) => {
    const e = world.query("session")[0];
    if (e === undefined) return;
    const skills = world.get<SkillsC>(e, "skills");
    if (!skills) return;
    const level = world.get<ProgressC>(e, "progress")?.level ?? 1;
    const classId = world.get<SessionC>(e, "session")?.classId ?? "";
    for (const cmd of commands) {
      if (cmd.type !== "setSkillBar" || !cmd.bar) continue;
      // The client's list is a request, not a fact: an id this character has not
      // unlocked empties its socket rather than being honoured. Shared with the
      // load path (persist.ts's restore()) so the two can never drift.
      const bar = filterUnlockedBar(normalizeBar(cmd.bar), level, classId);
      world.set<SkillsC>(e, "skills", { ...skills, bar });
    }
  });
}
