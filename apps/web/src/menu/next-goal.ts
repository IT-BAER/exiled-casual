/**
 * The one goal the roster names when a character is back on it.
 *
 * Telemetry measured 0 returns on a later day across 27 new-character
 * visitor-days. docs/09 rule 7 keeps a fixed-ratio track under the loot:
 * levels, Atlas nodes, tiers. Leaving is the moment to name the nearest step on
 * it, specific and close, so the next session starts with something to want.
 *
 * Read from the save the character already has, defensively: an imported file
 * is a trust boundary, and the menu must not build a world to read it.
 */
import { MAX_LEVEL, atlasGraph, atlasNodeTier, isNodeReachable, xpToNext } from "@exiled/rules";
import type { CharacterRecord } from "@exiled/persistence";

export type NextGoal =
  | { kind: "level"; level: number; percent: number }
  | { kind: "node"; name: string; tier: number; first: boolean };

/** From here on, the next level is nearer than any map. */
const LEVEL_GOAL_AT = 0.75;

export function nextGoal(record: CharacterRecord | null | undefined): NextGoal | null {
  // No save yet: the worker writes one only once something durable changes, so
  // a character that stood in the hideout and left is still this. Node 0 is the
  // same place on every seed's Atlas.
  if (record && record.state === null && typeof record.level === "number") {
    const start = atlasGraph(0)[0];
    return start ? { kind: "node", name: start.name, tier: 1, first: true } : null;
  }
  const state = obj(record?.state);
  const progress = obj(state["progress"]);
  const session = obj(state["session"]);
  const level = progress["level"];
  const xp = typeof progress["xp"] === "number" ? progress["xp"] : 0;
  const seed = session["atlasSeed"];
  if (typeof level !== "number" || typeof seed !== "number") return null;

  const need = xpToNext(level);
  const done = need > 0 ? Math.min(1, Math.max(0, xp / need)) : 0;
  const levelGoal: NextGoal | null = level < MAX_LEVEL
    ? { kind: "level", level: level + 1, percent: Math.floor(done * 100) }
    : null;
  if (levelGoal && done >= LEVEL_GOAL_AT) return levelGoal;

  const raw = session["completedNodes"];
  const completed = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
  const next = nextNode(seed, completed);
  if (next) return { kind: "node", ...next, first: !atlasGraph(seed).some((n) => completed.includes(n.id)) };
  return levelGoal;
}

/**
 * The cheapest open place on the Atlas. After a clear, the routes out of the
 * node just cleared come first: its boss raised a stone to that tier
 * (`nextNodeTier`), so it is the place the stone in hand is for.
 */
export function nextNode(
  seed: number,
  completed: readonly string[],
  cleared?: string,
): { name: string; tier: number } | null {
  const graph = atlasGraph(seed);
  const open = graph
    .filter((n) => !completed.includes(n.id) && isNodeReachable(graph, completed, n.id))
    .map((n) => ({ id: n.id, name: n.name, tier: atlasNodeTier(graph, n.id) }))
    .sort((a, b) => a.tier - b.tier);
  const routes = cleared && completed.includes(cleared) ? graph.find((n) => n.id === cleared)?.links ?? [] : [];
  const best = open.find((n) => routes.includes(n.id)) ?? open[0];
  return best ? { name: best.name, tier: best.tier } : null;
}

function obj(raw: unknown): Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}
