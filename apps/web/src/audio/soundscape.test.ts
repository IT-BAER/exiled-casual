import { describe, it, expect } from "vitest";
import type { Snapshot, SnapshotEntity } from "@exiled/protocol";
import { testPlayer } from "../test-fixtures";
import { createSoundscape } from "./soundscape";

/** A snapshot with the bits the soundscape reads, and nothing else. */
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

const monster = (id: number, x: number, life = 40): SnapshotEntity =>
  ({ id, kind: "monster", x, y: 0, life, maxLife: 40 });

/** Drive a sequence of snapshots and collect the cue names in order. */
function run(seq: Snapshot[]): string[] {
  const heard: string[] = [];
  const s = createSoundscape({ play: (n) => heard.push(n) });
  for (const it of seq) s.observe(it);
  return heard;
}

describe("createSoundscape", () => {
  it("says nothing about the first snapshot — there is nothing to compare it to", () => {
    expect(run([snap({ entities: [monster(1, 3)] })])).toEqual([]);
  });

  it("a monster that left the snapshot died", () => {
    expect(run([
      snap({ tick: 1, entities: [monster(1, 3)] }),
      snap({ tick: 2, entities: [] }),
    ])).toEqual(["monster-death"]);
  });

  it("a monster that lost life grunts, but not again on the next tick", () => {
    const heard = run([
      snap({ tick: 1, entities: [monster(1, 3, 40)] }),
      snap({ tick: 2, entities: [monster(1, 3, 30)] }),
      snap({ tick: 3, entities: [monster(1, 3, 20)] }),
    ]);
    expect(heard).toEqual(["monster-hurt"]);
  });

  /** A ground area over a pack would otherwise fire one sample per body. */
  it("caps how many of one kind a single snapshot can fire", () => {
    const pack = [1, 2, 3, 4, 5, 6].map((i) => monster(i, i * 0.5));
    const heard = run([
      snap({ tick: 1, entities: pack }),
      snap({ tick: 2, entities: [] }),
    ]);
    expect(heard.filter((n) => n === "monster-death")).toHaveLength(3);
  });

  it("a telegraph appearing winds up and its disappearing lands", () => {
    const tele: SnapshotEntity = { id: 9, kind: "telegraph", x: 1, y: 0, radius: 2, progress: 0 };
    expect(run([
      snap({ tick: 1, entities: [] }),
      snap({ tick: 2, entities: [tele] }),
      snap({ tick: 3, entities: [] }),
    ])).toEqual(["monster-slam-windup", "monster-slam-impact"]);
  });

  it("tells his own bolt from a spitter's by the team on it", () => {
    const mine: SnapshotEntity = { id: 4, kind: "projectile", x: 1, y: 0, team: 0 };
    const theirs: SnapshotEntity = { id: 5, kind: "projectile", x: 4, y: 0, team: 1 };
    expect(run([
      snap({ tick: 1, entities: [] }),
      snap({ tick: 2, entities: [mine, theirs] }),
      snap({ tick: 3, entities: [] }),
    ])).toEqual(["monster-spit", "skill-ember-bolt-impact"]);
  });

  /** The portals are the renderer's: it staggers them, so it sounds them. */
  it("says nothing about portals", () => {
    const portal: SnapshotEntity = { id: 7, kind: "portal", x: 0, y: 1 };
    expect(run([
      snap({ tick: 1, entities: [] }),
      snap({ tick: 2, entities: [portal] }),
      snap({ tick: 3, entities: [] }),
    ])).toEqual([]);
  });

  /**
   * The whole population changes ids across a transition, so a naive diff would
   * report every monster dead and every portal closed on the first snapshot of a
   * new area.
   */
  it("says nothing across an area change", () => {
    expect(run([
      snap({ tick: 40, area: "map", entities: [monster(1, 3), { id: 2, kind: "telegraph", x: 0, y: 0 }] }),
      snap({ tick: 41, area: "hideout", entities: [] }),
      snap({ tick: 42, area: "hideout", entities: [] }),
    ])).toEqual([]);
  });

  it("hands with something standing on him, spell without", () => {
    const hit = (entities: SnapshotEntity[]) => run([
      snap({ tick: 1, entities, player: testPlayer({ life: 100 }) }),
      snap({ tick: 2, entities, player: testPlayer({ life: 80 }) }),
    ]).filter((n) => n === "monster-melee-hit" || n === "player-hurt");
    expect(hit([monster(1, 1)])).toEqual(["monster-melee-hit"]);
    expect(hit([monster(1, 9)])).toEqual(["player-hurt"]);
    expect(hit([])).toEqual(["player-hurt"]);
  });

  /**
   * The cue is read off the cooldown the cast SET, not off the button press, so a
   * bolt the sim refused for mana never makes the noise of one that flew.
   */
  it("a cooldown that rose is a cast; one falling is not", () => {
    expect(run([
      snap({ tick: 1, player: testPlayer({ cooldowns: {} }) }),
      snap({ tick: 2, player: testPlayer({ cooldowns: { "skill.ember_bolt.v1": 0.4 } }) }),
      snap({ tick: 3, player: testPlayer({ cooldowns: { "skill.ember_bolt.v1": 0.3 } }) }),
    ])).toEqual(["skill-ember-bolt-cast"]);
  });

  it("a flask charge spent is a flask drunk", () => {
    const flasks = (lifeCharges: number) => testPlayer({
      flasks: { lifeCharges, lifeMax: 7, manaCharges: 7, manaMax: 7 },
    });
    expect(run([
      snap({ tick: 1, player: flasks(7) }),
      snap({ tick: 2, player: flasks(6) }),
    ])).toEqual(["flask-drink"]);
  });

  it("the map opening sounds the stone going in", () => {
    expect(run([
      snap({ tick: 1, mapOpen: false }),
      snap({ tick: 2, mapOpen: true }),
    ])).toEqual(["waystone-activate"]);
  });

  it("walking alternates feet on a cadence, and standing still is silent", () => {
    const walking: Snapshot[] = [];
    for (let t = 1; t <= 40; t++) {
      walking.push(snap({ tick: t, player: testPlayer({ x: t * 0.1 }) }));
    }
    const steps = run(walking).filter((n) => n.startsWith("footstep"));
    // 39 ticks of walking at one step per ten ticks.
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.length).toBeLessThanOrEqual(5);
    expect(new Set(steps).size).toBe(2);

    const still: Snapshot[] = [];
    for (let t = 1; t <= 40; t++) still.push(snap({ tick: t }));
    expect(run(still).filter((n) => n.startsWith("footstep"))).toEqual([]);
  });

  it("a corpse does not walk", () => {
    const dead: Snapshot[] = [];
    for (let t = 1; t <= 40; t++) {
      dead.push(snap({ tick: t, player: testPlayer({ x: t * 0.1, alive: false, life: 0 }) }));
    }
    expect(run(dead).filter((n) => n.startsWith("footstep"))).toEqual([]);
  });
});
