/**
 * Turns consecutive snapshots into telemetry events, the way the soundscape turns
 * them into sound: a pure diff, read-only, never an intent and never the worker.
 *
 * `area()` resets what is per-area (ground item ids share nothing with the area
 * before); level, life and completed maps carry across areas on purpose.
 */
import type { AreaKind, Snapshot } from "@exiled/protocol";
import type { Rarity } from "@exiled/telemetry";
import type { BeatContext, EventDraft } from "./client";

export interface LootCounts { normal: number; magic: number; rare: number; unique: number }

const emptyLoot = (): LootCounts => ({ normal: 0, magic: 0, rare: 0, unique: 0 });

export function createGameObserver() {
  let level: number | null = null;
  let alive: boolean | null = null;
  let done: Set<string> | null = null;
  let seen = new Set<number>();
  /** The first snapshot of an area only learns which drops are already lying there. */
  let primed = false;
  let pending: { area: AreaKind; biome?: string } | null = null;
  let biome: string | undefined;
  let ctx: BeatContext = {};
  let loot = emptyLoot();

  return {
    area(kind: AreaKind, biomeId: string | null | undefined): void {
      seen = new Set();
      primed = false;
      biome = biomeId ?? undefined;
      pending = { area: kind, biome };
    },

    observe(snap: Snapshot): EventDraft[] {
      const out: EventDraft[] = [];
      const p = snap.player;
      const tier = snap.areaTier;

      if (pending) {
        const e: EventDraft = { k: "area", area: pending.area };
        if (pending.biome) Object.assign(e, { biome: pending.biome });
        if (pending.area === "map") Object.assign(e, { tier });
        out.push(e);
        pending = null;
      }

      if (level !== null && p.level > level) out.push({ k: "level", level: p.level });
      level = p.level;

      if (alive === true && !p.alive) {
        const blow = snap.deathRecap?.killingBlow;
        const e: EventDraft = { k: "death", level: p.level, tier };
        if (biome) Object.assign(e, { biome });
        if (blow) Object.assign(e, { killer: blow.species, element: blow.element, rare: blow.rare });
        out.push(e);
      }
      alive = p.alive;

      if (done !== null) {
        for (const node of snap.completedNodes) {
          if (done.has(node)) continue;
          const e: EventDraft = { k: "mapDone", node, tier };
          if (biome) Object.assign(e, { biome });
          out.push(e);
        }
      }
      done = new Set(snap.completedNodes);

      for (const ent of snap.entities) {
        if (ent.kind !== "groundItem" || seen.has(ent.id)) continue;
        seen.add(ent.id);
        if (primed) loot[(ent.rarity ?? "normal") as Rarity]++;
      }
      primed = true;

      ctx = { area: snap.area, level: p.level };
      if (biome) ctx.biome = biome;
      if (snap.area === "map") ctx.tier = tier;
      if (p.classId) ctx.classId = p.classId;
      return out;
    },

    /** Drops counted since the last call, or null when there were none. */
    takeLoot(): LootCounts | null {
      const l = loot;
      loot = emptyLoot();
      return l.normal + l.magic + l.rare + l.unique > 0 ? l : null;
    },

    context: (): BeatContext => ctx,
  };
}
