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
  const g = newCharacter("class.emberbound", 1, 10);
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
  it("shoots only what the camera shows", () => {
    expect(setup([0, -6]).bot.decide(false).some((c) => c.type === "useSkill")).toBe(false);
    expect(setup([0, -4]).bot.decide(false).some((c) => c.type === "useSkill")).toBe(true);
    expect(setup([9.5, 0]).bot.decide(false).some((c) => c.type === "useSkill")).toBe(false);
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
