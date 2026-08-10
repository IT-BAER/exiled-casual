import { describe, it, expect } from "vitest";
import { SKILL_SLOT_COUNT, MOVE_SOCKET, MOUSE_SLOT_BASE } from "@exiled/protocol";
import { createCombatSim } from "../combat-sim";
import type { ProgressC, SkillsC } from "../components";

function sessionOf(world: ReturnType<typeof createCombatSim>["world"]) {
  return world.query("session")[0]!;
}

describe("setSkillBar", () => {
  it("a setSkillBar command replaces the bar and leaves the gems alone", () => {
    const { sim, world, playerEntity } = createCombatSim(7, { area: "hideout" });
    const e = sessionOf(world);
    const before = world.get<SkillsC>(e, "skills")!;
    const newBar = [...before.bar];
    newBar[0] = null; // clear the numbered slot, leave everything else as seeded

    sim.step([{ tick: 0, entity: playerEntity, type: "setSkillBar", bar: newBar }]);

    const after = world.get<SkillsC>(e, "skills")!;
    expect(after.bar[0]).toBeNull();
    expect(after.gems).toEqual(before.gems);
  });

  it("refuses an id the character has not unlocked, keeping the socket empty", () => {
    const { sim, world, playerEntity } = createCombatSim(7, { area: "hideout" });
    const e = sessionOf(world);
    // Pin level 1 explicitly: skill.cinder_ground.v1 unlocks at 8, so this is
    // dead unless the level actually gates the check.
    world.set<ProgressC>(e, "progress", { ...world.get<ProgressC>(e, "progress")!, level: 1 });
    const before = world.get<SkillsC>(e, "skills")!;
    const bar = [...before.bar];
    bar[0] = "skill.cinder_ground.v1";

    sim.step([{ tick: 0, entity: playerEntity, type: "setSkillBar", bar }]);

    expect(world.get<SkillsC>(e, "skills")!.bar[0]).toBeNull();
  });

  it("keeps MOVE_SOCKET, which is not a skill and never will be", () => {
    const { sim, world, playerEntity } = createCombatSim(7, { area: "hideout" });
    const e = sessionOf(world);
    const bar = new Array(SKILL_SLOT_COUNT).fill(null) as (string | null)[];
    bar[MOUSE_SLOT_BASE] = MOVE_SOCKET;

    sim.step([{ tick: 0, entity: playerEntity, type: "setSkillBar", bar }]);

    expect(world.get<SkillsC>(e, "skills")!.bar[MOUSE_SLOT_BASE]).toBe(MOVE_SOCKET);
  });

  it("normalizes a short bar up to SKILL_SLOT_COUNT and drops a duplicate id", () => {
    const { sim, world, playerEntity } = createCombatSim(7, { area: "hideout" });
    const e = sessionOf(world);
    // ember_bolt unlocks at level 1, so it survives the unlock filter and the
    // duplicate-drop is the only thing under test here.
    const bar = ["skill.ember_bolt.v1", "skill.ember_bolt.v1"];

    sim.step([{ tick: 0, entity: playerEntity, type: "setSkillBar", bar }]);

    const after = world.get<SkillsC>(e, "skills")!.bar;
    expect(after).toHaveLength(SKILL_SLOT_COUNT);
    expect(after[0]).toBe("skill.ember_bolt.v1");
    expect(after[1]).toBeNull();
  });

  it("refuses an id that is not real content, keeping the socket empty", () => {
    // Not in the brief's four, but the global constraint says an unknown id must
    // be refused too — kills the mutation that drops the `SKILLS.get(id)`
    // existence check and only tests `isUnlocked`.
    const { sim, world, playerEntity } = createCombatSim(7, { area: "hideout" });
    const e = sessionOf(world);
    const bar = new Array(SKILL_SLOT_COUNT).fill(null) as (string | null)[];
    bar[0] = "does.not.exist";

    sim.step([{ tick: 0, entity: playerEntity, type: "setSkillBar", bar }]);

    expect(world.get<SkillsC>(e, "skills")!.bar[0]).toBeNull();
  });
});
