// A headless player for balance work: plays real generated maps in the real sim,
// the way a competent casual player would, and reports what the run felt like
// in numbers (clear time, deaths, kill rate, drop pacing, levels).
//
// Test tooling only. It reads the world and sends the same commands the client
// sends; the two shortcuts are named where they happen (a portal "click" sets
// pendingArea directly, since walking to the ring measures nothing).
import { fp } from "@exiled/fixed-point";
import {
  atlasGraph, atlasNodeTier, isNodeReachable, canAllocate, passivePoints, PASSIVE_TREE, maxGemLevel,
} from "@exiled/rules";
import { SKILLS, CONTENT_VERSION, DEFAULT_ATTACK_BY_CLASS, isCurrency, itemStatMods, baseOf } from "@exiled/content-runtime";
import type { Item } from "@exiled/content-schema";
import type { EquipSlotId } from "@exiled/protocol";
import { PICKUP_RADIUS } from "@exiled/protocol";
import { generateArea } from "@exiled/mapgen";
import { createCombatSim, spawnLabActors } from "./combat-sim";
import { equipStartingGear } from "./characters";
import { reseedDefaultAttack, grantSkills } from "./persist";
import { areaCollision } from "./areas";
import { grammarForNode } from "./systems/area-transition";
import { hasLineOfSight, type Collision } from "./collision";
import { EQUIP_SLOTS_BY_CLASS } from "./equipment";
import type { Simulation, Command } from "./loop";
import type { World, Entity } from "./ecs";
import type {
  Position, Health, Mana, SessionC, MonsterC, Cooldowns, FlasksC, ProgressC, SkillsC,
  TelegraphC, GroundAreaC, InteractableC, ContainerC, ItemC, InventoryC, PlayerC, EquipmentC,
} from "./components";

const HZ = 30;
/** A person sees a telegraph or a new target about this late. */
export const REACTION_TICKS = 6;
const MAP_CAP_TICKS = 15 * 60 * HZ;
const BOLT = "skill.ember_bolt.v1";
const GROUND = "skill.cinder_ground.v1";
const BLINK = "skill.blink.v1";
/**
 * Bolt radius 0.4 plus margin: the sight line is sampled every 0.25 units, the
 * bolt every 0.4, so a line that grazes a wall corner at 0.4 still eats the bolt.
 */
const AIM_CLEARANCE = fp(0.55);

export interface MapRun {
  classId: string;
  node: string;
  tier: number;
  /** Boss dead. False = out of portals or the 15 minute cap. */
  cleared: boolean;
  stuck: boolean;
  seconds: number;
  deaths: number;
  kills: number;
  /** Seconds within one second of a cast: fighting, at whatever range the class fights. */
  combatSeconds: number;
  drops: Record<"normal" | "magic" | "rare" | "unique" | "currency" | "waystone", number>;
  /** Seconds into the map of every magic-or-better equipment drop. */
  magicPlusAt: number[];
  levelStart: number;
  levelEnd: number;
  casts: Record<string, number>;
  flasks: number;
}

export interface BotOptions {
  /** Skills the bot may not use (ablation). */
  without?: readonly string[];
  trace?: (world: World, player: Entity, tick: number) => void;
}

interface Game { sim: Simulation; world: World; player: Entity; session: Entity; classId: string }

/**
 * A new character of `classId` in its hideout, dressed and barred like the client
 * makes one. `level` above 1 lifts it there the lab's way, with every gem at the
 * character's level: the upper bound on what that character could be carrying.
 */
export function newCharacter(classId: string, seed: number, level = 1): Game {
  const { sim, world, playerEntity } = createCombatSim(seed, { area: "hideout" });
  const session = world.query("session")[0]!;
  world.set<SessionC>(session, "session", { ...world.get<SessionC>(session, "session")!, classId });
  equipStartingGear(world, classId);
  world.set<SkillsC>(session, "skills", reseedDefaultAttack(world.get<SkillsC>(session, "skills")!, classId));
  grantSkills(world);
  for (let l = 1; l < level; l++) spawnLabActors(world, "levelup", 0, 0);
  if (level > 1) {
    const sk = world.get<SkillsC>(session, "skills")!;
    const gems = Object.fromEntries(Object.keys(sk.gems).map((id) => [id, { level: maxGemLevel(level), xp: 0 }]));
    world.set<SkillsC>(session, "skills", { ...sk, gems });
  }
  return { sim, world, player: playerEntity, session, classId };
}

