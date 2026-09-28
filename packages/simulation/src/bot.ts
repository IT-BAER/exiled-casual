// The playtest bot: plays a map the way a competent casual player would, from
// the world alone, by returning the same commands the client sends. The headless
// balance runner (playtest.ts) and the client's ?bot mode both drive it.
import { fp } from "@exiled/fixed-point";
import { canAllocate, passivePoints, PASSIVE_TREE } from "@exiled/rules";
import { SKILLS, DEFAULT_ATTACK_BY_CLASS, MONSTERS, isCurrency } from "@exiled/content-runtime";
import { PICKUP_RADIUS } from "@exiled/protocol";
import { hasLineOfSight, type Collision } from "./collision";
import { bodyRadiusOf } from "./body";
import type { Simulation, Command } from "./loop";
import type { World, Entity } from "./ecs";
import type {
  Position, Health, Mana, SessionC, MonsterC, Cooldowns, FlasksC, ProgressC, SkillsC,
  TelegraphC, GroundAreaC, InteractableC, ContainerC, ItemC, PlayerC,
} from "./components";

const HZ = 30;
/** A person sees a telegraph or a new target about this late. */
export const REACTION_TICKS = 6;
/** Each class's first mana skill: what a player leads with while the pool lasts. */
export const SIGNATURE: Record<string, string> = {
  "class.ironsworn": "skill.heavy_strike.v1",
  "class.stalker": "skill.piercing_shot.v1",
  "class.emberbound": "skill.ember_bolt.v1",
};
/** Each class's level-8 pack answer. */
export const AREA: Record<string, string> = {
  "class.ironsworn": "skill.ground_slam.v1",
  "class.stalker": "skill.split_arrow.v1",
  "class.emberbound": "skill.cinder_ground.v1",
};
const GROUND = "skill.cinder_ground.v1";
const BLINK = "skill.blink.v1";
/**
 * Bolt radius 0.4 plus margin: the sight line is sampled every 0.25 units, the
 * bolt every 0.4, so a line that grazes a wall corner at 0.4 still eats the bolt.
 */
const AIM_CLEARANCE = fp(0.55);
/**
 * What the client camera shows around the player, in screen axes (u right, v up;
 * the camera looks down world +x+y rotated 45 degrees). Measured by ground-picking
 * the live camera's frame corners: 8.5 each side at 16:9, 7.2 up, 5.2 down.
 * Half a unit in from each edge, so a target is on screen, not clipped by it.
 */
const SCREEN = { u: fp(8), up: fp(6.7), down: fp(4.7) };

export interface BotOptions {
  /** Skills the bot may not use (ablation). */
  without?: readonly string[];
  trace?: (world: World, player: Entity, tick: number) => void;
}

export interface BotGame { sim: Simulation; world: World; player: Entity; session: Entity; classId: string }

export class Bot {
  private readonly body: number;
  private readonly attack: string;
  private readonly signature: string;
  private readonly area: string;
  private readonly melee: boolean;
  private readonly without: ReadonlySet<string>;
  /** Entities the bot gave up on reaching, until the tick stored. */
  private readonly skip = new Map<Entity, number>();
  private goal: Entity | undefined;
  private goalSince = 0;
  private goalFrom: Position = { x: 0, y: 0 };
  private target: Entity | undefined;
  private targetAt = -REACTION_TICKS;
  private lastFlask = -999;
  private last: Position = { x: 0, y: 0 };
  private still = 0;
  private nudge: { until: number; to: Record<string, number> } | undefined;

  constructor(private readonly g: BotGame, private readonly collision: Collision, opts: BotOptions) {
    this.body = g.world.get<PlayerC>(g.player, "player")!.bodyRadius;
    this.attack = DEFAULT_ATTACK_BY_CLASS[g.classId]!;
    this.signature = SIGNATURE[g.classId]!;
    this.area = AREA[g.classId]!;
    this.melee = isMelee(this.attack);
    this.without = new Set(opts.without ?? []);
  }

