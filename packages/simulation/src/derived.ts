import { baseCasterStats, applyItemMods } from "@exiled/rules";
import { itemStatMods } from "@exiled/content-runtime";
import type { World } from "./ecs";
import type { Health, Mana, DefensesC, OffenseC, EquipmentC } from "./components";

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
  const s = applyItemMods(baseCasterStats(), mods);

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
  world.set<DefensesC>(player, "defenses", { res: s.resPct, armour: s.armourFixed });

  // Removing at zero keeps the component out of a bare world entirely. The store
  // itself is only created once something grants spell damage, which is what
  // holds the golden replays' serialized state byte-identical to before.
  if (s.spellDamagePct === 0) {
    if (world.has(player, "offense")) world.remove(player, "offense");
  } else {
    world.set<OffenseC>(player, "offense", { spellDamagePct: s.spellDamagePct });
  }
}
