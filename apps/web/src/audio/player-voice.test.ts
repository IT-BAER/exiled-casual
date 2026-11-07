import { describe, it, expect } from "vitest";
import type { Snapshot, SnapshotEntity } from "@exiled/protocol";
import { testPlayer } from "../test-fixtures";
import {
  createPlayerVoice, playerVoiceSfx, speakerFor, PLAYER_GROUPS, SPEAKERS,
  ENTER_CHANCE, GRUNT_GAP_S, LEVEL_DELAY_S, LOOT_DELAY_S, LOOT_GAP_S, STREAK_GAP_S,
} from "./player-voice";

type Over = Partial<Snapshot["player"]> & { area?: "hideout" | "map"; entities?: SnapshotEntity[]; tick?: number };

function snap(over: Over = {}): Snapshot {
  const { area = "map", entities = [], tick = 1, ...player } = over;
  return {
    tick, area, portalsLeft: 6, mapOpen: area === "map", areaTier: 1, atlasSeed: 0, completedNodes: [],
    player: testPlayer(player),
    entities,
    inventory: { cols: 12, rows: 5, items: [] },
    stash: { cols: 12, rows: 12, items: [] },
    vendor: { cols: 12, rows: 12, items: [] },
    equipment: {},
    shards: {},
  };
}

const monster = (id: number, over: Partial<SnapshotEntity> = {}): SnapshotEntity =>
  ({ id, kind: "monster", x: 5, y: 0, life: 10, maxLife: 10, ...over });
const loot = (id: number, rarity: "normal" | "magic" | "rare" | "unique"): SnapshotEntity =>
  ({ id, kind: "groundItem", x: 2, y: 0, rarity, name: "x" });

/** A voice whose lines each last `seconds`, on a clock the test moves; `random` 0 picks the first line. */
function rig(seconds = 1, random = () => 0) {
  const heard: string[] = [];
  let t = 100;
  const voice = createPlayerVoice("stalker-male", {
    play: (n) => { heard.push(n); return seconds; }, now: () => t, random,
  });
  /** The group of every line heard, in order. */
  const groups = () => heard.map((n) => n.replace(/^voice-stalker-male-/, "").replace(/-\d+$/, ""));
  return { heard, groups, voice, advance: (s: number) => { t += s; } };
}

