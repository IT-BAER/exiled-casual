import type { Snapshot } from "@exiled/protocol";
import { BUFF_ART } from "./BuffBar";

/**
 * The mana globe's tooltip: the pool, then what the grey cap is, aura by aura
 * (PoE1 greys the reserved share of the globe and its hover names the holders).
 */
export function manaTooltip(mana: number, maxMana: number, reserved: number, buffs: Snapshot["player"]["buffs"]) {
  const lines = [`${Math.round(mana)}/${Math.round(maxMana)} Mana`];
  if (reserved > 0) {
    const pct = maxMana > 0 ? Math.round((reserved / maxMana) * 100) : 0;
    lines.push(`${Math.round(reserved)} Reserved (${pct}% of maximum)`);
    for (const b of buffs ?? []) {
      if (b.aura && b.reserved !== undefined) lines.push(`${BUFF_ART[b.id]?.name ?? b.id}: ${Math.round(b.reserved)}`);
    }
    lines.push(`${Math.round(maxMana - reserved)} left to spend`);
  }
  return {
    name: "Mana",
    rarity: "normal",
    lines,
    help: reserved > 0
      ? "The grey part is held by your auras: it cannot be spent or refilled. Switch an aura off to free its share."
      : "Spent by skills. Regenerates over time.",
  };
}
