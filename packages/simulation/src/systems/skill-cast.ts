import { fpClamp, fpStepToward, isqrt } from "@exiled/fixed-point";
import { createStream } from "../rng";
import { scalePct } from "@exiled/rules";
import type { SkillDef } from "@exiled/content-schema";
import { Simulation } from "../loop";
import type { World } from "../ecs";
import { WORLD_MIN, WORLD_MAX } from "../movement";
import { sweep, type Collision, type CollisionRef } from "../collision";
import type { Position, PlayerC, Mana, Faction, Cooldowns, ProjectileC, GroundAreaC, CastingC, OffenseC, Health, SkillHoldC } from "../components";
import { damageCode } from "../damage-types";
import { bodyRadiusOf } from "../body";
import { spendScrollAndOpenPortal } from "../areas";

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

  // How long one useSkill command counts as "still holding the button". The
  // client re-issues per 30 Hz snapshot while held, so three ticks bridges any
  // jitter without dragging the slow walk past the release.
  const SKILL_HOLD_TICKS = 3;

  const actionFor = (skill: SkillDef): "spell" | "melee" =>
    skill.effects.some((effect) => effect.type === "meleeStrike") ? "melee" : "spell";

  function resolveSkill(
    world: World,
    tick: number,
    caster: number,
    skill: SkillDef,
    tx: number,
    ty: number,
    spellDamagePct: number,
    didCrit: boolean,
    casterTeam: number,
    collision: Collision | undefined,
  ): void {
    const pos = world.get<Position>(caster, "position");
    if (!pos) return;

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
        // Aimed past a wall, the patch lands on the wall instead of in the room
        // behind it. The centre is swept as a point, so the circle may lick over
        // the rock but cannot be placed through it.
        let ax = tx;
        let ay = ty;
        if (collision) {
          const reach = sweep(collision, pos.x, pos.y, tx - pos.x, ty - pos.y, 0);
          ax = pos.x + reach.dx;
          ay = pos.y + reach.dy;
        }
        const gx = fpClamp(ax, WORLD_MIN, WORLD_MAX);
        const gy = fpClamp(ay, WORLD_MIN, WORLD_MAX);
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
      } else if (effect.type === "meleeStrike") {
        // No entity and no flight: the swing resolves inside the cast, which is
        // what lets it hit several targets where a projectile stops at the first.
        const ax = tx - pos.x;
        const ay = ty - pos.y;
        const aimLen = isqrt(ax * ax + ay * ay);
        if (aimLen === 0) continue;

        // The wedge test is a dot product against cos(half-arc), not atan2, so
        // the comparison stays deterministic fixed-point integer math.
        const cosHalfArc = Math.round(Math.cos((effect.arcDegrees / 2) * Math.PI / 180) * 10000);
        for (const target of world.query("position", "health", "faction")) {
          if (target === caster) continue;
          if (world.get<Faction>(target, "faction")!.team === casterTeam) continue;
          const tpos = world.get<Position>(target, "position")!;
          const dx = tpos.x - pos.x;
          const dy = tpos.y - pos.y;
          const reach = effect.reachFixed + bodyRadiusOf(world, target);
          const dist2 = dx * dx + dy * dy;
          if (dist2 > reach * reach) continue;

          const dLen = isqrt(dist2);
          if (dLen > 0) {
            const cos = Math.trunc((ax * dx + ay * dy) * 10000 / (aimLen * dLen));
            if (cos < cosHalfArc) continue;
          }

          sim.enqueueDamage({
            target,
            source: caster,
            amountFixed: scalePct(effect.damage.amountFixed, spellDamagePct) * (didCrit ? 2 : 1),
            type: damageCode(effect.damage.type),
          });
        }
      } else if (effect.type === "teleport") {
        const step = fpStepToward(pos.x, pos.y, tx, ty, effect.distanceFixed);
        let dx = step.dx;
        let dy = step.dy;
        if (collision) {
          // Blink must not land inside a wall and must not cross one.
          const body = world.get<PlayerC>(caster, "player")?.bodyRadius ?? 0;
          const reach = sweep(collision, pos.x, pos.y, step.dx, step.dy, body);
          dx = reach.dx;
          dy = reach.dy;
        }
        world.set<Position>(caster, "position", {
          x: fpClamp(pos.x + dx, WORLD_MIN, WORLD_MAX),
          y: fpClamp(pos.y + dy, WORLD_MIN, WORLD_MAX),
        });
      } else if (effect.type === "openPortal") {
        // The one effect that spends something other than mana, so it is the one
        // that can fail at the END of its own cast: a scroll can be dropped, or
        // the map can close, in the two seconds the doorway takes to tear open.
        // A failure refunds the cooldown — the player pressed a key and got
        // nothing, and charging ten seconds for nothing is how a hotkey earns a
        // reputation for being broken.
        if (!spendScrollAndOpenPortal(world, caster)) {
          const cds = world.get<Cooldowns>(caster, "cooldowns");
          if (cds) world.set<Cooldowns>(caster, "cooldowns", { ...cds, [skill.id]: 0 });
        }
      }
    }
  }

  sim.register("skillCast", (world, tick, commands) => {
    const collision = collisionRef?.active ?? undefined;
    const completedThisTick = new Set<number>();

    // Resolve completed wind-ups before accepting this tick's input. A held
    // button therefore starts the next cast only after the prior action landed.
    for (const caster of world.query("casting")) {
      const casting = world.get<CastingC>(caster, "casting")!;
      if (casting.untilTick > tick) continue;
      if (casting.skillId) {
        const skill = skills.get(casting.skillId);
        const alive = (world.get<Health>(caster, "health")?.life ?? 1) > 0;
        if (skill && alive) {
          resolveSkill(
            world,
            tick,
            caster,
            skill,
            casting.tx ?? 0,
            casting.ty ?? 0,
            casting.spellDamagePct ?? 0,
            casting.didCrit === 1,
            casting.team ?? world.get<Faction>(caster, "faction")?.team ?? 0,
            collision,
          );
        }
      }
      world.remove(caster, "casting");
      completedThisTick.add(caster);
    }

    for (const cmd of commands) {
      if (cmd.type !== "useSkill" || cmd.entity === undefined || !cmd.skillId) continue;
      const caster = cmd.entity;
      const skill = skills.get(cmd.skillId);
      if (!skill) continue;
      // A corpse does not cast, same rule movement follows. Absent health reads
      // as alive so the health-less test casters are untouched.
      if ((world.get<Health>(caster, "health")?.life ?? 1) <= 0) continue;
      // Every command, refused or not, marks the button as held: the client
      // re-issues per snapshot, so a short window bridges the gaps and movement
      // never bursts back to a run between casts (player-movement reads it).
      world.set<SkillHoldC>(caster, "skillHold", {
        untilTick: tick + SKILL_HOLD_TICKS,
        tx: cmd.data?.["tx"],
        ty: cmd.data?.["ty"],
      });
      if (completedThisTick.has(caster)) continue;

      // A cast is one action, not a queue. Held input can keep issuing commands,
      // but the simulation ignores them until the current wind-up resolves.
      const active = world.get<CastingC>(caster, "casting");
      if (active && active.untilTick > tick) continue;

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

      // The caster is slowed during the wind-up. Instant skills (castTicks
      // 0/absent) skip it. Cast speed shortens the wind-up the way PoE does.
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

      const castSpeedPct = offense?.castSpeedPct ?? 0;
      const timingScale = 100 + castSpeedPct;
      const castTicks = skill.castTicks
        ? timingScale > 0
          ? Math.max(1, Math.trunc((skill.castTicks * 100) / timingScale))
          : skill.castTicks
        : 0;
      // The arm is paced by the beat the player watches, which is the repeat
      // interval and not the wind-up. Holding the button re-fires only once the
      // cooldown is up, so a 0.5s clip squeezed into a 7-tick wind-up sprinted
      // through the swing at twice speed and then stood still for the other 8:
      // read as the cast being far too fast. Whichever of the two is longer is
      // the real gap between one release and the next.
      const beatTicks = Math.max(castTicks, skill.cooldownTicks);
      if (castTicks > 0) {
        world.set<CastingC>(caster, "casting", {
          untilTick: tick + castTicks,
          skillId: skill.id,
          tx,
          ty,
          spellDamagePct,
          didCrit: didCrit ? 1 : 0,
          team: casterTeam,
          action: actionFor(skill),
          ticks: beatTicks,
        });
        continue;
      }

      // No wind-up means this is still an instant skill, such as Blink.
      resolveSkill(world, tick, caster, skill, tx, ty, spellDamagePct, didCrit, casterTeam, collision);
    }
  });
}
