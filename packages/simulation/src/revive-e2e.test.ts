import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { createCombatSim } from "./combat-sim";
import { intentToCommand } from "./protocol-bridge";
import type { Health, SessionC } from "./components";

/**
 * The whole chain the app actually runs: createCombatSim's real system list, an
 * intent through intentToCommand, and one sim.step. revive.test.ts registers death
 * and revive by hand, which is not the same thing.
 */
describe("revive through the real sim", () => {
  it("answering the screen brings him back", () => {
    const { sim, world, playerEntity } = createCombatSim(7, { area: "map", tier: 1 });
    const sessionE = world.query("session")[0]!;
    const s0 = world.get<SessionC>(sessionE, "session")!;
    world.set<SessionC>(sessionE, "session", { ...s0, mapOpen: 1, portalsLeft: 6 });
    const h = world.get<Health>(playerEntity, "health")!;
    world.set<Health>(playerEntity, "health", { ...h, life: 0 });

    sim.step([]);
    expect(world.get<SessionC>(sessionE, "session")!.dead).toBe(1);

    sim.step([intentToCommand({ kind: "revive", where: "checkpoint" }, playerEntity, sim.tick)]);
    const s = world.get<SessionC>(sessionE, "session")!;
    expect(s.dead).toBe(0);
    expect(s.portalsLeft).toBe(5);
    expect(world.get<Health>(playerEntity, "health")!.life).toBe(h.maxLife);
  });
});