describe("player voice", () => {
  it("names one speaker per class and body, each with every group's lines", () => {
    expect(SPEAKERS).toEqual(["ironsworn-male", "stalker-male", "emberbound-female"]);
    expect(speakerFor("class.emberbound", "female")).toBe("emberbound-female");
    const total = Object.values(PLAYER_GROUPS).reduce((a, b) => a + b, 0);
    for (const s of SPEAKERS) {
      const sfx = playerVoiceSfx(s);
      expect(sfx).toHaveLength(total);
      expect(sfx).toContain(`voice-${s}-hurt-${PLAYER_GROUPS.hurt}`);
    }
  });

  it("grunts on a hit for 8% of the pool, cries on 25%, and stays silent under that", () => {
    const { groups, voice, advance } = rig();
    voice.observe(snap({ life: 100 }), snap({ life: 95 }));
    expect(groups()).toEqual([]);
    voice.observe(snap({ life: 95 }), snap({ life: 85 }));
    advance(5);
    voice.observe(snap({ life: 85 }), snap({ life: 55 }));
    expect(groups()).toEqual(["hurt", "pain"]);
  });

  it("counts energy shield in the pool it measures a hit against", () => {
    const { groups, voice } = rig();
    const full = { life: 100, maxLife: 100, energyShield: 100, maxEnergyShield: 100 };
    voice.observe(snap(full), snap({ ...full, energyShield: 90 }));
    expect(groups()).toEqual([]);
    voice.observe(snap(full), snap({ ...full, energyShield: 80 }));
    expect(groups()).toEqual(["hurt"]);
  });

  it("keeps grunts GRUNT_GAP_S apart", () => {
    const { groups, voice, advance } = rig(0.2);
    voice.observe(snap({ life: 100 }), snap({ life: 90 }));
    advance(GRUNT_GAP_S - 0.1);
    voice.observe(snap({ life: 90 }), snap({ life: 80 }));
    advance(0.2);
    voice.observe(snap({ life: 80 }), snap({ life: 70 }));
    expect(groups()).toEqual(["hurt", "hurt"]);
  });

  it("does not hear a pool that shrank as a hit", () => {
    const { heard, voice } = rig();
    voice.observe(snap({ life: 100, maxLife: 100 }), snap({ life: 60, maxLife: 60 }));
    expect(heard).toEqual([]);
  });

  it("speaks of low life once per dip and re-arms above 60%", () => {
    const { groups, voice, advance } = rig(0.1);
    // A 4% step each time stays under the grunt threshold.
    const walk = (from: number, to: number) => { voice.observe(snap({ life: from }), snap({ life: to })); advance(2); };
    walk(32, 28); walk(28, 24); walk(24, 50);
    expect(groups()).toEqual(["low"]);
    walk(50, 61);
    for (let l = 61; l > 29; l -= 4) walk(l, l - 4);
    expect(groups()).toEqual(["low", "low"]);
  });

  it("calls a streak at five kills inside four seconds, then waits STREAK_GAP_S", () => {
    const { groups, voice, advance } = rig(0.1);
    const pack = (n: number, from = 0) => Array.from({ length: n }, (_, i) => monster(from + i + 1));
    const kill = (n: number, from = 0) => { voice.observe(snap({ entities: pack(n, from) }), snap()); advance(0.5); };
    kill(4);
    expect(groups()).toEqual([]);
    kill(1, 10);
    expect(groups()).toEqual(["streak"]);
    kill(5, 20);
    expect(groups()).toEqual(["streak"]);
    advance(STREAK_GAP_S);
    kill(5, 30);
    expect(groups()).toEqual(["streak", "streak"]);
  });

  it("forgets kills older than the streak window", () => {
    const { groups, voice, advance } = rig(0.1);
    voice.observe(snap({ entities: [1, 2, 3, 4].map((i) => monster(i)) }), snap());
    advance(4.5);
    voice.observe(snap({ entities: [monster(9)] }), snap());
    expect(groups()).toEqual([]);
  });

  it("greets a boss once when it wakes, and speaks over its body when it falls", () => {
    const { groups, voice, advance } = rig(0.5);
    const asleep = monster(7, { boss: true, bossPhase: 1 });
    const awake = { ...asleep, bossAwake: true };
    voice.observe(snap({ entities: [asleep] }), snap({ entities: [asleep] }));
    expect(groups()).toEqual([]);
    voice.observe(snap({ entities: [asleep] }), snap({ entities: [awake] }));
    advance(1);
    voice.observe(snap({ entities: [awake] }), snap({ entities: [awake] }));
    expect(groups()).toEqual(["boss"]);
    advance(1);
    voice.observe(snap({ entities: [awake] }), snap());
    expect(groups()).toEqual(["boss", "slain"]);
  });

  it("waits for a free mouth to greet a boss rather than dropping the line", () => {
    const { groups, voice, advance } = rig(1);
    const awake = monster(7, { boss: true, bossPhase: 1, bossAwake: true });
    voice.observe(snap({ life: 100, entities: [awake] }), snap({ life: 85, entities: [awake] }));
    expect(groups()).toEqual(["hurt"]);
    advance(1.1);
    voice.observe(snap({ life: 85, entities: [awake] }), snap({ life: 85, entities: [awake] }));
    expect(groups()).toEqual(["hurt", "boss"]);
  });

  it("notices a rare or unique drop LOOT_DELAY_S after it lands, at most every LOOT_GAP_S", () => {
    const { groups, voice, advance } = rig(0.1);
    voice.observe(snap(), snap({ entities: [loot(1, "magic")] }));
    voice.observe(snap(), snap({ entities: [loot(2, "rare")] }));
    expect(groups()).toEqual([]);
    advance(LOOT_DELAY_S);
    voice.observe(snap(), snap());
    expect(groups()).toEqual(["loot"]);
    advance(1);
    voice.observe(snap(), snap({ entities: [loot(3, "unique")] }));
    advance(LOOT_DELAY_S); voice.observe(snap(), snap());
    expect(groups()).toEqual(["loot"]);
    advance(LOOT_GAP_S);
    voice.observe(snap(), snap({ entities: [loot(4, "unique")] }));
    advance(LOOT_DELAY_S); voice.observe(snap(), snap());
    expect(groups()).toEqual(["loot", "loot"]);
  });

  it("speaks of a level gained LEVEL_DELAY_S after it, so the level-up cue goes first", () => {
    const { groups, voice, advance } = rig();
    voice.observe(snap({ level: 3 }), snap({ level: 4 }));
    expect(groups()).toEqual([]);
    advance(LEVEL_DELAY_S);
    voice.observe(snap({ level: 4 }), snap({ level: 4 }));
    expect(groups()).toEqual(["level"]);
  });

  it("always speaks on death, even over a line still playing", () => {
    const { groups, voice } = rig(5);
    voice.observe(snap({ life: 100 }), snap({ life: 85 }));
    voice.observe(snap({ life: 85 }), snap({ life: 0, alive: false }));
    expect(groups()).toEqual(["hurt", "death"]);
  });

  it("drops what was waiting when he dies", () => {
    const { groups, voice, advance } = rig(0.1);
    voice.observe(snap({ level: 3 }), snap({ level: 4 }));
    voice.observe(snap({ life: 100 }), snap({ life: 0, alive: false }));
    advance(LEVEL_DELAY_S + 1);
    voice.observe(snap({ life: 0, alive: false }), snap({ life: 0, alive: false }));
    expect(groups()).toEqual(["death"]);
  });

  it("speaks on entering a map at ENTER_CHANCE, and never on entering the hideout", () => {
    const enter = (roll: number, area: "hideout" | "map") => {
      const { groups, voice, advance } = rig(0.1, () => roll);
      voice.observe(null, snap({ area }));
      advance(2);
      voice.observe(snap({ area }), snap({ area }));
      return groups();
    };
    expect(enter(ENTER_CHANCE - 0.01, "map")).toEqual(["enter"]);
    expect(enter(ENTER_CHANCE + 0.01, "map")).toEqual([]);
    expect(enter(0, "hideout")).toEqual([]);
  });

  it("drops a grunt while a line is still playing", () => {
    const { groups, voice, advance } = rig(3);
    voice.observe(snap({ life: 100 }), snap({ life: 90 }));
    advance(GRUNT_GAP_S + 0.1);
    voice.observe(snap({ life: 90 }), snap({ life: 80 }));
    expect(groups()).toEqual(["hurt"]);
  });

  it("never says the same line twice in a row", () => {
    const { heard, voice, advance } = rig(0.1);
    for (let i = 0; i < 4; i++) {
      voice.observe(snap({ life: 100 }), snap({ life: 90 }));
      advance(GRUNT_GAP_S);
    }
    for (let i = 1; i < heard.length; i++) expect(heard[i]).not.toBe(heard[i - 1]);
  });
});