  hasLootLeft(): boolean {
    return this.loot().length > 0;
  }

  /**
   * A body pinned on a wall tip does not move while it is asked to (slide never
   * tries the other axis), so a person clicks beside it. Same here: after half a
   * second of wanting to move and not moving, step sideways for a third of one.
   */
  decide(bossDead: boolean): Command[] {
    const out = this.decideRaw(bossDead);
    const p = this.pos();
    const moving = out.some((c) => c.type === "moveTo" && dist(p, { x: c.data!["x"]!, y: c.data!["y"]! }) > fp(0.3));
    this.still = moving && dist(p, this.last) < fp(0.02) ? this.still + 1 : 0;
    this.last = p;
    const tick = this.g.sim.tick;
    if (this.still > 15) {
      const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const;
      const k = Math.trunc(tick / 16);
      for (let i = 0; i < dirs.length; i++) {
        const [dx, dy] = dirs[(k + i) % dirs.length]!;
        const to = { x: p.x + dx * fp(1), y: p.y + dy * fp(1) };
        if (this.collision.isWalkable(to.x, to.y, this.body)) { this.nudge = { until: tick + 10, to }; break; }
      }
      this.still = 0;
    }
    if (this.nudge && tick < this.nudge.until) {
      return [...out.filter((c) => c.type !== "moveTo" && c.type !== "stop"),
        { tick, entity: this.g.player, type: "moveTo", data: this.nudge.to }];
    }
    return out;
  }

  private decideRaw(bossDead: boolean): Command[] {
    const { world, sim, player } = this.g;
    const tick = sim.tick;
    const cmd = (c: Omit<Command, "tick" | "entity">): Command => ({ tick, entity: player, ...c });
    if (sess(this.g).dead === 1) return [{ tick, type: "revive", data: { checkpoint: 1 } }];

    const out: Command[] = [];
    const h = world.get<Health>(player, "health")!;
    const m = world.get<Mana>(player, "mana")!;
    const f = world.get<FlasksC>(player, "flasks");
    if (f && tick - this.lastFlask > HZ) {
      if (h.life * 2 < h.maxLife && f.lifeCharges > 0) { out.push(cmd({ type: "useFlask", flask: "life" })); this.lastFlask = tick; }
      else if (m.mana * 4 < m.maxMana && f.manaCharges > 0) { out.push(cmd({ type: "useFlask", flask: "mana" })); this.lastFlask = tick; }
    }
    const p = this.pos();
    this.passives(out, cmd);

    // 1. Get out of anything about to land or already burning underfoot.
    const threat = this.threat(p, tick);
    if (threat) {
      const away = this.escape(p, threat.c, Math.max(fp(1), threat.out));
      if (h.life * 100 < h.maxLife * 35 && this.ready(BLINK)) out.push(cmd({ type: "useSkill", skillId: BLINK, data: away }));
      out.push(cmd({ type: "moveTo", data: away }));
      return out;
    }

    // 2. Fight what is in reach.
    const target = this.pickTarget(p, tick, bossDead);
    if (target) {
      const near = this.monsters().filter((x) => x.awake).sort((a, b) => dist(p, a.p) - dist(p, b.p))[0];
      if (near && dist(p, near.p) < fp(1.5) && h.life * 100 < h.maxLife * 35 && this.ready(BLINK)) {
        out.push(cmd({ type: "useSkill", skillId: BLINK, data: this.escape(p, near.p, fp(5)) }));
        return out;
      }
      const skill = this.pickSkill(p, target);
      if (skill) out.push(cmd({ type: "useSkill", skillId: skill, data: { tx: target.p.x, ty: target.p.y } }));
      // Backing off is for when it hurts; at health a caster stands and casts.
      if (!this.melee && near && dist(p, near.p) < fp(1.5) && h.life * 2 < h.maxLife && !world.has(near.e, "boss")) {
        out.push(cmd({ type: "moveTo", data: this.escape(p, near.p, fp(2.5)) }));
      } else if (!skill && !(this.melee && (this.hostileFireAt(target.p)
        // Already in a swing's reach with every swing cooling down: walking on
        // takes him to the target's centre, where the swing has nothing to aim at.
        || dist(p, target.p) <= this.shortestReach()))) {
        const to = this.route(p, target.p);
        if (to) out.push(cmd(this.intoFire(p, to) ? { type: "stop" } : { type: "moveTo", data: to }));
      } else {
        // In reach, or a swing whose way in is the monsters' fire: that one waits
        // at the edge for its target to follow him out.
        out.push(cmd({ type: "stop" }));
      }
      return out;
    }

    // 2b. Awake and close, but a wall he stands against eats every bolt: open the range.
    // Only a melee monster follows him out; a shooter holds wherever it can hit him,
    // and a brute too wide for the way in never arrives, so backing off either is
    // undone by the walk in (3.) forever.
    if (!this.melee) {
      const near = this.monsters().find((x) => x.awake && dist(p, x.p) < fp(3)
        && !MONSTERS.get(world.get<MonsterC>(x.e, "monster")!.defId)?.ranged && this.reaches(x.e, x.p, p));
      const away = near && this.escape(p, near.p, fp(3));
      if (away && (away["x"] !== p.x || away["y"] !== p.y)) {
        out.push(cmd({ type: "moveTo", data: away }));
        return out;
      }
    }

    // 3. Nothing in reach: loot, then chests, then the nearest monster.
    const goal = this.pickGoal(p, bossDead);
    if (!goal) return out;
    if (dist(p, goal.p) <= goal.radius) {
      // Beside a monster he stops: the last walk aimed at its centre, and at distance 0
      // no projectile spawns from either side.
      out.push(cmd(goal.kind === "item"
        ? { type: "pickupItem", data: { entityId: goal.e } }
        : goal.kind === "monster" ? { type: "stop" } : { type: "interact", data: { targetId: goal.e } }));
      // A full bag or a no-op interact would hold the bot here forever.
      if (tick - this.goalSince > HZ) this.skip.set(goal.e, tick + 60 * HZ);
      return out;
    }
    const to = this.route(p, goal.p);
    // No route at all: behind water or in a pocket the body does not fit.
    if (!to) { this.skip.set(goal.e, tick + 60 * HZ); return out; }
    out.push(cmd(this.intoFire(p, to) ? { type: "stop" } : { type: "moveTo", data: to }));
    return out;
  }

