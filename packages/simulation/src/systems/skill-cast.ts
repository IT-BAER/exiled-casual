import { fpClamp, fpStepToward } from "@exiled/fixed-point";
import type { SkillDef } from "@exiled/content-schema";
import { Simulation } from "../loop";
import { WORLD_MIN, WORLD_MAX } from "../movement";
import { type CollisionRef } from "../collision";
import type { Position, PlayerC, Mana, Faction, Cooldowns, ProjectileC, GroundAreaC, CastingC } from "../components";

export function registerSkillCast(
  sim: Simulation,
  skills: ReadonlyMap<string, SkillDef>,
  collisionRef?: CollisionRef,
): void {
  sim.register("skillCast", (world, tick, commands) => {
    const collision = collisionRef?.active ?? undefined;
    for (const cmd of commands) {
      if (cmd.type !== "useSkill" || cmd.entity === undefined || !cmd.skillId) continue;
      const caster = cmd.entity;
      const skill = skills.get(cmd.skillId);
      if (!skill) continue;

      const cds = world.get<Cooldowns>(caster, "cooldowns") ?? {};
      if ((cds[cmd.skillId] ?? 0) > tick) continue; // on cooldown

      const manaComp = world.get<Mana>(caster, "mana");
      if (!manaComp || manaComp.mana < skill.manaCostFixed) continue; // insufficient mana

      // Spend mana and set cooldown.
      world.set<Mana>(caster, "mana", {
        mana: manaComp.mana - skill.manaCostFixed,
        maxMana: manaComp.maxMana,
        regen: manaComp.regen,
      });
      world.set<Cooldowns>(caster, "cooldowns", {
        ...cds,
        [cmd.skillId]: tick + skill.cooldownTicks,
      });

      // Post-cast recovery: effect still fires this tick (below), but the caster
      // is slowed until untilTick. Instant skills (castTicks 0/absent) skip this.
      if (skill.castTicks && skill.castTicks > 0) {
        world.set<CastingC>(caster, "casting", { untilTick: tick + skill.castTicks });
      }

      // NOTE (ordering edge case): mana is spent and cooldown is set before the
      // pos/aim guards below. A caster with no Position component, or one aiming
      // exactly on itself, will consume mana and cooldown with no spawned effect.
      // Test casters always have Position; this is per-brief verbatim ordering.

      const pos = world.get<Position>(caster, "position");
      if (!pos) continue;
      const faction = world.get<Faction>(caster, "faction");
      const casterTeam = faction?.team ?? 0;

      const tx = cmd.data?.["tx"] ?? 0;
      const ty = cmd.data?.["ty"] ?? 0;

      for (const effect of skill.effects) {
        if (effect.type === "spawnProjectile") {
          const speedPerTick = Math.trunc(effect.speedPerSecFixed / 30);
          const step = fpStepToward(pos.x, pos.y, tx, ty, speedPerTick);
          if (step.dx === 0 && step.dy === 0) continue; // aim on top of caster

          const proj = world.create();
          world.set<Position>(proj, "position", { x: pos.x, y: pos.y });
          world.set<ProjectileC>(proj, "projectile", {
            dirx: step.dx,
            diry: step.dy,
            remainingRange: effect.maxRangeFixed,
            radius: effect.radiusFixed,
            damageType: effect.damage.type === "fire" ? 0 : 1,
            damageAmount: effect.damage.amountFixed,
            ownerId: caster,
            team: casterTeam,
          });
        } else if (effect.type === "spawnGroundArea") {
          const gx = fpClamp(tx, WORLD_MIN, WORLD_MAX);
          const gy = fpClamp(ty, WORLD_MIN, WORLD_MAX);
          const area = world.create();
          world.set<Position>(area, "position", { x: gx, y: gy });
          world.set<GroundAreaC>(area, "groundArea", {
            radius: effect.radiusFixed,
            expiryTick: tick + effect.durationTicks,
            nextTick: tick,
            ailmentKind: effect.ailment.kind,
            stacksPerApply: effect.ailment.stacksPerApply,
            dps: effect.ailment.dpsFixed,
            ailmentDuration: effect.ailment.durationTicks,
            maxStacks: effect.ailment.maxStacks,
            team: casterTeam,
          });
        } else if (effect.type === "teleport") {
          const step = fpStepToward(pos.x, pos.y, tx, ty, effect.distanceFixed);
          let dx = step.dx;
          let dy = step.dy;
          if (collision) {
            // Blink must not land inside a wall: shorten the hop along its own
            // vector to the farthest walkable point, or stay put if none is.
            const body = world.get<PlayerC>(caster, "player")?.bodyRadius ?? 0;
            dx = 0;
            dy = 0;
            for (const [num, den] of [[1, 1], [3, 4], [1, 2], [1, 4]] as const) {
              const cx = pos.x + Math.trunc((step.dx * num) / den);
              const cy = pos.y + Math.trunc((step.dy * num) / den);
              if (collision.isWalkable(cx, cy, body)) { dx = cx - pos.x; dy = cy - pos.y; break; }
            }
          }
          world.set<Position>(caster, "position", {
            x: fpClamp(pos.x + dx, WORLD_MIN, WORLD_MAX),
            y: fpClamp(pos.y + dy, WORLD_MIN, WORLD_MAX),
          });
        }
      }
    }
  });
}
