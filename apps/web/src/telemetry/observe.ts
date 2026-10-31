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

/** Units from the player within which a rare counts as seen: about half the camera's 19-unit width. */
export const SEEN_RANGE = 9;

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
  let stoodIn: AreaKind | null = null;
  /** The last snapshot had the player alive and in reach of a portal: the next area was walked into. */
  let atPortal = false;
  let portalTo: AreaKind | null = null;
  /** Rares alive in the area, and which of them came into view. Monsters leave a snapshot only by dying. */
  let rares = new Set<number>();
  let raresSeen = new Set<number>();
  let bossSeen = false;
  let bossFought = false;
  let openedBoxes = new Set<number>();
  let caches = 0;

  return {
    area(kind: AreaKind, biomeId: string | null | undefined): void {
      seen = new Set();
      primed = false;
      biome = biomeId ?? undefined;
      pending = { area: kind, biome };
      portalTo = stoodIn !== null && atPortal ? kind : null;
      stoodIn = kind;
      rares = new Set();
      raresSeen = new Set();
      bossSeen = false;
      bossFought = false;
      openedBoxes = new Set();
    },

    observe(snap: Snapshot): EventDraft[] {
      const out: EventDraft[] = [];
      const p = snap.player;
      const tier = snap.areaTier;
      const at = (k: "rareSeen" | "rareKill" | "bossSeen" | "bossFight"): EventDraft =>
        (biome ? { k, tier, biome } : { k, tier });

      if (portalTo) {
        out.push({ k: "portal", to: portalTo });
        portalTo = null;
      }
      if (pending) {
        const e: EventDraft = { k: "area", area: pending.area };
        if (pending.biome) Object.assign(e, { biome: pending.biome });
        if (pending.area === "map") Object.assign(e, { tier });
        out.push(e);
        pending = null;
        // What stands in a new area was not killed in the old one.
        primed = false;
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

      const raresNow = new Set<number>();
      atPortal = false;
      for (const ent of snap.entities) {
        if (ent.kind === "monster") {
          if (ent.rare) {
            raresNow.add(ent.id);
            if (!raresSeen.has(ent.id) && Math.hypot(ent.x - p.x, ent.y - p.y) <= SEEN_RANGE) {
              raresSeen.add(ent.id);
              out.push(at("rareSeen"));
            }
          }
          if (ent.boss) {
            if (!bossSeen && ent.bossAwake) { bossSeen = true; out.push(at("bossSeen")); }
            if (!bossFought && ent.life !== undefined && ent.maxLife !== undefined && ent.life < ent.maxLife) {
              bossFought = true;
              out.push(at("bossFight"));
            }
          }
        } else if (ent.kind === "portal" && ent.inRange) {
          atPortal = p.alive;
        } else if (ent.kind === "container" && ent.opened && !openedBoxes.has(ent.id)) {
          // The first snapshot of an area only learns which were opened before.
          if (primed) caches++;
          openedBoxes.add(ent.id);
        } else if (ent.kind === "groundItem" && !seen.has(ent.id)) {
          seen.add(ent.id);
          if (primed) loot[(ent.rarity ?? "normal") as Rarity]++;
        }
      }
      for (const id of rares) if (!raresNow.has(id)) out.push(at("rareKill"));
      rares = raresNow;
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

    /** Containers opened since the last call. */
    takeCaches(): number {
      const n = caches;
      caches = 0;
      return n;
    },

    context: (): BeatContext => ctx,
  };
}