  /**
   * The next unit of a walk lands in monsters' fire. Step 1 walks him out and this
   * walk would take him straight back in, every other tick, at the pool's edge.
   */
  private intoFire(p: Position, to: Record<string, number>): boolean {
    const t = { x: to["x"]!, y: to["y"]! };
    const d = dist(p, t);
    if (d === 0) return false;
    const k = Math.min(1, fp(1) / d);
    return this.hostileFireAt({ x: p.x + Math.round((t.x - p.x) * k), y: p.y + Math.round((t.y - p.y) * k) });
  }

  private pos(): Position {
    return this.g.world.get<Position>(this.g.player, "position")!;
  }

  private monsters(): { e: Entity; p: Position; awake: boolean }[] {
    const w = this.g.world;
    return w.query("monster", "position").map((e) => ({
      e, p: w.get<Position>(e, "position")!, awake: w.get<MonsterC>(e, "monster")!.state !== "idle",
    }));
  }

  /** The centre of the nearest thing about to hurt him, and how far to walk to be clear of it. */
  private threat(p: Position, tick: number): { c: Position; out: number } | undefined {
    const w = this.g.world;
    for (const e of w.query("telegraph", "position")) {
      const t = w.get<TelegraphC>(e, "telegraph")!;
      if (t.team === 0 || tick - t.startTick < REACTION_TICKS) continue;
      const c = w.get<Position>(e, "position")!;
      if (dist(p, c) < t.radius + this.body) return { c, out: t.radius + this.body + fp(0.5) - dist(p, c) };
    }
    for (const e of w.query("groundArea", "position")) {
      const a = w.get<GroundAreaC>(e, "groundArea")!;
      if (a.team === 0) continue;
      const c = w.get<Position>(e, "position")!;
      if (dist(p, c) < a.radius + this.body) return { c, out: a.radius + this.body + fp(0.5) - dist(p, c) };
    }
    return undefined;
  }

