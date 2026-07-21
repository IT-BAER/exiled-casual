import { fp } from "@pact/fixed-point";
import { baseCasterStats, makeRare } from "@pact/rules";
import { SKILLS, MONSTERS, RARE_TEMPLATE, CONTENT_VERSION } from "@pact/content-runtime";
import { generateArea, type AreaLayout } from "@pact/mapgen";
import { gridCollision, type CollisionRef } from "./collision";
import { Simulation } from "./loop";
import { World } from "./ecs";
import type { Entity } from "./ecs";
import type {
  Position, Health, Mana, Faction, PlayerC, Cooldowns, DefensesC,
  MoveTarget, MoveDir, SessionC, AreaKind,
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
import { registerInteractSystem } from "./systems/interact";
import { registerAreaTransition } from "./systems/area-transition";
import { buildArea, spawnMonster } from "./areas";

export function createCombatSim(
  seed: number,
  opts: { boss?: boolean; monsters?: boolean; area?: AreaKind; layout?: AreaLayout } = {},
): { sim: Simulation; world: World; playerEntity: Entity; layout: AreaLayout } {
  const sim = new Simulation();
  const { world } = sim;

  // Generate the indoor layout (or accept an injected one — the boss golden and
  // Phase D's areaTransition pass a pre-built layout). Collision is only wired
  // for the "map" area; the hideout lab and legacy paths stay world-bounded.
  const layout = opts.layout ?? generateArea(seed, CONTENT_VERSION);
  // One mutable holder shared by every movement system AND the area-transition
  // system, so walking hideout → map turns collision on mid-session (and off on
  // the way back) without re-registering systems.
  const collisionRef: CollisionRef = {
    active: opts.area === "map" ? gridCollision(layout.grid) : null,
  };

  // ── Register systems in canonical order ──────────────────────────────────
  registerResourceRegen(sim);
  registerSkillCast(sim, SKILLS, collisionRef);
  registerPlayerMovement(sim, collisionRef);
  registerMonsterAI(sim, collisionRef);
  registerBossAI(sim, MONSTERS, collisionRef);
  registerProjectileMove(sim);
  registerGroundAreaTick(sim);
  // Impacts land before damageResolve so a telegraph hits on its own impact tick.
  registerTelegraphResolve(sim);
  registerAilmentTick(sim);
  registerDamageResolve(sim);
  registerDeath(sim);
  registerExpiry(sim);

  // ── Bootstrap player ─────────────────────────────────────────────────────
  // On the generated map the player starts at the "start" socket; every other
  // path keeps the origin spawn its tests and hand-built areas rely on.
  const spawn = opts.area === "map" ? anchorFp(layout, "start") : { x: 0, y: 0 };
  const s = baseCasterStats();
  const playerEntity = world.create();
  world.set<Position>(playerEntity, "position", { x: spawn.x, y: spawn.y });
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
  world.set<MoveTarget>(playerEntity, "moveTarget", { x: spawn.x, y: spawn.y, active: 0 });
  world.set<MoveDir>(playerEntity, "moveDir", { dx: 0, dy: 0 });

  if (opts.area !== undefined) {
    // ── Area-based path: session singleton + buildArea ────────────────────
    const sessionE = world.create();
    const session: SessionC = {
      area: opts.area,
      mapSeed: seed,
      portalsLeft: 0,
      mapOpen: 0,
      pendingArea: "",
    };
    world.set<SessionC>(sessionE, "session", session);
    buildArea(world, opts.area, session, layout);

    // New systems only needed for area-based sims. Appended to preserve the
    // canonical ordering of the first 12 systems (checked by legacy tests).
    registerInteractSystem(sim);
    registerAreaTransition(sim, collisionRef);
  } else {
    // ── Legacy path: no session, golden-replay–safe bootstrap ────────────
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
  }

  return { sim, world, playerEntity, layout };
}

/** A layout objective anchor, converted to fixed-point at the sim boundary. */
function anchorFp(layout: AreaLayout, id: string): { x: number; y: number } {
  const a = layout.objectiveAnchors.find((s) => s.id === id)!;
  return { x: fp(a.x), y: fp(a.y) };
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
  kind: "imp" | "pack" | "rare" | "boss" | "clear" | "hurtboss",
  cx: number,
  cy: number,
): void {
  if (kind === "clear") {
    for (const e of [...world.query("monster")]) world.destroy(e);
    return;
  }

  if (kind === "hurtboss") {
    // Lab-only: chip 20% of maxLife off every boss so the phase-2 transition and
    // death can be driven for visual QA without a full mana-limited fight. Bypasses
    // resistances by design (debug damage) and clamps at 0 rather than going negative.
    for (const e of world.query("boss")) {
      const h = world.get<Health>(e, "health");
      if (h) {
        world.set<Health>(e, "health", { ...h, life: Math.max(0, h.life - Math.trunc((h.maxLife * 20) / 100)) });
      }
    }
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

// Re-export spawnMonster for callers that may import it from this module.
export { spawnMonster };
