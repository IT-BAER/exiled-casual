import type { DeathRecap, DeathRecapSource, MonsterElement } from "@exiled/protocol";
import { damageTypeOf } from "./damage-types";

/** How far back the death screen looks from the killing blow: 5 s at 30 Hz. */
export const RECAP_WINDOW_TICKS = 150;
/** The source of a burning tick: the ailment names its victim, not whoever lit it. */
export const BURNING_SOURCE = "ailment.burning";

/**
 * One hit that landed on the living player, in display units. Kept on the
 * Simulation, never in the World: it is read by the death screen only, so it
 * must not touch saves or replay checksums.
 */
export interface RecapHit {
  tick: number;
  species: string;
  rare: boolean;
  /** DAMAGE_TYPES index. */
  type: number;
  amount: number;
}

/** The death screen's reading of the hits: the last one, and who dealt the most. */
export function summarizeHits(hits: readonly RecapHit[], maxLife: number): DeathRecap {
  const last = hits[hits.length - 1]!;
  const recent = hits.filter((h) => h.tick >= last.tick - RECAP_WINDOW_TICKS);
  const groups = new Map<string, DeathRecapSource & { perElement: Map<MonsterElement, number> }>();
  const byElement: Partial<Record<MonsterElement, number>> = {};
  let total = 0;
  for (const h of recent) {
    const el = damageTypeOf(h.type) as MonsterElement;
    const key = `${h.species}|${h.rare}`;
    let g = groups.get(key);
    if (!g) {
      g = { species: h.species, rare: h.rare, damage: 0, hits: 0, element: el, perElement: new Map() };
      groups.set(key, g);
    }
    g.damage += h.amount;
    g.hits++;
    g.perElement.set(el, (g.perElement.get(el) ?? 0) + h.amount);
    byElement[el] = (byElement[el] ?? 0) + h.amount;
    total += h.amount;
  }
  const sources = [...groups.values()]
    .sort((a, b) => b.damage - a.damage)
    .slice(0, 3)
    .map(({ perElement, ...s }) => ({
      ...s,
      damage: Math.round(s.damage),
      element: [...perElement].reduce((a, b) => (b[1] > a[1] ? b : a))[0],
    }));
  for (const k of Object.keys(byElement) as MonsterElement[]) byElement[k] = Math.round(byElement[k]!);
  return {
    killingBlow: {
      species: last.species,
      rare: last.rare,
      damage: Math.round(last.amount),
      element: damageTypeOf(last.type) as MonsterElement,
      pctOfLife: maxLife > 0 ? Math.round((last.amount * 100) / maxLife) : 0,
    },
    sources,
    total: Math.round(total),
    byElement,
  };
}
