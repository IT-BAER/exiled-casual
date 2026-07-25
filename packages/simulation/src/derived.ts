import { baseCasterStats, applyItemMods, levelBonus, START_LEVEL, waystoneScaleFor } from "@exiled/rules";
import { itemStatMods } from "@exiled/content-runtime";
import { ELEMENTS } from "@exiled/content-schema";
import type { World } from "./ecs";
import type { Health, Mana, DefensesC, OffenseC, EquipmentC, ProgressC, EnergyShieldC, SessionC } from "./components";

/**
 * Recompute the player's gear-derived stats from scratch: base block + every
 * implicit and affix on every equipped item. The single writer of those stats —
 * the equipment system calls it after a slot changes, persist.restore after a
 * load — so nothing has to compute a delta or remember what an item granted.
 *
 * Current life and mana stay where they are (clamped to the new maxima), so
 * equipping a +life chest hands you an empty pool to fill rather than a free
 * heal. `refill` tops both up, which is what a restored session wants: life is
 * not persisted, and without life regeneration a geared player would otherwise
 * start every session short.
 */
export function recomputePlayerStats(world: World, opts: { refill?: boolean } = {}): void {
  const player = world.query("player")[0];
  if (player === undefined) return;
  const sessionE = world.query("session")[0];
  const equip = sessionE === undefined ? undefined : world.get<EquipmentC>(sessionE, "equipment");

  // Slots in sorted order. Every fold here is integer addition, so the result is
  // order-independent anyway; sorting makes that true by construction rather
  // than by argument, whatever order the slots happen to have been filled in.
  const mods = Object.keys(equip?.slots ?? {}).sort()
    .flatMap((slot) => {
      const item = equip!.slots[slot];
      return item ? itemStatMods(item) : [];
    });

  // What levelling grants enters as two flat mods rather than as a second base
  // block, so a level and a chest piece are added by the same fold and cannot
  // drift apart. At START_LEVEL both are zero and the block is byte-identical to
  // the one an unlevelled character has always had.
  const progress = sessionE === undefined ? undefined : world.get<ProgressC>(sessionE, "progress");
  const bonus = levelBonus(progress?.level ?? START_LEVEL);
  const s = applyItemMods(baseCasterStats(), [
    { stat: "maxLife", value: bonus.maxLife },
    { stat: "maxMana", value: bonus.maxMana },
    ...mods,
  ]);

  const h = world.get<Health>(player, "health");
  if (h) {
    world.set<Health>(player, "health", {
      maxLife: s.maxLifeFixed,
      life: opts.refill ? s.maxLifeFixed : Math.min(h.life, s.maxLifeFixed),
    });
  }
  const m = world.get<Mana>(player, "mana");
  if (m) {
    world.set<Mana>(player, "mana", {
      maxMana: s.maxManaFixed,
      mana: opts.refill ? s.maxManaFixed : Math.min(m.mana, s.maxManaFixed),
      regen: Math.trunc(s.manaRegenPerSecFixed / 30),
    });
  }
  // A map modifier that takes resistances off the player applies only inside
  // that map — walking back to the hideout gives them back, which is why this is
  // folded here at the end rather than into the gear block: it is a property of
  // where you are standing, not of what you are wearing. The character sheet
  // reads these same numbers, so the penalty is visible while it is in force.
  const session = sessionE === undefined ? undefined : world.get<SessionC>(sessionE, "session");
  const penalty = session?.area === "map" ? waystoneScaleFor(session.waystoneSeed).playerResPenalty : 0;
  const res = { ...s.resPct };
  if (penalty !== 0) for (const el of ELEMENTS) res[el] -= penalty;
  world.set<DefensesC>(player, "defenses", { res, armour: s.armourFixed });

  // Same rule as offense below: no shield, no component. A pool that grows keeps
  // its current value (clamped), so equipping a bigger focus hands you headroom
  // to recharge rather than an instant slab of effective health.
  if (s.maxEnergyShieldFixed === 0) {
    if (world.has(player, "energyShield")) world.remove(player, "energyShield");
  } else {
    const cur = world.get<EnergyShieldC>(player, "energyShield");
    world.set<EnergyShieldC>(player, "energyShield", {
      maxEs: s.maxEnergyShieldFixed,
      es: opts.refill ? s.maxEnergyShieldFixed : Math.min(cur?.es ?? s.maxEnergyShieldFixed, s.maxEnergyShieldFixed),
      rechargeAtTick: cur?.rechargeAtTick ?? 0,
    });
  }

  // Removing at zero keeps the component out of a bare world entirely. The store
  // itself is only created once something grants spell damage, which is what
  // holds the golden replays' serialized state byte-identical to before.
  if (s.spellDamagePct === 0) {
    if (world.has(player, "offense")) world.remove(player, "offense");
  } else {
    world.set<OffenseC>(player, "offense", { spellDamagePct: s.spellDamagePct });
  }
}
