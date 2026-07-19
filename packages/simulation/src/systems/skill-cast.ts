import { fpClamp, fpStepToward } from "@pact/fixed-point";
import type { SkillDef } from "@pact/content-schema";
import { Simulation } from "../loop";
import { WORLD_MIN, WORLD_MAX } from "../movement";
import type { Position, Mana, Faction, Cooldowns, ProjectileC, GroundAreaC } from "../components";

export function registerSkillCast(sim: Simulation, skills: ReadonlyMap<string, SkillDef>): void {
  sim.register("skillCast", (world, tick, commands) => {
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
          });
        } else if (effect.type === "teleport") {
          const step = fpStepToward(pos.x, pos.y, tx, ty, effect.distanceFixed);
          world.set<Position>(caster, "position", {
            x: fpClamp(pos.x + step.dx, WORLD_MIN, WORLD_MAX),
            y: fpClamp(pos.y + step.dy, WORLD_MIN, WORLD_MAX),
          });
        }
      }
    }
  });
}