  /** Whether monsters' fire covers `at`, counting his own body. */
  private hostileFireAt(at: Position): boolean {
    const w = this.g.world;
    return w.query("groundArea", "position").some((e) => {
      const a = w.get<GroundAreaC>(e, "groundArea")!;
      return a.team !== 0 && dist(at, w.get<Position>(e, "position")!) < a.radius + this.body;
    });
  }

  /** Stand-off distance: the shorter of the two ranged skills a class leads with. */
  private range(): number {
    const reachOf = (id: string) => {
      const e = SKILLS.get(id)!.effects.find((x) => x.type === "spawnProjectile");
      return e && e.type === "spawnProjectile" ? e.maxRangeFixed : Infinity;
    };
    const r = Math.min(reachOf(this.signature), reachOf(this.attack));
    return r === Infinity ? fp(12) : Math.trunc(r * 0.8);
  }

  /** Within the attack's reach and on the player's screen. */
  private inSight(p: Position, at: Position): boolean {
    const dx = at.x - p.x;
    const dy = at.y - p.y;
    const u = (dx + dy) / Math.SQRT2;
    const v = (dy - dx) / Math.SQRT2;
    return dist(p, at) < this.range() && Math.abs(u) <= SCREEN.u && v <= SCREEN.up && -v <= SCREEN.down;
  }

  /** How close a swing needs to stand: reach counts to the target's surface, so a body's width is spare. */
  private reach(id: string): number {
    const s = SKILLS.get(id)!.effects.find((e) => e.type === "meleeStrike");
    return s && s.type === "meleeStrike" ? s.reachFixed + fp(0.3) : Infinity;
  }

  /** The shortest reach of any swing on the bar: inside it, every swing he has can land. */
  private shortestReach(): number {
    return Math.min(...[this.attack, this.signature, this.area].filter((id) => this.onBar(id)).map((id) => this.reach(id)));
  }

  /** Nearest awake monster with a clear line, re-chosen only at human speed. */
  private pickTarget(p: Position, tick: number, bossDead: boolean): { e: Entity; p: Position } | undefined {
    const w = this.g.world;
    if (this.target !== undefined && w.alive.has(this.target) && tick - this.targetAt < REACTION_TICKS) {
      const tp = w.get<Position>(this.target, "position")!;
      if (this.inSight(p, tp)) return { e: this.target, p: tp };
    }
    // With the boss down the map is over: only what comes at him is worth a shot.
    const seen = this.monsters()
      .filter((x) => (!bossDead || x.awake) && this.inSight(p, x.p) && this.clearShot(p, x))
      .sort((a, b) => Number(b.awake) - Number(a.awake) || dist(p, a.p) - dist(p, b.p));
    const t = seen[0];
    this.target = t?.e;
    this.targetAt = tick;
    return t;
  }

  /**
   * The bolt's own wall test, up to where it meets the target's body: a bolt dies on
   * its first step that touches a wall, even with the target a step beyond it.
   */
  private clearShot(p: Position, t: { e: Entity; p: Position }): boolean {
    const d = dist(p, t.p);
    const k = Math.max(fp(0.4), d - AIM_CLEARANCE - bodyRadiusOf(this.g.world, t.e)) / d;
    const x = p.x + Math.round((t.p.x - p.x) * Math.min(1, k)), y = p.y + Math.round((t.p.y - p.y) * Math.min(1, k));
    return hasLineOfSight(this.collision, p.x, p.y, x, y, AIM_CLEARANCE);
  }

  private onBar(id: string): boolean {
    if (this.without.has(id)) return false;
    const s = this.g.world.get<SkillsC>(this.g.session, "skills");
    return !!s && s.bar.includes(id);
  }

