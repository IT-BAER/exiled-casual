// Gem levels: what a skill's own experience buys. Pure integers, like every other
// rule the sim reads — a gem level happens inside a tick and has to replay
// identically.
import type { EffectNode, SkillBreakpoint, SkillDef } from "@exiled/content-schema";

/** PoE1 stops an unsupported gem at 20, and so does this one. */
export const MAX_GEM_LEVEL = 20;

export interface Gem { level: number; xp: number }

/**
 * A gem may not outlevel its bearer. The character level IS the cap below 20,
 * which is what stops a level-1 character walking a first map with a gem 20
 * skill he was handed by a shared bar.
 */
export function maxGemLevel(charLevel: number): number {
  return Math.min(MAX_GEM_LEVEL, Math.max(1, Math.trunc(charLevel)));
}

/**
 * Experience needed to leave `gemLevel`. Zero at the cap: nothing to buy.
 *
 * Quadratic for the same reason the character curve is (`xp.ts`): a kill's value
 * grows only LINEARLY with area level, so a steeper curve stops paying at all.
 * Twice the character coefficient because the climb is 19 levels rather than 99.
 * The whole climb costs 148,200, which on a three-skill bar is 444,600 character
 * experience and lands gem 20 at character 36; a full eight-slot bar pushes it
 * to character 50. `skill-xp.test.ts` pins that BAND, not this constant.
 */
export function gemXpToNext(gemLevel: number): number {
  if (gemLevel >= MAX_GEM_LEVEL) return 0;
  return 60 * gemLevel * gemLevel;
}

/**
 * Whether a character has this skill at all. DERIVED, never stored: recomputing
 * from the level on every load means a save cannot desync into a missing skill,
 * and a retuned unlock table takes effect for characters that already exist.
 */
export function isUnlocked(def: SkillDef, charLevel: number, classId: string): boolean {
  if (def.classId !== undefined && def.classId !== classId) return false;
  return def.unlockLevel <= charLevel;
}

/**
 * One kill's experience, per occupied bar slot. Truncated per slot rather than
 * distributed with a remainder: the remainder is a fraction of one kill, and
 * carrying it would put a running balance in the save for nothing.
 */
export function splitGemXp(award: number, occupiedSlots: number): number {
  if (occupiedSlots <= 0) return 0;
  return Math.trunc(award / occupiedSlots);
}

/**
 * Apply an award to one gem, capped at `cap` (the character's `maxGemLevel`).
 *
 * A capped gem BANKS what it earns rather than burning it, and pops the instant
 * the cap rises — so a character level can pay twice, once for itself and once
 * for every gem that was waiting on it. Intensity over density (docs/09 rule 3).
 * Only MAX_GEM_LEVEL is a floor on that: there is nothing left to bank for.
 */
export function gainGemXp(gem: Gem, amount: number, cap: number): Gem {
  if (gem.level >= MAX_GEM_LEVEL) return { level: MAX_GEM_LEVEL, xp: 0 };
  let level = gem.level;
  let xp = gem.xp + amount;
  const ceiling = maxGemLevel(cap);
  while (level < ceiling && xp >= gemXpToNext(level)) {
    xp -= gemXpToNext(level);
    level++;
  }
  return level >= MAX_GEM_LEVEL ? { level: MAX_GEM_LEVEL, xp: 0 } : { level, xp };
}

/** Compound `pct` percent, `times` times, truncating at every step so it replays. */
function compound(value: number, pct: number, times: number): number {
  let v = value;
  for (let i = 0; i < times; i++) v = Math.trunc((v * (100 + pct)) / 100);
  return v;
}

/** Fields on an effect node that carry a damage number the gem level scales. */
function scaleDamage(effect: EffectNode, pct: number, times: number): EffectNode {
  if (effect.type === "spawnProjectile" || effect.type === "meleeStrike") {
    return {
      ...effect,
      damage: { ...effect.damage, amountFixed: compound(effect.damage.amountFixed, pct, times) },
    };
  }
  if (effect.type === "spawnGroundArea") {
    // The ailment IS the skill's damage here, so a level has to reach it. This is
    // deliberately unlike gear's spellDamagePct, which PoE keeps off ailments
    // (see skillCast): a gem level is the gem's own power, not an external mod.
    return {
      ...effect,
      ailment: { ...effect.ailment, dpsFixed: compound(effect.ailment.dpsFixed, pct, times) },
    };
  }
  return effect;
}

/**
 * The def this character actually casts, at this gem level.
 *
 * One fold, called by BOTH `skillCast` and `describeSkills`, which is the only
 * reason the tooltip can promise exactly what the cast does. Order matters: the
 * per-level growth lands first and the breakpoint patches land on top, which is
 * why the schema refuses a patch of the same field the growth grows.
 */
export function effectiveSkill(def: SkillDef, gemLevel: number): SkillDef {
  const level = maxGemLevel(gemLevel);
  const steps = level - 1;
  const { damagePct, manaPct, own } = def.growth.perLevel;

  let effects = def.effects.map((e) => scaleDamage(e, damagePct, steps));

  if (own && effects.length > 0) {
    const first = effects[0]! as unknown as Record<string, unknown>;
    const base = first[own.field];
    if (typeof base === "number") {
      // Linear in the def's OWN value, not compounding: this is the authored
      // flavour scalar, and a compounding radius reaches the far wall.
      const grown = base + Math.trunc((base * own.perMille * steps) / 1000);
      effects = [
        { ...(effects[0] as object), [own.field]: grown } as unknown as EffectNode,
        ...effects.slice(1),
      ];
    }
  }

  for (const bp of def.growth.breakpoints) {
    if (bp.atLevel > level || effects.length === 0) continue;
    effects = [
      { ...(effects[0] as object), ...bp.patch } as unknown as EffectNode,
      ...effects.slice(1),
    ];
  }

  return { ...def, manaCostFixed: compound(def.manaCostFixed, manaPct, steps), effects };
}

/** Every breakpoint this gem has already crossed, in authored order. */
export function reachedBreakpoints(def: SkillDef, gemLevel: number): SkillBreakpoint[] {
  return def.growth.breakpoints.filter((b) => b.atLevel <= gemLevel);
}

/**
 * The one the tooltip greys out. That grey line is where the anticipation lives
 * (docs/09 rule 1), so it is the cheapest device in the whole design.
 */
export function nextBreakpoint(def: SkillDef, gemLevel: number): SkillBreakpoint | null {
  return def.growth.breakpoints.find((b) => b.atLevel > gemLevel) ?? null;
}
