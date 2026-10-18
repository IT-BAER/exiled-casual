import type { Milestone } from "@exiled/telemetry";

/** Aggregates the milestones are read from. Every count is all-time. */
export interface MilestoneStats {
  sessions: number;
  visitorDays: number;
  playSeconds: number;
  mapsCompleted: number;
  uniquesDropped: number;
  maxLevel: number;
  peakConcurrent: number;
  /** Days since the newest error group appeared (or since the first session when there is none). */
  daysWithoutNewError: number;
}

interface Def {
  id: string;
  title: string;
  desc: string;
  rarity: Milestone["rarity"];
  target: number;
  progress: (s: MilestoneStats) => number;
}

const HOUR = 3600;

export const MILESTONES: Def[] = [
  { id: "sessions-1", title: "First Exile Arrives", desc: "The first session reaches the server.", rarity: "normal", target: 1, progress: (s) => s.sessions },
  { id: "sessions-10", title: "A Handful on the Shore", desc: "10 sessions played.", rarity: "normal", target: 10, progress: (s) => s.sessions },
  { id: "sessions-100", title: "A Hundred Wanderers", desc: "100 sessions played.", rarity: "magic", target: 100, progress: (s) => s.sessions },
  { id: "sessions-1000", title: "A Thousand Footprints in the Sand", desc: "1,000 sessions played.", rarity: "rare", target: 1000, progress: (s) => s.sessions },
  { id: "sessions-10000", title: "The Atlas Teems", desc: "10,000 sessions played.", rarity: "unique", target: 10000, progress: (s) => s.sessions },
  { id: "visitor-days-100", title: "Familiar Faces at the Campfire", desc: "100 visitor-days (one visitor on one day).", rarity: "magic", target: 100, progress: (s) => s.visitorDays },
  { id: "hours-10", title: "Ten Hours in Exile", desc: "10 hours played in total.", rarity: "magic", target: 10, progress: (s) => Math.floor(s.playSeconds / HOUR) },
  { id: "hours-100", title: "A Hundred Hours of Wandering", desc: "100 hours played in total.", rarity: "rare", target: 100, progress: (s) => Math.floor(s.playSeconds / HOUR) },
  { id: "hours-1000", title: "A Thousand Hours Beneath Strange Stars", desc: "1,000 hours played in total.", rarity: "unique", target: 1000, progress: (s) => Math.floor(s.playSeconds / HOUR) },
  { id: "first-map", title: "The First Map Falls", desc: "Someone completes a map.", rarity: "normal", target: 1, progress: (s) => s.mapsCompleted },
  { id: "first-unique", title: "A Relic Unearthed", desc: "A unique item drops for the first time.", rarity: "rare", target: 1, progress: (s) => s.uniquesDropped },
  { id: "level-20", title: "Seasoned Survivor", desc: "A character reaches level 20.", rarity: "rare", target: 20, progress: (s) => s.maxLevel },
  { id: "peak-10", title: "Ten Fires Burning at Once", desc: "10 sessions live at the same time.", rarity: "rare", target: 10, progress: (s) => s.peakConcurrent },
  { id: "peak-50", title: "Fifty Lanterns Across the Atlas", desc: "50 sessions live at the same time.", rarity: "unique", target: 50, progress: (s) => s.peakConcurrent },
  { id: "calm-7", title: "Seven Quiet Days", desc: "7 days without a new error group.", rarity: "magic", target: 7, progress: (s) => Math.floor(s.daysWithoutNewError) },
];

/**
 * Plaques from aggregates. `unlocked` holds the first time each id was seen at its target;
 * `derive` may date a fresh unlock from data, otherwise it is stamped `now` and kept from then on.
 */
export function evaluateMilestones(
  stats: MilestoneStats,
  unlocked: Record<string, number>,
  now: number,
  derive: (id: string) => number | null = () => null,
): { milestones: Milestone[]; newlyUnlocked: Record<string, number> } {
  const newlyUnlocked: Record<string, number> = {};
  const milestones = MILESTONES.map((d): Milestone => {
    const progress = Math.max(0, d.progress(stats));
    let at = unlocked[d.id] ?? null;
    if (at === null && progress >= d.target) {
      at = derive(d.id) ?? now;
      newlyUnlocked[d.id] = at;
    }
    return { id: d.id, title: d.title, desc: d.desc, rarity: d.rarity, progress: Math.min(progress, d.target), target: d.target, unlockedAt: at };
  });
  return { milestones, newlyUnlocked };
}