/** Enter the next map the character can open, play it to the end, walk home. */
export function playNextMap(g: Game, opts: BotOptions = {}): MapRun | null {
  refit(g);
  if (!openMap(g)) return null;
  const s = sess(g);
  const layout = generateArea(s.mapSeed, CONTENT_VERSION, grammarForNode(s.activeNodeId));
  // Built from the same world the sim's own collision was, so the bot sees the
  // containers and furniture as blockers exactly like the movement system does.
  const collision = areaCollision(g.world, "map", layout);
  const bot = new Bot(g, collision, opts);
  const run: MapRun = {
    classId: g.classId, node: s.activeNodeId, tier: s.areaTier, cleared: false, stuck: false,
    seconds: 0, deaths: 0, kills: 0, combatSeconds: 0,
    drops: { normal: 0, magic: 0, rare: 0, unique: 0, currency: 0, waystone: 0 },
    magicPlusAt: [], levelStart: progress(g).level, levelEnd: 0, casts: {}, flasks: 0,
  };
  const seenItems = new Set<Entity>(g.world.query("item"));
  const bosses = g.world.query("boss");
  let monsters = new Set<Entity>(g.world.query("monster"));
  let wasDead = false;
  let clearedAt = -1;
  let lastCast = -HZ;
  const start = g.sim.tick;

  for (let t = 0; t < MAP_CAP_TICKS; t++) {
    const before = { cds: { ...cooldowns(g) }, flasks: flaskCharges(g) };
    g.sim.step(bot.decide(clearedAt >= 0));
    opts.trace?.(g.world, g.player, g.sim.tick - start);
    const now = sess(g);
    if (now.area !== "map") break; // died out of portals: sent home

    for (const [id, until] of Object.entries(cooldowns(g))) {
      if (until !== before.cds[id]) { run.casts[id] = (run.casts[id] ?? 0) + 1; lastCast = t; }
    }
    if (flaskCharges(g) < before.flasks) run.flasks++;
    if (now.dead === 1 && !wasDead) run.deaths++;
    wasDead = now.dead === 1;

    const alive = new Set<Entity>(g.world.query("monster"));
    for (const m of monsters) if (!alive.has(m)) run.kills++;
    monsters = alive;

    for (const e of g.world.query("item")) {
      if (seenItems.has(e)) continue;
      seenItems.add(e);
      const item = g.world.get<ItemC>(e, "item")!.item;
      if (item.waystone) run.drops.waystone++;
      else if (isCurrency(item)) run.drops.currency++;
      else {
        run.drops[item.rarity]++;
        if (item.rarity !== "normal") run.magicPlusAt.push((g.sim.tick - start) / HZ);
      }
    }
    if (t - lastCast < HZ) run.combatSeconds += 1 / HZ;

    if (clearedAt < 0 && bosses.length > 0 && bosses.every((b) => !g.world.alive.has(b))) {
      clearedAt = g.sim.tick;
      run.cleared = true;
      run.seconds = (clearedAt - start) / HZ;
    }
    // After the boss: a few seconds to sweep the payout off the floor, then home.
    if (clearedAt >= 0 && (g.sim.tick - clearedAt > 60 * HZ || !bot.hasLootLeft())) break;
  }
  if (!run.cleared) {
    run.seconds = (g.sim.tick - start) / HZ;
    run.stuck = sess(g).area === "map";
  }
  run.levelEnd = progress(g).level;
  // Walking through the return portal: the same session edit the click makes.
  g.world.set<SessionC>(g.session, "session", { ...sess(g), pendingArea: "hideout", mapOpen: 0, dead: 0 });
  g.sim.step([]);
  return run;
}

/** `maps` maps in a row on one character, carrying level, gems and stones forward. */
export function campaign(classId: string, seed: number, maps: number, opts: BotOptions = {}, level = 1): MapRun[] {
  const g = newCharacter(classId, seed, level);
  const runs: MapRun[] = [];
  for (let i = 0; i < maps; i++) {
    const r = playNextMap(g, opts);
    if (!r) break;
    runs.push(r);
  }
  return runs;
}

// ── Between maps ─────────────────────────────────────────────────────────────

/** What a caster wants from a stat, per point; anything unlisted is worth nothing. */
const STAT_WEIGHT: Record<string, number> = {
  maxLife: 1, energyShield: 1, spellDamagePct: 2, castSpeedPct: 2, critChancePct: 0.5,
  fireResPct: 0.5, coldResPct: 0.5, lightningResPct: 0.5, chaosResPct: 0.3,
  armour: 0.1, armourPct: 0.3, maxMana: 0.3, manaRegenPct: 0.3, strength: 0.3,
};
const score = (item: Item) => itemStatMods(item).reduce((a, m) => a + (STAT_WEIGHT[m.stat] ?? 0) * m.value, 0);

