import { describe, it, expect, vi, afterEach } from "vitest";
import type { Snapshot } from "@exiled/protocol";
import { testPlayer } from "./test-fixtures";
import { createDebugSnapshotLog, dlog, setDebugLogging } from "./debug";

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    tick: 1, area: "map", portalsLeft: 6, mapOpen: true, areaTier: 1,
    atlasSeed: 0, completedNodes: [],
    player: testPlayer(),
    entities: [],
    inventory: { cols: 12, rows: 5, items: [] },
    stash: { cols: 12, rows: 12, items: [] },
    vendor: { cols: 12, rows: 12, items: [] },
    equipment: {},
    shards: {},
    ...over,
  };
}

/** Every `[channel] ...` line the run printed, joined per call. */
function lines(run: () => void): string[] {
  const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
  run();
  const out = spy.mock.calls.map((c) => c.map(String).join(" "));
  spy.mockRestore();
  return out;
}

afterEach(() => setDebugLogging(false));

describe("debug logging", () => {
  it("says nothing at all while it is off", () => {
    setDebugLogging(false);
    const log = createDebugSnapshotLog();
    expect(lines(() => {
      dlog("intent", "move");
      log(snap());
      log(snap({ tick: 2, player: { ...testPlayer(), life: 10 } }));
    })).toEqual([]);
  });

  it("reports the difference between two snapshots", () => {
    setDebugLogging(true);
    const log = createDebugSnapshotLog();
    const monster = { id: 7, kind: "monster" as const, x: 1, y: 2, species: "monster.vaal_husk.v1" };
    const out = lines(() => {
      log(snap({ entities: [monster] }));
      log(snap({
        tick: 2,
        entities: [],
        player: { ...testPlayer(), life: 40, xp: 12, gold: 3 },
      }));
    });
    expect(out.join("\n")).toContain("[kill] monster.vaal_husk.v1");
    expect(out.some((l) => l.startsWith("[xp] +12"))).toBe(true);
    expect(out.some((l) => l.startsWith("[player] pools"))).toBe(true);
    expect(out.some((l) => l.startsWith("[gold] +3"))).toBe(true);
  });

  it("reports a crossing instead of diffing across it", () => {
    setDebugLogging(true);
    const log = createDebugSnapshotLog();
    const monster = { id: 7, kind: "monster" as const, x: 1, y: 2, species: "monster.vaal_husk.v1" };
    const out = lines(() => {
      log(snap({ entities: [monster] }));
      // Every id in the new area is new; the old population is not dead.
      log(snap({ tick: 1, area: "hideout", entities: [] }));
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("[area] entered hideout");
  });
});
