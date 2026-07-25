import { fpClamp, fpStepToward } from "@exiled/fixed-point";
import { createStream } from "../rng";
import { scalePct } from "@exiled/rules";
import type { SkillDef } from "@exiled/content-schema";
import { Simulation } from "../loop";
import { WORLD_MIN, WORLD_MAX } from "../movement";
import { type CollisionRef } from "../collision";
import type { Position, PlayerC, Mana, Faction, Cooldowns, ProjectileC, GroundAreaC, CastingC, OffenseC } from "../components";
import { damageCode } from "../damage-types";

export function registerSkillCast(
  sim: Simulation,
  skills: ReadonlyMap<string, SkillDef>,
  collisionRef?: CollisionRef,
  seed = 0,
): void {
  // One stream for every crit roll in the run. It is only drawn from when the
  // skill has a base crit chance at all, so a kit that cannot crit consumes no
  // randomness and replays from before crit existed still check out.
  const critRolls = createStream(seed, "crit");

  sim.register("skillCast", (world, tick, commands) => {
    const collision = collisionRef?.active ?? undefined;
    for (const cmd of commands) {
      if (cmd.type !== "useSkill" || cmd.entity === undefined || !cmd.skillId) continue;
      const caster = cmd.entity;
      const skill = skills.get(cmd.skillId);
      if (!skill) continue;

      const cds = world.get<Cooldowns>(caster, "cooldowns") ?? {};
      if ((cds[cmd.skillId] ?? 0) > tick) continue; // on cooldown

      const offense = world.get<OffenseC>(caster, "offense");
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
      // Gear's "% increased Cast Speed" shortens it the way PoE does — cast speed
      // is 1/cast time, and increases add together before they divide — and the
      // skill's cooldown is deliberately left alone, which is PoE's rule too.
      if (skill.castTicks && skill.castTicks > 0) {
        const castSpeedPct = offense?.castSpeedPct ?? 0;
        const ticks = Math.max(1, Math.trunc((skill.castTicks * 100) / (100 + castSpeedPct)));
        world.set<CastingC>(caster, "casting", { untilTick: tick + ticks });
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

      // Gear's "% increased Spell Damage" scales the hit, and only the hit: in PoE
      // a damaging ailment scales off its own mods, not the spell damage that lit
      // it, so Cinder Ground's burning dps below is deliberately left alone.
      const spellDamagePct = offense?.spellDamagePct ?? 0;

      // PoE crit: the skill brings the base chance, gear's "% increased Critical
      // Strike Chance" multiplies it rather than adding to it, so 8% with +25%
      // is 10% and not 33%. Rolled in hundredths of a percent to keep that
      // fraction, once per cast, and only for a skill that can crit at all.
      // The bonus is PoE's own base 100% Critical Damage Bonus: a crit is 200%
      // of the hit. Ailments below are left alone, as they are for spell damage.
      const baseCritPct = skill.critChancePct ?? 0;
      const didCrit = baseCritPct > 0
        && critRolls.nextInt(0, 9999) < scalePct(baseCritPct * 100, offense?.critChancePct ?? 0);

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
            damageType: damageCode(effect.damage.type),
            damageAmount: scalePct(effect.damage.amountFixed, spellDamagePct) * (didCrit ? 2 : 1),
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
