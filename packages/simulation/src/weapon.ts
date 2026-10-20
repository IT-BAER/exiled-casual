import { fp, type Fixed } from "@exiled/fixed-point";
import { classIdOr } from "@exiled/rules";
import { characterClass, spellAddedDamage, weaponDamage } from "@exiled/content-runtime";
import type { SkillDef } from "@exiled/content-schema";
import type { World } from "./ecs";
import type { EquipmentC, SessionC } from "./components";
import { damageCode } from "./damage-types";

/**
 * How one authored hit maps onto what is in hand: the skill's own part becomes
 * trunc(amount * num / den), and each extra part trunc(amount * num / den) + flat
 * of its own type. Absent means the hit is exactly as authored.
 */
export interface HitMod {
  num: number;
  den: number;
  extra?: { type: number; num: number; flat: Fixed }[];
}

export interface WeaponHit {
  mod?: HitMod;
  /** The skill's base crit chance in hundredths of a percent, after the weapon. */
  critPct100: number;
  cooldownTicks: number;
}

/** Content numbers (1.45 APS, 5.00% crit) as integer hundredths, so nothing after this is a float. */
const hundredths = (v: number): number => Math.round(v * 100);

/**
 * What the weapon does to this cast. Attacks are measured against the class's
 * STARTER weapon, so the starting kit hits, crits and recovers exactly as authored
 * and every number in content stays the one balance was tuned on. A spell takes a
 * wand's or focus's flat fire and cold at its own effectiveness. A world with no
 * session or no equipment (the golden replays, the bare test rigs) is untouched.
 */
export function weaponHit(world: World, skill: SkillDef): WeaponHit {
  const plain: WeaponHit = { critPct100: (skill.critChancePct ?? 0) * 100, cooldownTicks: skill.cooldownTicks };
  const sessionE = world.query("session")[0];
  if (sessionE === undefined) return plain;
  const slots = world.get<EquipmentC>(sessionE, "equipment")?.slots;
  if (!slots) return plain;

  if (skill.kind === "spell") {
    const eff = skill.addedDamageEffectivenessPct ?? 0;
    const added = spellAddedDamage([slots["weapon1"], slots["weapon2"]]);
    const extra = ([["fire", added.fire], ["cold", added.cold]] as const)
      .filter(([, v]) => v > 0 && eff > 0)
      .map(([type, v]) => ({ type: damageCode(type), num: 0, flat: Math.trunc((fp(v) * eff) / 100) }));
    return extra.length > 0 ? { ...plain, mod: { num: 1, den: 1, extra } } : plain;
  }
  if (skill.kind !== "attack") return plain;

  const session = world.get<SessionC>(sessionE, "session");
  const starterId = characterClass(classIdOr(session?.classId ?? "")).startingGear["weapon1"];
  if (!starterId) return plain;
  const s = weaponDamage({ baseId: starterId, rarity: "normal", itemLevel: 1, affixes: [] });
  const w = weaponDamage(slots["weapon1"]);

  const den = s.physMin + s.physMax;
  const num = w.physMin + w.physMax;
  // A flat fire point is worth what a point of the weapon's own average is: 2 * flat over the starter's min + max.
  const extra = ([["fire", w.fire], ["cold", w.cold]] as const)
    .filter(([, v]) => v > 0)
    .map(([type, v]) => ({ type: damageCode(type), num: 2 * v, flat: 0 }));
  const mod = num === den && extra.length === 0 ? undefined : { num, den, ...(extra.length > 0 ? { extra } : {}) };

  const sc = hundredths(s.critPct);
  const critPct100 = sc > 0 ? Math.trunc((plain.critPct100 * hundredths(w.critPct)) / sc) : plain.critPct100;
  const sa = hundredths(s.aps);
  const wa = hundredths(w.aps);
  // Rounded half up in integers: cd * sa / wa.
  const cooldownTicks = skill.cooldownTicks > 0 && wa > 0
    ? Math.max(1, Math.trunc((2 * skill.cooldownTicks * sa + wa) / (2 * wa)))
    : skill.cooldownTicks;

  return { ...(mod ? { mod } : {}), critPct100, cooldownTicks };
}

/**
 * The parts of one hit, before increased damage and crit. Parts of the same type
 * fold into one, so a wand's fire on a fire bolt is still one fire hit.
 */
export function hitParts(amountFixed: Fixed, type: number, mod: HitMod | undefined): { type: number; amount: Fixed }[] {
  if (!mod) return [{ type, amount: amountFixed }];
  const parts = [{ type, amount: Math.trunc((amountFixed * mod.num) / mod.den) }];
  for (const e of mod.extra ?? []) {
    const amount = Math.trunc((amountFixed * e.num) / mod.den) + e.flat;
    if (amount <= 0) continue;
    const same = parts.find((p) => p.type === e.type);
    if (same) same.amount += amount;
    else parts.push({ type: e.type, amount });
  }
  return parts;
}