  private ready(id: string): boolean {
    if (!this.onBar(id)) return false;
    const cd = this.g.world.get<Cooldowns>(this.g.player, "cooldowns")?.[id] ?? 0;
    const mana = this.g.world.get<Mana>(this.g.player, "mana")!.mana;
    return cd <= this.g.sim.tick && mana >= SKILLS.get(id)!.manaCostFixed;
  }

  /** Area skill on a pack or a big body, the class's own skill while mana lasts, the free attack otherwise. */
  private pickSkill(p: Position, t: { e: Entity; p: Position }): string | undefined {
    const w = this.g.world;
    const packed = this.monsters().filter((x) => dist(t.p, x.p) < fp(2.5)).length >= 3;
    const big = w.has(t.e, "boss") || w.get<MonsterC>(t.e, "monster")!.rare === 1;
    // A second field on a burning pack is mana for nothing.
    const burning = this.area === GROUND && w.query("groundArea", "position").some((e) => {
      const a = w.get<GroundAreaC>(e, "groundArea")!;
      return a.team === 0 && dist(t.p, w.get<Position>(e, "position")!) < a.radius;
    });
    const d = dist(p, t.p);
    if ((packed || big) && !burning && this.ready(this.area) && d <= this.reach(this.area)) return this.area;
    if (this.ready(this.signature) && d <= this.reach(this.signature)) return this.signature;
    // Out of reach of a swing: undefined walks him in.
    return this.onBar(this.attack) && d <= this.reach(this.attack) ? this.attack : undefined;
  }

  private loot(): { e: Entity; p: Position }[] {
    const w = this.g.world;
    const tick = this.g.sim.tick;
    return w.query("item", "position")
      .filter((e) => (this.skip.get(e) ?? 0) <= tick)
      .filter((e) => {
        const it = w.get<ItemC>(e, "item")!.item;
        return !!it.waystone || isCurrency(it) || it.rarity !== "normal";
      })
      .map((e) => ({ e, p: w.get<Position>(e, "position")! }));
  }

  private pickGoal(p: Position, bossDead: boolean):
    { e: Entity; p: Position; radius: number; kind: "item" | "container" | "monster" } | undefined {
    const w = this.g.world;
    const tick = this.g.sim.tick;
    const ok = (e: Entity) => (this.skip.get(e) ?? 0) <= tick;
    const near = (xs: { e: Entity; p: Position }[]) => xs.sort((a, b) => dist(p, a.p) - dist(p, b.p))[0];

    const item = near(this.loot().filter((x) => dist(p, x.p) < fp(bossDead ? 30 : 8)));
    const chest = near(w.query("container", "position")
      .filter((e) => ok(e) && w.get<ContainerC>(e, "container")!.opened === 0)
      .map((e) => ({ e, p: w.get<Position>(e, "position")! }))
      .filter((x) => dist(p, x.p) < fp(10)));
    // A walk commits to its monster: two at nearly the same distance otherwise
    // swap places as "nearest" with every step and the bot paces on the spot.
    const mobs = this.monsters().filter((x) => ok(x.e));
    const mob = mobs.find((x) => x.e === this.goal) ?? near(mobs);
    const g = item
      ? { ...item, radius: PICKUP_RADIUS - fp(0.1), kind: "item" as const }
      : chest
        ? { ...chest, radius: w.get<InteractableC>(chest.e, "interactable")!.radius - fp(0.1), kind: "container" as const }
        : mob
          ? { ...mob, radius: fp(1), kind: "monster" as const }
          : undefined;
    if (!g) return undefined;

    // Stuck detection: a goal that has not brought the bot 1 unit closer in 3 s
    // is behind something the nav cannot solve; try the next one.
    if (g.e !== this.goal) {
      this.goal = g.e; this.goalSince = tick; this.goalFrom = p;
    } else if (tick - this.goalSince > 3 * HZ) {
      if (dist(this.goalFrom, p) < fp(1) && dist(p, g.p) > g.radius) this.skip.set(g.e, tick + 30 * HZ);
      this.goalSince = tick; this.goalFrom = p;
    }
    return g;
  }