/**
 * The hideout visit: wear every upgrade in the bag (through the real equipItem
 * command), then empty the bag of equipment. Emptying stands in for the vendor
 * and the stash, which change nothing a map run measures.
 */
function refit(g: Game): void {
  const inv = () => g.world.get<InventoryC>(g.session, "inventory")!;
  for (const placed of [...inv().items]) {
    if (placed.item.waystone || isCurrency(placed.item)) continue;
    const slots = EQUIP_SLOTS_BY_CLASS[baseOf(placed.item.baseId).itemClass] ?? [];
    const worn = g.world.get<EquipmentC>(g.session, "equipment")!.slots;
    const slot = slots.find((sl) => !worn[sl] || score(placed.item) > score(worn[sl]!));
    if (!slot) continue;
    g.sim.step([{ tick: g.sim.tick, entity: g.player, type: "equipItem", slot: slot as EquipSlotId, data: { x: placed.x, y: placed.y } }]);
  }
  const kept = inv().items.filter((p) => p.item.waystone || isCurrency(p.item));
  g.world.set<InventoryC>(g.session, "inventory", { ...inv(), items: kept });
}

// ── Opening a map ────────────────────────────────────────────────────────────

/**
 * Use the best stone on the lowest-tier node not yet cleared, falling back to a
 * cleared one (PoE1's rule: you can always go back). Returns false when no stone
 * opens anything.
 */
function openMap(g: Game): boolean {
  const s = sess(g);
  const graph = atlasGraph(s.atlasSeed);
  const inv = g.world.get<InventoryC>(g.session, "inventory")!;
  const stones = inv.items.filter((p) => p.item.waystone).sort((a, b) => b.item.waystone!.tier - a.item.waystone!.tier);
  if (stones.length === 0) return false;
  const best = stones[0]!.item.waystone!.tier;
  const open = graph
    .filter((n) => isNodeReachable(graph, s.completedNodes, n.id) && atlasNodeTier(graph, n.id) <= best)
    .sort((a, b) => {
      const ca = s.completedNodes.includes(a.id) ? 1 : 0;
      const cb = s.completedNodes.includes(b.id) ? 1 : 0;
      return ca - cb || atlasNodeTier(graph, a.id) - atlasNodeTier(graph, b.id);
    });
  const node = open[0];
  if (!node) return false;
  // The cheapest stone that still opens the node, so the good ones are saved.
  const need = atlasNodeTier(graph, node.id);
  const stone = [...stones].reverse().find((p) => p.item.waystone!.tier >= need)!;
  g.sim.step([{ tick: g.sim.tick, type: "activateMap", atlasNodeId: node.id, data: { x: stone.x, y: stone.y } }]);
  if (sess(g).mapOpen !== 1) return false;
  // Stepping into the ring: the same session edit the portal click makes.
  g.world.set<SessionC>(g.session, "session", { ...sess(g), pendingArea: "map" });
  g.sim.step([]);
  return sess(g).area === "map";
}

// ── The bot ──────────────────────────────────────────────────────────────────

class Bot {
  private readonly body: number;
  private readonly attack: string;
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

  constructor(private readonly g: Game, private readonly collision: Collision, opts: BotOptions) {
    this.body = g.world.get<PlayerC>(g.player, "player")!.bodyRadius;
    this.attack = DEFAULT_ATTACK_BY_CLASS[g.classId]!;
    this.melee = SKILLS.get(this.attack)!.effects.some((e) => e.type === "meleeStrike");
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
      if (!this.melee && near && dist(p, near.p) < fp(2.5) && !world.has(near.e, "boss")) {
        out.push(cmd({ type: "moveTo", data: this.escape(p, near.p, fp(2.5)) }));
      } else if (!skill || (skill === this.attack && this.melee && dist(p, target.p) > this.reach())) {
        const to = this.route(p, target.p);
        if (to) out.push(cmd({ type: "moveTo", data: to }));
      } else {
        out.push(cmd({ type: "stop" }));
      }
      return out;
    }

    // 3. Nothing in reach: loot, then chests, then the nearest monster.
    const goal = this.pickGoal(p, bossDead);
    if (!goal) return out;
    if (dist(p, goal.p) <= goal.radius) {
      out.push(cmd(goal.kind === "item"
        ? { type: "pickupItem", data: { entityId: goal.e } }
        : { type: "interact", data: { targetId: goal.e } }));
      // A full bag or a no-op interact would hold the bot here forever.
      if (tick - this.goalSince > HZ) this.skip.set(goal.e, tick + 60 * HZ);
      return out;
    }
    const to = this.route(p, goal.p);
    // No route at all: behind water or in a pocket the body does not fit.
    if (!to) { this.skip.set(goal.e, tick + 60 * HZ); return out; }
    out.push(cmd({ type: "moveTo", data: to }));
    return out;
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

