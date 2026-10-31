import { describe, it, expect } from "vitest";
import { MAX_LEVEL, atlasGraph, atlasNodeTier, xpToNext } from "@exiled/rules";
import type { CharacterRecord } from "@exiled/persistence";
import { nextGoal } from "./next-goal";

const SEED = 1234;
const graph = atlasGraph(SEED);

function rec(state: unknown, level = 1): CharacterRecord {
  return { id: "c", name: "Vess", classId: "class.stalker", level, league: "Local", createdAt: 1, state };
}
const save = (level: number, xp: number, completedNodes: string[] = []) =>
  rec({ version: 2, progress: { level, xp, gold: 0 }, session: { atlasSeed: SEED, completedNodes } }, level);

describe("nextGoal", () => {
  it("has nothing to say without a record, or for a save it cannot read", () => {
    expect(nextGoal(null)).toBeNull();
    expect(nextGoal(rec("garbage"))).toBeNull();
    expect(nextGoal(rec({ progress: { level: "x" } }))).toBeNull();
    expect(nextGoal({ ...rec(null), level: "x" as unknown as number })).toBeNull();
  });

  it("names the first map for a new character that has no save yet", () => {
    // The worker writes a save only once something durable changes, so a
    // character that stood in the hideout and left still has state null.
    const first = { kind: "node", name: graph[0]!.name, tier: 1, first: true };
    expect(nextGoal(rec(null, 1))).toEqual(first);
    // Node 0's name does not depend on the Atlas seed.
    expect(atlasGraph(1)[0]!.name).toBe(graph[0]!.name);
  });

  it("names the first map before any map is cleared", () => {
    expect(nextGoal(save(1, 0))).toEqual({ kind: "node", name: graph[0]!.name, tier: 1, first: true });
  });

  it("names the cheapest place the Atlas has opened next", () => {
    const start = graph[0]!;
    const goal = nextGoal(save(4, 0, [start.id]));
    expect(goal?.kind).toBe("node");
    if (goal?.kind !== "node") return;
    const opened = graph.filter((n) => start.links.includes(n.id));
    expect(opened.map((n) => n.name)).toContain(goal.name);
    expect(goal.tier).toBe(Math.min(...opened.map((n) => atlasNodeTier(graph, n.id))));
    expect(goal.first).toBe(false);
  });

  it("names the next level instead when it is three quarters done", () => {
    const need = xpToNext(6);
    expect(nextGoal(save(6, Math.ceil(need * 0.75)))).toEqual({ kind: "level", level: 7, percent: 75 });
    expect(nextGoal(save(6, Math.floor(need * 0.74)))?.kind).toBe("node");
  });

  it("names the next level when every place is cleared, and nothing at the level cap", () => {
    const all = graph.map((n) => n.id);
    expect(nextGoal(save(30, 0, all))).toEqual({ kind: "level", level: 31, percent: 0 });
    expect(nextGoal(save(MAX_LEVEL, 0, all))).toBeNull();
  });

  it("ignores what a hand-edited save puts in the node list", () => {
    expect(nextGoal(save(1, 0, [7, null, "node.nowhere"] as unknown as string[]))).toMatchObject({ kind: "node", first: true });
  });
});
