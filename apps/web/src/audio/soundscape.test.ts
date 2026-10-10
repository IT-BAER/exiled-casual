import { describe, it, expect } from "vitest";
import type { Snapshot, SnapshotEntity } from "@exiled/protocol";
import { testPlayer } from "../test-fixtures";
import { createSoundscape, ROOM_PROFILE, HIDEOUT_PROFILE } from "./soundscape";
import type { RoomProfile } from "./bus";
import { ambientCue, AMBIENT_BY_BIOME } from "./sfx";
import { BIOMES } from "@exiled/content-runtime";

describe("area ambience", () => {
  it("gives the hideout and each biome a deliberate loop", () => {
    expect(ambientCue(null)).toBe("ambient-hideout");
    expect(ambientCue("vaal_stone")).toBe("ambient-cave");
    expect(ambientCue("desert")).toBe("ambient-wind");
    expect(ambientCue("swamp")).toBe("ambient-swamp");
    expect(ambientCue("forest")).toBe("ambient-forest");
    expect(ambientCue("coast")).toBe("ambient-shore");
  });

  it("leaves no biome on the fallback", () => {
    // The Strand shipped playing the cave loop: a beach with cave reverb, and
    // nothing failed because the fallback answers for every id there is.
    for (const id of Object.keys(BIOMES)) {
      expect(AMBIENT_BY_BIOME[id], `${id} has no ambient of its own`).toBeDefined();
    }
  });
});

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

  /**
   * A grunt on every connect is a rattle, not a fight, so one hit in five to ten
   * is heard. Counted in HITS rather than in ticks: a fast weapon and a slow one
   * should sound equally sparse. The first hit always lands, or the opening of a
   * fight is the one part of it that is silent.
   */
  it("hears one hit in five to ten, and always the first", () => {
    const gaps = (played: (i: number) => boolean, hits = 60): number[] => {
      const at: number[] = [];
      for (let i = 0; i < hits; i++) if (played(i)) at.push(i);
      expect(at[0]).toBe(0);
      return at.slice(1).map((v, i) => v - (at[i] ?? 0));
    };

    const heard: string[] = [];
    const s = createSoundscape({ play: (n) => heard.push(n) });
    s.reset(null);
    s.observe(snap({ tick: 1, entities: [monster(1, 3, 200)] }));
    const monsterGaps = gaps((i) => {
      const before = heard.length;
      s.observe(snap({ tick: i + 2, entities: [monster(1, 3, 199 - i)] }));
      return heard.length > before;
    });

    const mine: string[] = [];
    const p = createSoundscape({ play: (n) => mine.push(n) });
    p.reset(null);
    p.observe(snap({ tick: 1, player: testPlayer({ life: 200 }) }));
    const playerGaps = gaps((i) => {
      const before = mine.length;
      p.observe(snap({ tick: i + 2, player: testPlayer({ life: 199 - i }) }));
      return mine.length > before;
    });

    for (const g of [...monsterGaps, ...playerGaps]) {
      expect(g).toBeGreaterThanOrEqual(5);
      expect(g).toBeLessThanOrEqual(10);
    }
    expect(monsterGaps.length).toBeGreaterThan(4);
    expect(playerGaps.length).toBeGreaterThan(4);
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

  it("an arrow looses when it appears and thuds only if it struck something", () => {
    const flying: SnapshotEntity = { id: 4, kind: "projectile", x: 1, y: 0, team: 0, skillId: "skill.snap_shot.v1" };
    expect(run([
      snap({ tick: 1, entities: [] }),
      snap({ tick: 2, entities: [flying] }),
      snap({ tick: 3, entities: [{ ...flying, x: 2, spent: true }] }),
      snap({ tick: 4, entities: [] }),
    ])).toEqual(["skill-bow-release", "skill-arrow-impact"]);
    // Out of range it simply drops: no thud on empty ground.
    expect(run([
      snap({ tick: 1, entities: [] }),
      snap({ tick: 2, entities: [flying] }),
      snap({ tick: 3, entities: [] }),
    ])).toEqual(["skill-bow-release"]);
  });

  it("a melee swing whooshes when the sim takes it and thuds only when it lands on something", () => {
    const at = (tick: number, cooldown: number, strikeTick?: number, strikeHits?: number) =>
      snap({ tick, player: { ...testPlayer(), cooldowns: { "skill.strike.v1": cooldown }, strikeTick, strikeHits } });
    expect(run([at(1, 0), at(2, 0.7), at(9, 0.4, 8, 2)])).toEqual(["skill-strike-swing", "skill-strike-impact"]);
    // A whiff: the swing, and silence where the blow would be.
    expect(run([at(1, 0), at(2, 0.7), at(9, 0.4, 8, 0)])).toEqual(["skill-strike-swing"]);
    // Held: the same landed swing is not heard again on the next snapshot.
    expect(run([at(1, 0, 8, 1), at(2, 0, 8, 1)])).toEqual([]);
  });

  it("each melee skill lands with its own impact, and an unnamed swing with Strike's", () => {
    const landed = (strikeSkill?: string) => run([
      snap({ tick: 1, player: { ...testPlayer() } }),
      snap({ tick: 2, player: { ...testPlayer(), strikeTick: 2, strikeHits: 1, strikeSkill } }),
    ]);
    expect(landed("skill.strike.v1")).toEqual(["skill-strike-impact"]);
    expect(landed("skill.heavy_strike.v1")).toEqual(["skill-heavy-strike-impact"]);
    expect(landed("skill.ground_slam.v1")).toEqual(["skill-ground-slam-impact"]);
    expect(landed(undefined)).toEqual(["skill-strike-impact"]);
  });

  it("Ember Spark casts and lands with its own cues and carries no flight bed", () => {
    const spark: SnapshotEntity = { id: 4, kind: "projectile", x: 1, y: 0, team: 0, skillId: "skill.ember_spark.v1" };
    const loops: string[] = [];
    const heard: string[] = [];
    const s = createSoundscape({ play: (n) => heard.push(n), loop: (n) => loops.push(n), stopLoop: () => {} });
    s.reset(null);
    for (const it of [
      snap({ tick: 1, player: testPlayer({ cooldowns: {} }) }),
      snap({ tick: 2, player: testPlayer({ cooldowns: { "skill.ember_spark.v1": 0.5 } }), entities: [spark] }),
      snap({ tick: 3, player: testPlayer({ cooldowns: { "skill.ember_spark.v1": 0.4 } }), entities: [] }),
    ]) s.observe(it);
    expect(heard).toEqual(["skill-ember-spark-cast", "skill-ember-spark-impact"]);
    expect(loops).toEqual([]);
  });

  it("the player dying is heard once, on the edge, and never for a corpse loaded or carried across", () => {
    const p = (alive: boolean) => testPlayer({ alive, life: alive ? 50 : 0 });
    const deaths = (seq: Snapshot[]) => run(seq).filter((n) => n === "player-death");
    expect(deaths([
      snap({ tick: 1, player: p(true) }),
      snap({ tick: 2, player: p(false) }),
      snap({ tick: 3, player: p(false) }),
      snap({ tick: 4, player: p(false) }),
    ])).toEqual(["player-death"]);
    // Loaded dead, or arriving dead in a new area: no edge was seen.
    expect(deaths([snap({ tick: 1, player: p(false) }), snap({ tick: 2, player: p(false) })])).toEqual([]);
    expect(deaths([
      snap({ tick: 1, area: "map", player: p(true) }),
      snap({ tick: 2, area: "hideout", player: p(false) }),
      snap({ tick: 3, area: "hideout", player: p(false) }),
    ])).toEqual([]);
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
   * A pool that SHRANK is not a pool that was emptied. Refunding a passive that
   * grants energy shield lowers the maximum, so the current value falls with it
   * and the naive "less than last snapshot" test heard a hit that never landed —
   * the character screamed while reading his own tree. Same for unequipping a
   * chest piece, which is the sibling case the one guard covers.
   */
  it("says nothing when the pool itself got smaller", () => {
    const hurt = (before: Partial<Snapshot["player"]>, after: Partial<Snapshot["player"]>) =>
      run([
        snap({ tick: 1, player: testPlayer(before) }),
        snap({ tick: 2, player: testPlayer(after) }),
      ]).filter((n) => n === "monster-melee-hit" || n === "player-hurt");

    expect(hurt(
      { energyShield: 40, maxEnergyShield: 40 },
      { energyShield: 0, maxEnergyShield: 0 },
    )).toEqual([]);
    expect(hurt(
      { life: 120, maxLife: 120 },
      { life: 100, maxLife: 100 },
    )).toEqual([]);
    // The pool held its size, so this one really is a hit.
    expect(hurt(
      { energyShield: 40, maxEnergyShield: 40 },
      { energyShield: 10, maxEnergyShield: 40 },
    )).toEqual(["player-hurt"]);
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

  it("the map opening is silent here; the portal whoosh belongs to the renderer", () => {
    expect(run([
      snap({ tick: 1, mapOpen: false }),
      snap({ tick: 2, mapOpen: true }),
    ])).toEqual([]);
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
      new Set(run(walk(), biome).filter((n) => n.startsWith("footstep")));
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
   * Which take plays is `playSfx`'s to pick; what the caller owns is the cue and the
   * level of each footfall, which has to differ from step to step.
   */
  it("each footfall plays the ground's cue at its own level", () => {
    const heard: Array<[string, number | undefined]> = [];
    const s = createSoundscape({ play: (n, v) => heard.push([n, v]) });
    s.reset("forest");
    for (const snapshot of walk(400)) s.observe(snapshot);

    const steps = heard.filter(([n]) => n.startsWith("footstep"));
    expect(steps.length).toBeGreaterThan(30);
    for (const [n] of steps) expect(n).toBe("footstep-grass");

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
    for (const s of steps) expect(s).toBe("footstep-mud");
  });

  it("a corpse does not walk", () => {
    const dead: Snapshot[] = [];
    for (let t = 1; t <= 40; t++) {
      dead.push(snap({ tick: t, player: testPlayer({ x: t * 0.1, alive: false, life: 0 }) }));
    }
    expect(run(dead).filter((n) => n.startsWith("footstep"))).toEqual([]);
  });
});

/**
 * A skill that lasts has to be HEARD lasting. A one-shot at the cast is over before
 * the bolt is halfway there and long over while the ground still burns, so anything
 * with a duration holds a sustained voice keyed to the entity that carries it.
 */
describe("sustained skills", () => {
  const projectile = (id: number, x: number): SnapshotEntity =>
    ({ id, kind: "projectile", x, y: 0, team: 0 });
  const burning = (id: number, x: number): SnapshotEntity =>
    ({ id, kind: "groundArea", x, y: 0, remainingSeconds: 3 });

  /** Drive snapshots and collect [event, cue, key] for the loop seams. */
  function runLoops(seq: Snapshot[]): [string, string, string][] {
    const log: [string, string, string][] = [];
    const s = createSoundscape({
      play: () => {},
      loop: (name, key) => log.push(["start", name, key]),
      stopLoop: (key) => log.push(["stop", "", key]),
    });
    s.reset(null);
    for (const it of seq) s.observe(it);
    return log;
  }

  it("the bolt is heard for as long as it is in the air", () => {
    const log = runLoops([
      snap({ tick: 1 }),
      snap({ tick: 2, entities: [projectile(9, 1)] }),
      snap({ tick: 3, entities: [projectile(9, 3)] }),
      snap({ tick: 4, entities: [] }),
    ]);
    expect(log[0]?.[0]).toBe("start");
    expect(log[0]?.[1]).toBe("skill-ember-bolt-flight");
    // Started once for the whole flight, not once per tick it is alive.
    expect(log.filter(([e]) => e === "start")).toHaveLength(1);
    expect(log.at(-1)?.[0]).toBe("stop");
    expect(log.at(-1)?.[2]).toBe(log[0]?.[2]);
  });

  it("the burning ground is heard until it burns out", () => {
    const log = runLoops([
      snap({ tick: 1 }),
      snap({ tick: 2, entities: [burning(4, 0)] }),
      snap({ tick: 3, entities: [burning(4, 0)] }),
      snap({ tick: 4, entities: [] }),
    ]);
    expect(log.map(([e, n]) => [e, n])).toEqual([
      ["start", "skill-cinder-ground-loop"],
      ["stop", ""],
    ]);
  });

  /**
   * The flight loop is read off the skill's own profile, not one bed shared by
   * every bolt kind: an arrow has no burning tail, so it gets no loop at all.
   */
  it("mutes the arrow's flight bed instead of giving it fire's tail", () => {
    const arrow: SnapshotEntity = { id: 9, kind: "projectile", x: 1, y: 0, team: 0, skillId: "skill.snap_shot.v1" };
    const log = runLoops([
      snap({ tick: 1 }),
      snap({ tick: 2, entities: [arrow] }),
    ]);
    expect(log).toEqual([]);
  });

  it("a monster's spit is not the player's skill", () => {
    const spit: SnapshotEntity = { id: 2, kind: "projectile", x: 1, y: 0, team: 1 };
    const log = runLoops([snap({ tick: 1 }), snap({ tick: 2, entities: [spit] })]);
    expect(log).toEqual([]);
  });

  /** Leaving the area kills every voice: the next world does not inherit this one's fire. */
  it("a new area silences what was still sounding", () => {
    const stopped: string[] = [];
    const s = createSoundscape({
      play: () => {}, loop: () => {}, stopLoop: () => {},
      stopAllLoops: () => stopped.push("all"),
    });
    s.reset(null);
    stopped.length = 0; // the first reset is the setup, not the journey
    s.observe(snap({ tick: 1, entities: [projectile(9, 1)] }));
    s.reset("swamp");
    expect(stopped).toEqual(["all"]);
  });
});

describe("environment", () => {
  /** Every reset's room profile, in order. */
  function rooms(biomeId: string | null | undefined): RoomProfile[] {
    const seen: RoomProfile[] = [];
    createSoundscape({ room: (p) => seen.push(p) }).reset(biomeId);
    return seen;
  }

  it("gives an enclosed biome more room than an open one, and the hideout something between", () => {
    const [stone] = rooms("vaal_stone");
    const [sand] = rooms("desert");
    const [hideout] = rooms(null);
    expect(stone!.amount).toBeGreaterThan(hideout!.amount);
    expect(hideout!.amount).toBeGreaterThan(sand!.amount);
  });

  it("hands the matching profile over, and the hideout's for null and unknown ids", () => {
    for (const [id, profile] of Object.entries(ROOM_PROFILE)) expect(rooms(id)).toEqual([profile]);
    expect(rooms(null)).toEqual([HIDEOUT_PROFILE]);
    expect(rooms("not_a_biome")).toEqual([HIDEOUT_PROFILE]);
    expect(rooms(undefined)).toEqual([]);
  });

  it("has a room profile for every biome with an ambient loop", () => {
    for (const id of Object.keys(AMBIENT_BY_BIOME)) {
      expect(ROOM_PROFILE[id], `${id} has no room profile`).toBeDefined();
    }
  });

  it("places a world cue at its source, and leaves the player's own cues on him", () => {
    const calls: Array<[string, { x: number; y: number } | undefined]> = [];
    const s = createSoundscape({ play: (n, _v, at) => calls.push([n, at]) });
    s.reset(null);
    s.observe(snap({ tick: 1, entities: [{ ...monster(1, 9), y: -2 }, monster(2, -6)] }));
    s.observe(snap({ tick: 2, player: testPlayer({ cooldowns: { "skill.ember_bolt.v1": 0.4 } }), entities: [] }));

    const deaths = calls.filter(([n]) => n.startsWith("monster-death"));
    expect(deaths.map(([, at]) => at)).toEqual([{ x: 9, y: -2 }, { x: -6, y: 0 }]);
    expect(calls.find(([n]) => n === "skill-ember-bolt-cast")?.[1]).toBeUndefined();
  });

  it("moves the listener to the player on every snapshot, before any cue of it", () => {
    const log: string[] = [];
    const s = createSoundscape({
      play: (n) => log.push(n),
      listener: (x, y) => log.push(`ear ${x},${y}`),
    });
    s.reset(null);
    s.observe(snap({ tick: 1, player: testPlayer({ x: 1, y: 2 }), entities: [monster(1, 3)] }));
    s.observe(snap({ tick: 2, player: testPlayer({ x: 1, y: 2 }), entities: [] }));
    expect(log).toEqual(["ear 1,2", "ear 1,2", "monster-death"]);
  });

  it("keeps a sustained cue bound to the source as it travels away", () => {
    const started: Array<[number, number]> = [];
    const moved: Array<[number, number]> = [];
    const s = createSoundscape({
      play: () => {},
      loop: (_name, _key, x, y) => started.push([x, y]),
      moveLoop: (_key, x, y) => moved.push([x, y]),
    });
    s.reset(null);
    s.observe(snap({ tick: 1 }));
    s.observe(snap({ tick: 2, entities: [{ id: 9, kind: "projectile", x: 1, y: 0, team: 0 }] }));
    s.observe(snap({ tick: 3, entities: [{ id: 9, kind: "projectile", x: 8, y: 2, team: 0 }] }));

    expect(started).toEqual([[1, 0]]);
    expect(moved.at(-1)).toEqual([8, 2]);
  });
});

describe("container open cue", () => {
  const chest = (opened?: boolean): SnapshotEntity =>
    ({ id: 9, kind: "container", x: 1, y: 0, ...(opened === undefined ? {} : { opened }) });
  const opens = (seq: Snapshot[]) => run(seq).filter((n) => n === "container-open").length;

  it("creaks once when a chest goes from shut to open", () => {
    expect(opens([
      snap({ tick: 1, entities: [chest(false)] }),
      snap({ tick: 2, entities: [chest(true)] }),
      snap({ tick: 3, entities: [chest(true)] }),
    ])).toBe(1);
    expect(opens([
      snap({ tick: 1, entities: [chest()] }),
      snap({ tick: 2, entities: [chest(true)] }),
    ])).toBe(1);
  });

  it("is silent for a chest that arrives open, and on the first snapshot", () => {
    expect(opens([snap({ tick: 1, entities: [chest(true)] })])).toBe(0);
    expect(opens([
      snap({ tick: 1, entities: [] }),
      snap({ tick: 2, entities: [chest(true)] }),
    ])).toBe(0);
  });
});

describe("gold pickup cue", () => {
  const pile = (id: number): SnapshotEntity => ({ id, kind: "gold", x: 1, y: 0, amount: 12, jackpot: false });
  const coins = (seq: Snapshot[]) => {
    let n = 0;
    const s = createSoundscape({ play: () => {}, coins: () => { n++; } });
    s.reset(null);
    for (const it of seq) s.observe(it);
    return n;
  };

  it("jingles once for each pile that left the floor", () => {
    expect(coins([
      snap({ tick: 1, entities: [pile(5), pile(6)] }),
      snap({ tick: 2, entities: [] }),
    ])).toBe(2);
  });

  it("jingles where the pile lay", () => {
    const at: Array<{ x: number; y: number }> = [];
    const s = createSoundscape({ play: () => {}, coins: (p) => { at.push(p); } });
    s.reset(null);
    s.observe(snap({ tick: 1, entities: [pile(5)] }));
    s.observe(snap({ tick: 2, entities: [] }));
    expect(at).toEqual([{ x: 1, y: 0 }]);
  });

  it("stays quiet when the area changed under the piles", () => {
    expect(coins([
      snap({ tick: 1, entities: [pile(5)] }),
      snap({ tick: 2, area: "hideout", entities: [] }),
    ])).toBe(0);
  });
});

describe("item and trade cues", () => {
  type Cell = Snapshot["inventory"]["items"][number];
  const item = (x: number, y: number, baseId: string, itemClass: string, count?: number): Cell =>
    ({ rarity: "normal", name: baseId, baseId, itemClass, lines: [], x, y, w: 1, h: 1, ...(count ? { count } : {}) });
  const bag = (...items: Cell[]): Snapshot["inventory"] => ({ cols: 12, rows: 5, items });

  it("an item landing on a new cell is set down in its material", () => {
    expect(run([
      snap({ tick: 1, inventory: bag(item(0, 0, "mace.a", "mace")) }),
      snap({ tick: 2, inventory: bag(item(3, 0, "mace.a", "mace")) }),
    ])).toEqual(["item-place-metal"]);
  });

  it("armour sounds by family: Ironsworn is plate, Stalker is leather", () => {
    const moved = (baseId: string, itemClass: string) => run([
      snap({ tick: 1, inventory: bag() }),
      snap({ tick: 2, inventory: bag(item(0, 0, baseId, itemClass)) }),
    ]);
    expect(moved("base.ironsworn_plate", "body")).toEqual(["item-place-metal"]);
    expect(moved("base.stalker_leathers", "body")).toEqual(["item-place-leather"]);
    expect(moved("base.ember_wand", "wand")).toEqual(["item-place-wood"]);
    expect(moved("map.waystone", "waystone")).toEqual(["item-place-stone"]);
  });

  it("a currency stack that grew was picked up; one that shrank was spent, silently", () => {
    const orbs = (n: number) => bag(item(0, 0, "currency.wisdom", "currency", n));
    expect(run([snap({ tick: 1, inventory: orbs(3) }), snap({ tick: 2, inventory: orbs(4) })]))
      .toEqual(["item-place-stone"]);
    expect(run([snap({ tick: 1, inventory: orbs(3) }), snap({ tick: 2, inventory: orbs(2) })])).toEqual([]);
  });

  it("an item changed where it lies (identified, crafted) or gone from the grid is silent", () => {
    const plain = item(0, 0, "mace.a", "mace");
    expect(run([
      snap({ tick: 1, inventory: bag(plain) }),
      snap({ tick: 2, inventory: bag({ ...plain, rarity: "rare", name: "Doom Knell" }) }),
      snap({ tick: 3, inventory: bag() }),
    ])).toEqual([]);
  });

  it("a whole grid rearranged at once is one set-down", () => {
    expect(run([
      snap({ tick: 1, inventory: bag(item(0, 0, "mace.a", "mace"), item(1, 0, "wand.a", "wand")) }),
      snap({ tick: 2, inventory: bag(item(5, 0, "mace.a", "mace"), item(6, 0, "wand.a", "wand")) }),
    ])).toHaveLength(1);
  });

  it("a slot that took a new piece is an equip, and the swapped-out piece is not also set down", () => {
    const plate = { rarity: "normal" as const, name: "Plate", baseId: "base.ironsworn_plate", itemClass: "body", lines: [] };
    const robe = { rarity: "magic" as const, name: "Robe", baseId: "base.ember_robe", itemClass: "body", lines: [] };
    expect(run([
      snap({ tick: 1, equipment: { body: plate }, inventory: bag(item(0, 0, "base.ember_robe", "body")) }),
      snap({ tick: 2, equipment: { body: robe }, inventory: bag(item(0, 0, "base.ironsworn_plate", "body")) }),
    ])).toEqual(["item-equip-leather"]);
  });

  it("a slot emptied into the bag is a set-down, not an equip", () => {
    const plate = { rarity: "normal" as const, name: "Plate", baseId: "base.ironsworn_plate", itemClass: "body", lines: [] };
    expect(run([
      snap({ tick: 1, equipment: { body: plate }, inventory: bag() }),
      snap({ tick: 2, equipment: {}, inventory: bag(item(0, 0, "base.ironsworn_plate", "body")) }),
    ])).toEqual(["item-place-metal"]);
  });

  it("gold that left the purse for a piece in the bag is a purchase, and only that", () => {
    expect(run([
      snap({ tick: 1, player: testPlayer({ gold: 100 }), inventory: bag() }),
      snap({ tick: 2, player: testPlayer({ gold: 60 }), inventory: bag(item(0, 0, "mace.a", "mace")) }),
    ])).toEqual(["trade-buy"]);
  });

  it("gold spent on nothing that landed in the bag is not a purchase", () => {
    expect(run([
      snap({ tick: 1, player: testPlayer({ gold: 100 }) }),
      snap({ tick: 2, player: testPlayer({ gold: 60 }) }),
    ])).toEqual([]);
  });

  it("says nothing about items across an area change", () => {
    expect(run([
      snap({ tick: 1, inventory: bag() }),
      snap({ tick: 2, area: "hideout", inventory: bag(item(0, 0, "mace.a", "mace")) }),
    ])).toEqual([]);
  });
});