  /** Whether monster `e` at `from` can walk to `to`: a straight line or a route for its own body. */
  private reaches(e: Entity, from: Position, to: Position): boolean {
    const r = bodyRadiusOf(this.g.world, e);
    if (!this.collision.nav || hasLineOfSight(this.collision, from.x, from.y, to.x, to.y, r)) return true;
    return this.collision.nav.waypoint(from.x, from.y, to.x, to.y, r) !== null;
  }

  /** Walk toward `to` along the nav field, as far ahead as the line stays clear. */
  private route(p: Position, to: Position): Record<string, number> | null {
    if (hasLineOfSight(this.collision, p.x, p.y, to.x, to.y, this.body)) return { x: to.x, y: to.y };
    if (!this.collision.nav?.waypoint(p.x, p.y, to.x, to.y, this.body)) return null;
    let at = p;
    for (let k = 0; k < 12; k++) {
      const wp = this.collision.nav?.waypoint(at.x, at.y, to.x, to.y, this.body);
      // The first step is always taken: it is one cell over, and a body hugging a
      // wall fails the swept test to it while the slide still gets there.
      if (!wp || (k > 0 && !hasLineOfSight(this.collision, p.x, p.y, wp.x, wp.y, this.body))) break;
      at = wp;
    }
    return { x: at.x, y: at.y };
  }

  /** A walkable point `d` away from `from`, turning off the straight line if a wall is there. */
  private escape(p: Position, from: Position, d: number): Record<string, number> {
    const base = Math.atan2(p.y - from.y, p.x - from.x);
    // Out of one fire and into the next is no escape: clear ground first, any ground second.
    for (const clear of [true, false]) {
      // The full circle: fire centred on him has no "away", so the first guess can be a wall.
      for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.4, -2.4, Math.PI]) {
        const x = p.x + Math.round(Math.cos(base + turn) * d);
        const y = p.y + Math.round(Math.sin(base + turn) * d);
        if (clear && this.hostileFireAt({ x, y })) continue;
        if (this.collision.isWalkable(x, y, this.body) && hasLineOfSight(this.collision, p.x, p.y, x, y, this.body)) {
          return { x, y, tx: x, ty: y };
        }
      }
    }
    return { x: p.x, y: p.y, tx: p.x, ty: p.y };
  }

  /** Spend every point on the best-scoring node that can be taken. */
  private passives(out: Command[], cmd: (c: Omit<Command, "tick" | "entity">) => Command): void {
    const s = sess(this.g);
    const have = s.passives ?? [];
    if (have.length >= passivePoints(progress(this.g).level)) return;
    const classId = s.classId ?? "";
    const pick = PASSIVE_TREE
      .filter((n) => canAllocate(classId, have, n.id))
      .map((n) => ({ n, score: n.mods.reduce((a, m) => a + (PASSIVE_WEIGHT[m.stat] ?? 1), 0) * (n.kind === "notable" ? 3 : 1) }))
      .sort((a, b) => b.score - a.score)[0];
    if (pick) out.push(cmd({ type: "allocatePassive", passiveId: pick.n.id }));
  }
}

/** What a caster wants from the tree; anything unlisted is worth 1. */
const PASSIVE_WEIGHT: Record<string, number> = {
  spellDamagePct: 3, castSpeedPct: 3, maxLife: 3, critChancePct: 2, manaRegenPct: 2,
};


function isMelee(id: string): boolean {
  return SKILLS.get(id)!.effects.some((e) => e.type === "meleeStrike");
}
function sess(g: BotGame): SessionC { return g.world.get<SessionC>(g.session, "session")!; }
function progress(g: BotGame): ProgressC { return g.world.get<ProgressC>(g.session, "progress")!; }
function dist(a: Position, b: Position): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

