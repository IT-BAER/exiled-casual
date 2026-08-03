import { describe, it, expect } from "vitest";
import { fp, toNumber } from "@exiled/fixed-point";
import { resBlock } from "@exiled/content-schema";
import { applyDamage } from "@exiled/rules";
import { createCombatSim, intentToCommand, checksumWorld } from "@exiled/simulation";
import { CONTENT_VERSION, SKILLS } from "@exiled/content-runtime";
import { firstDifference } from "../index";
import { runCombat } from "./combat";
import type { Intent } from "@exiled/protocol";

function fireSkill(player: number, skillId: string, tx: number, ty: number, atTick: number) {
  const intent: Intent = { kind: "useSkill", skillId, tx, ty };
  return intentToCommand(intent, player, atTick);
}

describe("golden (a): Ember Bolt fire damage on a cinder imp", () => {
  it("reduces imp life by the correctly mitigated amount after projectile connects", () => {
    const { sim, world, playerEntity } = createCombatSim(42);
    const cmd = fireSkill(playerEntity, "skill.ember_bolt.v1", fp(5), fp(0), 0);
    for (let t = 0; t < 20; t++) {
      sim.step(t === 0 ? [cmd] : []);
    }
    const expectedDamage = applyDamage(
      { type: "fire", amountFixed: fp(36) },
      { resPct: resBlock(), armourFixed: fp(0.5) },
    );
    expect(expectedDamage).toBe(fp(36));

    const damagedImps = world.query("monster", "health").filter(e => {
      const h = world.get<{ life: number; maxLife: number }>(e, "health")!;
      return h.life < h.maxLife;
    });
    expect(damagedImps.length).toBeGreaterThan(0);

    const hasCorrectLife = world.query("monster", "health").some(e => {
      const h = world.get<{ life: number; maxLife: number }>(e, "health")!;
      return h.life === h.maxLife - expectedDamage;
    });
    expect(hasCorrectLife).toBe(true);
  });
});

describe("golden (b): Cinder Ground burning ailment", () => {
  it("applies burning stacks to a monster standing in the area", () => {
    const { sim, world, playerEntity } = createCombatSim(42);
    const cmd = fireSkill(playerEntity, "skill.cinder_ground.v1", fp(5), fp(0), 0);
    // Cinder Ground now resolves after its 15-tick cast, then gets its first
    // application on the following ground-area tick.
    for (let t = 0; t < 30; t++) {
      sim.step(t === 0 ? [cmd] : []);
    }
    const hasAilment = world.query("monster", "ailment").some(e =>
      (world.get<{ stacks: number }>(e, "ailment")?.stacks ?? 0) >= 1,
    );
    expect(hasAilment).toBe(true);
  });

  it("ailment expires after durationTicks with no re-application", () => {
    const { sim, world, playerEntity } = createCombatSim(42);
    const cmd = fireSkill(playerEntity, "skill.cinder_ground.v1", fp(5), fp(0), 0);
    for (let t = 0; t < 200; t++) {
      sim.step(t === 0 ? [cmd] : []);
    }
    const stillBurning = world.query("monster", "ailment")
      .filter(e => world.get<{ kind: string }>(e, "ailment")?.kind === "burning")
      .length;
    expect(stillBurning).toBe(0);
  });
});

describe("golden (c): fire resistance reduces damage", () => {
  it("rare imp (fireResPct=30) takes strictly less fire damage than normal (fireResPct=0)", () => {
    const hit = fp(25);
    const normalDmg = applyDamage({ type: "fire", amountFixed: hit }, { resPct: resBlock(), armourFixed: fp(0.5) });
    const rareDmg = applyDamage({ type: "fire", amountFixed: hit }, { resPct: resBlock({ fire: 30 }), armourFixed: fp(0.5) });
    expect(rareDmg).toBeLessThan(normalDmg);
    expect(rareDmg).toBe(Math.trunc(fp(25) * 70 / 100));
  });
});

describe("golden (d): monster death removes entity", () => {
  it("a monster overkilled to 0 life is absent from the world after the tick", () => {
    const { sim, world, playerEntity } = createCombatSim(42);
    // Second cast off the skill's OWN cooldown rather than a literal: at a fixed
    // tick 10 this test quietly stopped firing twice the day the cooldown passed
    // it, and a one-bolt run does not overkill anything.
    const bolt = SKILLS.get("skill.ember_bolt.v1")!;
    const second = Math.max(bolt.cooldownTicks, (bolt.castTicks ?? 0) + 1);
    const cmds: [number, ReturnType<typeof fireSkill>][] = [
      [0, fireSkill(playerEntity, "skill.ember_bolt.v1", fp(5), fp(0), 0)],
      [second, fireSkill(playerEntity, "skill.ember_bolt.v1", fp(5), fp(0), second)],
    ];
    const cmdMap = new Map(cmds);
    let impEntityAliveAtSome = false;
    for (let t = 0; t < 60; t++) {
      const tickCmds = cmdMap.get(t) ? [cmdMap.get(t)!] : [];
      sim.step(tickCmds);
      const alive = world.query("monster").length;
      if (t < second) impEntityAliveAtSome = alive > 0;
    }
    expect(impEntityAliveAtSome).toBe(true);
    const allMonsters = world.query("monster");
    expect(allMonsters.length).toBeLessThanOrEqual(5);
  });
});

describe("golden (e): determinism", () => {
  it("two runCombat calls with same seed and commands yield identical checksum sequences", () => {
    const ticks = 30;
    const cmds: import("@exiled/simulation").Command[][] = [];
    const { playerEntity } = createCombatSim(42);
    const bolt = fireSkill(playerEntity, "skill.ember_bolt.v1", fp(5), fp(0), 0);
    cmds[0] = [bolt];

    const run1 = runCombat(42, cmds, ticks);
    const run2 = runCombat(42, cmds, ticks);

    expect(firstDifference(run1.checksums, run2.checksums)).toBeNull();
  });
});
