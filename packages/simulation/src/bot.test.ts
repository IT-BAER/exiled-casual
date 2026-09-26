import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { Bot } from "./bot";
import { newCharacter } from "./playtest";
import { spawnLabActors } from "./combat-sim";
import type { Collision } from "./collision";
import type { Position, GroundAreaC, MonsterC } from "./components";

const OPEN: Collision = { isWalkable: () => true };
const GROUND = "skill.cinder_ground.v1";

/** A level-10 Emberbound and imps at screen offsets (u right, v up) from him. */
function setup(...at: [number, number][]) {
  return setupAs("class.emberbound", ...at);
}

function setupAs(classId: string, ...at: [number, number][]) {
  const g = newCharacter(classId, 1, 10);
  const me = g.world.get<Position>(g.player, "position")!;
  for (const [u, v] of at) {
    spawnLabActors(g.world, "imp", 0, 0);
    const e = g.world.query("monster").at(-1)!;
    g.world.set<Position>(e, "position", {
      x: me.x + Math.round(fp((u - v) / Math.SQRT2)), y: me.y + Math.round(fp((u + v) / Math.SQRT2)),
    });
    g.world.set<MonsterC>(e, "monster", { ...g.world.get<MonsterC>(e, "monster")!, state: "chase" });
  }
  return { g, me, bot: new Bot(g, OPEN, {}) };
}

describe("Bot", () => {
  const skillOf = (out: ReturnType<Bot["decide"]>) => out.find((c) => c.type === "useSkill")?.skillId;

  it("an Ironsworn walks into reach first, then swings Heavy Strike", () => {
    const far = setupAs("class.ironsworn", [0, 4]).bot.decide(false);
    expect(skillOf(far)).toBeUndefined();
    expect(far.some((c) => c.type === "moveTo")).toBe(true);
    expect(skillOf(setupAs("class.ironsworn", [0, 1.2]).bot.decide(false))).toBe("skill.heavy_strike.v1");
  });

  it("an Ironsworn waits at the edge of a boss's fire rather than walking in to swing", () => {
    const { g, me, bot } = setupAs("class.ironsworn", [0, 4]);
    const fire = g.world.create();
    g.world.set<Position>(fire, "position", { x: me.x - Math.round(fp(4 / Math.SQRT2)), y: me.y + Math.round(fp(4 / Math.SQRT2)) });
    g.world.set<GroundAreaC>(fire, "groundArea", {
      radius: fp(2.5), expiryTick: 9999, nextTick: 0, ailmentKind: "burning", stacksPerApply: 1,
      dps: fp(3), ailmentDuration: 60, maxStacks: 5, team: 1,
    });
    const out = bot.decide(false);
    expect(out.some((c) => c.type === "moveTo")).toBe(false);
    expect(out.some((c) => c.type === "stop")).toBe(true);
  });

  it("does not walk back into the fire it just stepped out of on the way to something", () => {
    // The imp is off screen, so this is a walk to a goal, not a fight.
    const { g, me, bot } = setupAs("class.ironsworn", [0, 10]);
    const fire = g.world.create();
    g.world.set<Position>(fire, "position", { x: me.x - Math.round(fp(2 / Math.SQRT2)), y: me.y + Math.round(fp(2 / Math.SQRT2)) });
    g.world.set<GroundAreaC>(fire, "groundArea", {
      radius: fp(1.2), expiryTick: 9999, nextTick: 0, ailmentKind: "burning", stacksPerApply: 1,
      dps: fp(3), ailmentDuration: 60, maxStacks: 5, team: 1,
    });
    const out = bot.decide(false);    expect(out.some((c) => c.type === "moveTo")).toBe(false);
    expect(out.some((c) => c.type === "stop")).toBe(true);
  });

  it("a Stalker looses Piercing Shot from where it stands", () => {
    expect(skillOf(setupAs("class.stalker", [0, 4]).bot.decide(false))).toBe("skill.piercing_shot.v1");
  });

  it("shoots only what the camera shows", () => {
    expect(setup([0, -6]).bot.decide(false).some((c) => c.type === "useSkill")).toBe(false);
    expect(setup([0, -4]).bot.decide(false).some((c) => c.type === "useSkill")).toBe(true);
    expect(setup([9.5, 0]).bot.decide(false).some((c) => c.type === "useSkill")).toBe(false);
  });

  it("steps off a wall rather than loosing into it when a bolt cannot pass", () => {
    // A block from 0.5 to 1.5 ahead whose face is 0.3 off his line: a 0.4 bolt meets it.
    const { g, me } = setupAs("class.stalker");
    const x0 = me.x + fp(0.5), x1 = me.x + fp(1.5), y1 = me.y - fp(0.3), y0 = me.y - fp(5);
    const block: Collision = {
      isWalkable: (x, y, r) => {
        const gx = Math.max(0, x0 - x, x - x1), gy = Math.max(0, y0 - y, y - y1);
        return gx * gx + gy * gy >= r * r && (gx > 0 || gy > 0);
      },
    };
    spawnLabActors(g.world, "imp", 0, 0);
    const imp = g.world.query("monster").at(-1)!;
    g.world.set<Position>(imp, "position", { x: me.x + fp(1.9), y: me.y });
    g.world.set<MonsterC>(imp, "monster", { ...g.world.get<MonsterC>(imp, "monster")!, state: "chase" });
    const out = new Bot(g, block, {}).decide(false);
    expect(out.some((c) => c.type === "useSkill")).toBe(false);
    expect(out.some((c) => c.type === "moveTo")).toBe(true);
  });

  it("stands and casts at full life with a monster close, rather than backing off", () => {
    const out = setup([0, 2]).bot.decide(false);
    expect(out.some((c) => c.type === "useSkill")).toBe(true);
    expect(out.some((c) => c.type === "moveTo")).toBe(false);
  });

  it("drops Cinder Ground on three packed monsters, not two, and not into its own fire", () => {
    const skill = (b: Bot) => b.decide(false).find((c) => c.type === "useSkill")?.skillId;
    expect(skill(setup([0, 4], [0.8, 4]).bot)).not.toBe(GROUND);
    expect(skill(setup([0, 4], [0.8, 4], [-0.8, 4]).bot)).toBe(GROUND);

    const { g, me, bot } = setup([0, 4], [0.8, 4], [-0.8, 4]);
    const fire = g.world.create();
    g.world.set<Position>(fire, "position", { x: me.x - Math.round(fp(4 / Math.SQRT2)), y: me.y + Math.round(fp(4 / Math.SQRT2)) });
    g.world.set<GroundAreaC>(fire, "groundArea", {
      radius: fp(2.5), expiryTick: 9999, nextTick: 0, ailmentKind: "burning", stacksPerApply: 1,
      dps: fp(8), ailmentDuration: 60, maxStacks: 5, team: 0,
    });
    expect(skill(bot)).not.toBe(GROUND);
  });
});
