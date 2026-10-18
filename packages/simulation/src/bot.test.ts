import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { Bot } from "./bot";
import { newCharacter } from "./playtest";
import { spawnLabActors } from "./combat-sim";
import { spawnMonster } from "./areas";
import { MONSTERS, waystoneItem } from "@exiled/content-runtime";
import type { Collision } from "./collision";
import type { Position, GroundAreaC, MonsterC, PlayerC, ItemC } from "./components";

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

  it("an Ironsworn swings at a wide body by its surface, as the strike resolves reach", () => {
    // The Cinder Warden (radius 1.4) holds at its own melee range of 2.2.
    const { g, bot } = setupAs("class.ironsworn", [0, 2.2]);
    const e = g.world.query("monster").at(-1)!;
    g.world.set<MonsterC>(e, "monster", { ...g.world.get<MonsterC>(e, "monster")!, bodyRadius: fp(1.4) });
    expect(skillOf(bot.decide(false))).toBe("skill.heavy_strike.v1");
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

  it("a back-off keeps its point while the monster follows, rather than re-aiming every tick", () => {
    // A corner W eats a bolt (0.55 wide) but not the imp's body: no shot, so he backs
    // off. Re-aimed off a follower each tick, he flipped ends of a narrow lane and paced.
    const { g, me } = setupAs("class.stalker", [-0.9, 0]);
    const imp = g.world.query("monster")[0]!;
    const ip = g.world.get<Position>(imp, "position")!;
    const W = { x: (me.x + ip.x) / 2 + Math.round(fp(0.32)), y: (me.y + ip.y) / 2 - Math.round(fp(0.32)) };
    const corner: Collision = { isWalkable: (x, y, r) => Math.hypot(x - W.x, y - W.y) >= r };
    const bot = new Bot(g, corner, {});
    const first = bot.decide(false).find((c) => c.type === "moveTo")?.data;
    expect(first, "no back-off").toBeDefined();
    g.world.set<Position>(imp, "position", { x: ip.x + Math.round(fp(0.6)), y: ip.y - Math.round(fp(0.6)) });
    const second = bot.decide(false).find((c) => c.type === "moveTo")?.data;
    expect(second).toEqual(first);
  });

  it("a walk to loot commits like a walk to a monster: stepping back past 8 units does not drop it", () => {
    // The route to an item 7.9 units off bent away from it; past 8 it lost the goal
    // to a monster whose route led back inside 8, and the bot paced on the spot.
    const { g, me } = setupAs("class.stalker", [0, 30]);
    const at = (u: number) => ({ x: me.x - Math.round(fp(u / Math.SQRT2)), y: me.y - Math.round(fp(u / Math.SQRT2)) });
    const stone = g.world.create();
    g.world.set<Position>(stone, "position", at(7.9));
    g.world.set<ItemC>(stone, "item", { item: waystoneItem(1, 3), w: 1, h: 1 });
    g.world.set<MonsterC>(g.world.query("monster")[0]!, "monster", { ...g.world.get<MonsterC>(g.world.query("monster")[0]!, "monster")!, state: "idle" });
    const bot = new Bot(g, OPEN, {});
    bot.decide(false);
    g.world.set<Position>(g.player, "position", at(-0.5));
    const to = bot.decide(false).find((c) => c.type === "moveTo")?.data;
    expect(to, "no walk").toBeDefined();
    expect(Math.hypot(to!["x"]! - at(7.9).x, to!["y"]! - at(7.9).y)).toBeLessThan(fp(0.5));
  });

  it("waiting at the edge of fire over the loot is not being stuck: the stone is still wanted after it", () => {
    const { g, me, bot } = setupAs("class.stalker");
    const at = (u: number) => ({ x: me.x + Math.round(fp(u / Math.SQRT2)), y: me.y + Math.round(fp(u / Math.SQRT2)) });
    const stone = g.world.create();
    g.world.set<Position>(stone, "position", at(5));
    g.world.set<ItemC>(stone, "item", { item: waystoneItem(1, 3), w: 1, h: 1 });
    const fire = g.world.create();
    g.world.set<Position>(fire, "position", at(2));
    g.world.set<GroundAreaC>(fire, "groundArea", {
      radius: fp(1.2), expiryTick: 9999, nextTick: 0, ailmentKind: "burning", stacksPerApply: 1,
      dps: fp(3), ailmentDuration: 60, maxStacks: 5, team: 1,
    });
    for (let t = 0; t < 4 * 30; t++) g.sim.step(bot.decide(true));
    expect(g.world.alive.has(stone)).toBe(true);
    expect(bot.hasLootLeft()).toBe(true);
  });

  /**
   * Mother Vhal's burning ground lands centred on him, so "away from it" has no
   * direction and reads as east. With a wall there he stood in it until he died.
   */
  it("leaves fire centred on him even when the only way out is behind the side it first tries", () => {
    const g = newCharacter("class.ironsworn", 1, 10);
    const me = g.world.get<Position>(g.player, "position")!;
    // A dead end open only to the west: every direction the old search tried is wall.
    const wallEast: Collision = {
      isWalkable: (x, y, r) => x + r < me.x + fp(1) && Math.abs(y - me.y) + r < fp(1),
    };
    const fire = g.world.create();
    g.world.set<Position>(fire, "position", { x: me.x, y: me.y });
    g.world.set<GroundAreaC>(fire, "groundArea", {
      radius: fp(5), expiryTick: 9999, nextTick: 0, ailmentKind: "burning", stacksPerApply: 1,
      dps: fp(3), ailmentDuration: 60, maxStacks: 5, team: 1,
    });
    const move = new Bot(g, wallEast, {}).decide(false).find((c) => c.type === "moveTo");
    const to = move?.data as { x: number; y: number } | undefined;
    expect(to, "no move at all").toBeDefined();
    expect(Math.hypot(to!.x - me.x, to!.y - me.y)).toBeGreaterThan(fp(5));
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

  it("stops beside a monster he walked to rather than walking onto its centre", () => {
    // Only his own body passes, never a bolt: no shot, so step 3 walks to the goal.
    const { g, me } = setupAs("class.emberbound");
    const body = g.world.get<PlayerC>(g.player, "player")!.bodyRadius;
    spawnLabActors(g.world, "imp", 0, 0);
    const imp = g.world.query("monster").at(-1)!;
    g.world.set<Position>(imp, "position", { x: me.x + fp(0.8), y: me.y });
    g.world.set<MonsterC>(imp, "monster", { ...g.world.get<MonsterC>(imp, "monster")!, state: "idle" });
    const out = new Bot(g, { isWalkable: (_x, _y, r) => r === body }, {}).decide(false);
    expect(out.some((c) => c.type === "useSkill" || c.type === "moveTo" || c.type === "interact")).toBe(false);
    expect(out.some((c) => c.type === "stop")).toBe(true);
  });

  it("does not back off a shooter behind a wall: it holds where it hits him and never follows", () => {
    const { g, me } = setupAs("class.emberbound");
    const x0 = me.x + fp(0.5), x1 = me.x + fp(1.5), y1 = me.y - fp(0.3), y0 = me.y - fp(5);
    const block: Collision = {
      isWalkable: (x, y, r) => {
        const gx = Math.max(0, x0 - x, x - x1), gy = Math.max(0, y0 - y, y - y1);
        return gx * gx + gy * gy >= r * r && (gx > 0 || gy > 0);
      },
    };
    const wisp = spawnMonster(g.world, MONSTERS.get("monster.fen_wisp.v1")!, me.x + fp(1.9), me.y, false);
    g.world.set<MonsterC>(wisp, "monster", { ...g.world.get<MonsterC>(wisp, "monster")!, state: "attack" });
    const out = new Bot(g, block, {}).decide(false);
    for (const c of out.filter((x) => x.type === "moveTo")) expect(c.data!["x"]!).toBeGreaterThanOrEqual(me.x);
  });

  it("does not back off a brute that cannot route to him: it would never follow", () => {
    // Same block, and a nav that lets his body through but not the Boar's.
    const { g, me } = setupAs("class.stalker");
    const x0 = me.x + fp(0.5), x1 = me.x + fp(1.5), y1 = me.y - fp(0.3), y0 = me.y - fp(5);
    const block: Collision = {
      isWalkable: (x, y, r) => {
        const gx = Math.max(0, x0 - x, x - x1), gy = Math.max(0, y0 - y, y - y1);
        return gx * gx + gy * gy >= r * r && (gx > 0 || gy > 0);
      },
      nav: { waypoint: (_fx, _fy, tx, ty, r) => (r > fp(0.6) ? null : { x: tx, y: ty }) },
    };
    const brute = spawnMonster(g.world, MONSTERS.get("monster.thornhide_boar.v1")!, me.x + fp(1.9), me.y - fp(1.2), false);
    g.world.set<MonsterC>(brute, "monster", { ...g.world.get<MonsterC>(brute, "monster")!, state: "chase" });
    const out = new Bot(g, block, {}).decide(false);
    for (const c of out.filter((x) => x.type === "moveTo")) expect(c.data!["x"]!).toBeGreaterThanOrEqual(me.x);
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
