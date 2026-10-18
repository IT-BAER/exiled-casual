import type { Milestone } from "@exiled/telemetry";

export function milestoneShare(m: Milestone): number {
  return m.target <= 0 ? 1 : Math.min(1, m.progress / m.target);
}

/** Unlocked first (newest first), then locked ones by how close they are to unlocking. */
export function orderMilestones(list: readonly Milestone[]): Milestone[] {
  return [...list].sort((a, b) => {
    if (a.unlockedAt !== null && b.unlockedAt !== null) return b.unlockedAt - a.unlockedAt;
    if (a.unlockedAt !== null) return -1;
    if (b.unlockedAt !== null) return 1;
    return milestoneShare(b) - milestoneShare(a);
  });
}