  /** Stand-off distance: what Ember Bolt reaches, or a ranged class's own attack if that is shorter. */
  private range(): number {
    const reachOf = (id: string) => {
      const e = SKILLS.get(id)!.effects.find((x) => x.type === "spawnProjectile");
      return e && e.type === "spawnProjectile" ? e.maxRangeFixed : Infinity;
    };
    const r = Math.min(reachOf(BOLT), this.melee ? Infinity : reachOf(this.attack));
    return r === Infinity ? fp(12) : Math.trunc(r * 0.8);
  }

  private reach(): number {
    const s = SKILLS.get(this.attack)!.effects.find((e) => e.type === "meleeStrike");
    return s && s.type === "meleeStrike" ? s.reachFixed + fp(0.3) : fp(1.5);
  }

  /** Nearest awake monster with a clear line, re-chosen only at human speed. */
  private pickTarget(p: Position, tick: number, bossDead: boolean): { e: Entity; p: Position } | undefined {
    const w = this.g.world;
    if (this.target !== undefined && w.alive.has(this.target) && tick - this.targetAt < REACTION_TICKS) {
      const tp = w.get<Position>(this.target, "position")!;
      if (dist(p, tp) < this.range()) return { e: this.target, p: tp };
    }
    // With the boss down the map is over: only what comes at him is worth a shot.
    const seen = this.monsters()
      .filter((x) => (!bossDead || x.awake) && dist(p, x.p) < this.range() && hasLineOfSight(this.collision, p.x, p.y, x.p.x, x.p.y, AIM_CLEARANCE))
      .sort((a, b) => Number(b.awake) - Number(a.awake) || dist(p, a.p) - dist(p, b.p));
    const t = seen[0];
    this.target = t?.e;
    this.targetAt = tick;
    return t;
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

  /** Field under a pack or a big body, bolt while mana lasts, the free attack otherwise. */
  private pickSkill(p: Position, t: { e: Entity; p: Position }): string | undefined {
    const w = this.g.world;
    const packed = this.monsters().filter((x) => dist(t.p, x.p) < fp(2.5)).length >= 2;
    const big = w.has(t.e, "boss") || w.get<MonsterC>(t.e, "monster")!.rare === 1;
    if ((packed || big) && this.ready(GROUND)) return GROUND;
    if (this.ready(BOLT)) return BOLT;
    if (this.melee && dist(p, t.p) > this.reach()) return undefined;
    return this.onBar(this.attack) ? this.attack : undefined;
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
    for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
      const x = p.x + Math.round(Math.cos(base + turn) * d);
      const y = p.y + Math.round(Math.sin(base + turn) * d);
      if (this.collision.isWalkable(x, y, this.body) && hasLineOfSight(this.collision, p.x, p.y, x, y, this.body)) {
        return { x, y, tx: x, ty: y };
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

// ── Small readers ───────────────────────────────────────────────────────────

function sess(g: Game): SessionC { return g.world.get<SessionC>(g.session, "session")!; }
function progress(g: Game): ProgressC { return g.world.get<ProgressC>(g.session, "progress")!; }
function cooldowns(g: Game): Cooldowns { return g.world.get<Cooldowns>(g.player, "cooldowns") ?? {}; }
function flaskCharges(g: Game): number {
  const f = g.world.get<FlasksC>(g.player, "flasks");
  return f ? f.lifeCharges + f.manaCharges : 0;
}
function dist(a: Position, b: Position): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ── Reporting ───────────────────────────────────────────────────────────────

export interface Summary {
  maps: number;
  clearRate: number;
  deathsPerMap: number;
  meanClearSec: number;
  killsPerCombatSec: number;
  /** Mean seconds between magic-or-better equipment drops. */
  magicPlusGapSec: number;
  raresPerMap: number;
}

export function summarize(runs: readonly MapRun[]): Summary {
  const n = runs.length || 1;
  const sum = (f: (r: MapRun) => number) => runs.reduce((a, r) => a + f(r), 0);
  const cleared = runs.filter((r) => r.cleared);
  const magicPlus = sum((r) => r.magicPlusAt.length);
  return {
    maps: runs.length,
    clearRate: cleared.length / n,
    deathsPerMap: sum((r) => r.deaths) / n,
    meanClearSec: cleared.reduce((a, r) => a + r.seconds, 0) / (cleared.length || 1),
    killsPerCombatSec: sum((r) => r.kills) / (sum((r) => r.combatSeconds) || 1),
    magicPlusGapSec: sum((r) => r.seconds) / (magicPlus || 1),
    raresPerMap: sum((r) => r.drops.rare + r.drops.unique) / n,
  };
}

