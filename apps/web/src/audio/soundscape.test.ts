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
function run(seq: Snapshot[], biomeId: string | null = null): string[] {
  const heard: string[] = [];
  const s = createSoundscape({ play: (n) => heard.push(n) });
  s.reset(biomeId);
  for (const it of seq) s.observe(it);
  return heard;
}

/** Forty ticks of walking, which is four footfalls at the ten-tick cadence. */
function walk(ticks = 40): Snapshot[] {
  const seq: Snapshot[] = [];
  for (let t = 1; t <= ticks; t++) seq.push(snap({ tick: t, player: testPlayer({ x: t * 0.1 }) }));
  return seq;
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

  /**
   * Four unrelated species shared one hit and one death: a carved construct, a
   * desiccated husk, chitin, and meat under iron. What the ear hears is the
   * MATERIAL, so that is the axis the cue is keyed on.
   */
  it("a construct dies as stone and a bog thing dies wet", () => {
    const of = (id: number, species: string): SnapshotEntity => ({ ...monster(id, 3), species });
    expect(run([
      snap({ tick: 1, entities: [of(1, "monster.vaal_construct.v1")] }),
      snap({ tick: 2, entities: [] }),
    ])).toEqual(["monster-death-stone"]);
    expect(run([
      snap({ tick: 1, entities: [of(1, "monster.rotting_behemoth.v1"), of(2, "monster.fen_wisp.v1")] }),
      snap({ tick: 2, entities: [] }),
    ])).toEqual(["monster-death-bog", "monster-death-spirit"]);
  });

  /** A species nobody has written a material for must fall back, never go silent. */
  it("an unknown species keeps the generic cue", () => {
    const stranger: SnapshotEntity = { ...monster(1, 3), species: "monster.not_yet.v1" };
    expect(run([
      snap({ tick: 1, entities: [stranger] }),
      snap({ tick: 2, entities: [] }),
    ])).toEqual(["monster-death"]);
  });

  it("a hurt cue is keyed on material too", () => {
    const husk: SnapshotEntity = { ...monster(1, 3, 40), species: "monster.vaal_husk.v1" };
    expect(run([
      snap({ tick: 1, entities: [husk] }),
      snap({ tick: 2, entities: [{ ...husk, life: 30 }] }),
    ])).toEqual(["monster-hurt-husk"]);
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

  it("walking makes footfalls on a cadence, and standing still is silent", () => {
    // 39 ticks of walking at one step per ten ticks.
    const steps = run(walk()).filter((n) => n.startsWith("footstep"));
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.length).toBeLessThanOrEqual(5);

    const still: Snapshot[] = [];
    for (let t = 1; t <= 40; t++) still.push(snap({ tick: t }));
    expect(run(still).filter((n) => n.startsWith("footstep"))).toEqual([]);
  });

  /**
   * A step is the one cue the player hears thousands of times, so it is the one that
   * has to know what it is standing on. The ground comes from the biome, which the
   * client is told once per area, and nothing else in the snapshot describes it.
   */
  it("feet take the ground the biome is made of", () => {
    const groundOf = (biome: string | null): Set<string> =>
      new Set(run(walk(), biome).filter((n) => n.startsWith("footstep"))
        .map((n) => n.replace(/-\d+$/, "")));
    expect(groundOf("swamp")).toEqual(new Set(["footstep-mud"]));
    expect(groundOf("forest")).toEqual(new Set(["footstep-grass"]));
    expect(groundOf("desert")).toEqual(new Set(["footstep-dirt"]));
    expect(groundOf("vaal_stone")).toEqual(new Set(["footstep-stone"]));
    // The hideout has no map base, and a biome added tomorrow has no entry: both
    // are a floor rather than a silence.
    expect(groundOf(null)).toEqual(new Set(["footstep-stone"]));
    expect(groundOf("not_a_biome")).toEqual(new Set(["footstep-stone"]));
  });

  /**
   * The complaint this exists to answer is not that a step was wrong, it is that it
   * was the SAME: two samples alternating is a rhythm, and a rhythm is heard as one
   * repeating sound however good the sample is. Three things differ per footfall —
   * which fall, its pitch (`vary`, sfx.ts) and its level — and two of them are
   * observable here.
   */
  it("no footfall repeats the one before it, and each one lands at its own level", () => {
    const heard: Array<[string, number | undefined]> = [];
    const s = createSoundscape({ play: (n, v) => heard.push([n, v]) });
    s.reset("forest");
    for (const snapshot of walk(400)) s.observe(snapshot);

    const steps = heard.filter(([n]) => n.startsWith("footstep"));
    expect(steps.length).toBeGreaterThan(30);
    for (let i = 1; i < steps.length; i++) expect(steps[i]![0]).not.toBe(steps[i - 1]![0]);
    // Every fall on disk gets used, so a mistyped index is a sample nobody hears.
    expect(new Set(steps.map(([n]) => n))).toEqual(
      new Set(["footstep-grass-1", "footstep-grass-2", "footstep-grass-3"]));

    const levels = steps.map(([, v]) => v!);
    for (const v of levels) expect(v).toBeGreaterThan(0.6);
    // A ceiling of 1: playSfx clamps above it, so any louder jitter is a silent no-op.
    for (const v of levels) expect(v).toBeLessThanOrEqual(1);
    expect(new Set(levels).size).toBeGreaterThan(steps.length / 2);
  });

  /**
   * The area-rebuild reset inside observe() is not a new AREA — it fires when a
   * snapshot cannot be diffed against the last one — so it must not throw away the
   * ground and put the player back on stone in the middle of a swamp.
   */
  it("a mid-area rebuild keeps the ground", () => {
    const rebuilt = [...walk(20), ...walk(20)]; // second half restarts at tick 1
    const steps = run(rebuilt, "swamp").filter((n) => n.startsWith("footstep"));
    expect(steps.length).toBeGreaterThan(2);
    for (const s of steps) expect(s).toMatch(/^footstep-mud-\d$/);
  });

  it("a corpse does not walk", () => {
    const dead: Snapshot[] = [];
    for (let t = 1; t <= 40; t++) {
      dead.push(snap({ tick: t, player: testPlayer({ x: t * 0.1, alive: false, life: 0 }) }));
    }
    expect(run(dead).filter((n) => n.startsWith("footstep"))).toEqual([]);
  });
});
