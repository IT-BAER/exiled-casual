import { fp } from "@pact/fixed-point";
import { baseCasterStats, makeRare } from "@pact/rules";
import { SKILLS, MONSTERS, RARE_TEMPLATE } from "@pact/content-runtime";
import type { MonsterDef } from "@pact/content-schema";
import { Simulation } from "./loop";
import { World } from "./ecs";
import type { Entity } from "./ecs";
import type {
  Position, Health, Mana, Faction, PlayerC, Cooldowns, DefensesC,
  MoveTarget, MoveDir, MonsterC, BossC,
} from "./components";
import { registerResourceRegen } from "./systems/resource";
import { registerSkillCast } from "./systems/skill-cast";
import { registerPlayerMovement } from "./systems/player-movement";
import { registerMonsterAI } from "./systems/monster-ai";
import { registerBossAI } from "./systems/boss-ai";
import { registerProjectileMove } from "./systems/projectile";
import { registerGroundAreaTick } from "./systems/ground-area";
import { registerTelegraphResolve } from "./systems/telegraph-resolve";
import { registerAilmentTick } from "./systems/ailment";
import { registerDamageResolve } from "./systems/damage-resolve";
import { registerDeath } from "./systems/death";
import { registerExpiry } from "./systems/expiry";

// ponytail: _seed unused by Phase C2 systems; reserved for Phase C3 RNG-driven monster variance.
export function createCombatSim(
  _seed: number,
  opts: { boss?: boolean; monsters?: boolean } = {},
): { sim: Simulation; world: World; playerEntity: Entity } {
  const sim = new Simulation();
  const { world } = sim;

  // ── Register systems in canonical order ──────────────────────────────────
  registerResourceRegen(sim);
  registerSkillCast(sim, SKILLS);
  registerPlayerMovement(sim);
  registerMonsterAI(sim);
  registerBossAI(sim, MONSTERS);
  registerProjectileMove(sim);
  registerGroundAreaTick(sim);
  // Impacts land before damageResolve so a telegraph hits on its own impact tick.
  registerTelegraphResolve(sim);
  registerAilmentTick(sim);
  registerDamageResolve(sim);
  registerDeath(sim);
  registerExpiry(sim);

  // ── Bootstrap player ─────────────────────────────────────────────────────
  const s = baseCasterStats();
  const playerEntity = world.create();
  world.set<Position>(playerEntity, "position", { x: 0, y: 0 });
  world.set<Health>(playerEntity, "health", { life: s.maxLifeFixed, maxLife: s.maxLifeFixed });
  world.set<Mana>(playerEntity, "mana", {
    mana: s.maxManaFixed,
    maxMana: s.maxManaFixed,
    regen: Math.trunc(s.manaRegenPerSecFixed / 30),
  });
  world.set<Faction>(playerEntity, "faction", { team: 0 });
  world.set<PlayerC>(playerEntity, "player", {
    moveSpeed: Math.trunc(s.moveSpeedFixed / 30),
    bodyRadius: fp(0.5),
  });
  world.set<Cooldowns>(playerEntity, "cooldowns", {});
  world.set<DefensesC>(playerEntity, "defenses", {
    fireResPct: s.fireResPct,
    armour: s.armourFixed,
  });
  world.set<MoveTarget>(playerEntity, "moveTarget", { x: 0, y: 0, active: 0 });
  world.set<MoveDir>(playerEntity, "moveDir", { dx: 0, dy: 0 });

  // ── Bootstrap monsters ────────────────────────────────────────────────────
  // Default on: the golden replay scenarios anchor on this exact composition.
  // The lab opts out and spawns on demand instead, so a model or an effect can
  // be inspected without a pack chewing on the player.
  if (opts.monsters !== false) {
    const impDef = MONSTERS.get("monster.cinder_imp.v1")!;

    const normalCoords: [number, number][] = [
      [fp(5), fp(0)], [fp(-5), fp(0)],
      [fp(0), fp(5)], [fp(0), fp(-5)],
      [fp(6), fp(6)],
    ];
    for (const [x, y] of normalCoords) {
      spawnMonster(world, impDef, x, y, false);
    }

    const rareDef = makeRare(impDef, RARE_TEMPLATE);
    spawnMonster(world, rareDef, fp(8), fp(8), true);
  }

  if (opts.boss) {
    const wardenDef = MONSTERS.get("monster.cinder_warden.v1")!;
    spawnMonster(world, wardenDef, fp(0), fp(12), false);
  }

  return { sim, world, playerEntity };
}

/**
 * Ring offsets for a spawned pack. Literal fixed-point, not trig: the sim must
 * never depend on an engine's Math.cos rounding.
 */
const PACK_RING: readonly [number, number][] = [
  [fp(0), fp(6)],
  [fp(5.7), fp(1.85)],
  [fp(3.53), fp(-4.85)],
  [fp(-3.53), fp(-4.85)],
  [fp(-5.7), fp(1.85)],
];

/**
 * Drop actors into a running world, on a ring around (cx, cy).
 *
 * Lab tooling, driven by a debug keybind. It mutates between ticks rather than
 * inside a system, so it is deliberately not part of any recorded scenario —
 * a replay that used it would not reproduce.
 */
export function spawnLabActors(
  world: World,
  kind: "imp" | "pack" | "rare" | "boss" | "clear",
  cx: number,
  cy: number,
): void {
  if (kind === "clear") {
    for (const e of [...world.query("monster")]) world.destroy(e);
    return;
  }

  const impDef = MONSTERS.get("monster.cinder_imp.v1")!;
  switch (kind) {
    case "imp":
      spawnMonster(world, impDef, cx, cy + fp(6), false);
      break;
    case "pack":
      for (const [dx, dy] of PACK_RING) spawnMonster(world, impDef, cx + dx, cy + dy, false);
      break;
    case "rare":
      spawnMonster(world, makeRare(impDef, RARE_TEMPLATE), cx, cy + fp(7), true);
      break;
    case "boss":
      spawnMonster(world, MONSTERS.get("monster.cinder_warden.v1")!, cx, cy + fp(10), false);
      break;
  }
}

function spawnMonster(
  world: World,
  def: MonsterDef,
  x: number,
  y: number,
  rare: boolean,
): Entity {
  const e = world.create();
  world.set<Position>(e, "position", { x, y });
  world.set<Health>(e, "health", { life: def.maxLifeFixed, maxLife: def.maxLifeFixed });
  world.set<Faction>(e, "faction", { team: 1 });
  world.set<MonsterC>(e, "monster", {
    defId: def.id,
    moveSpeed: Math.trunc(def.moveSpeedFixed / 30),
    bodyRadius: def.radiusFixed,
    attackRange: def.attackRangeFixed,
    attackCooldownTicks: def.attackCooldownTicks,
    attackDamage: def.attackDamage.amountFixed,
    attackType: def.attackDamage.type === "fire" ? 0 : 1,
    attackReadyTick: 0,
    state: "idle",
    rare: rare ? 1 : 0,
    summoned: 0,
  });
  world.set<DefensesC>(e, "defenses", {
    fireResPct: def.defenses.fireResPct,
    armour: def.defenses.armourFixed,
  });
  if (def.boss) {
    world.set<BossC>(e, "boss", {
      phase: 1,
      nextAbilityTick: 0,
      spawnX: x,
      spawnY: y,
      rootedUntilTick: 0,
    });
  }
  return e;
}
