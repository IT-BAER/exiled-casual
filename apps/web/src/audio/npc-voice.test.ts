import { describe, it, expect } from "vitest";
import type { Snapshot, SnapshotEntity } from "@exiled/protocol";
import { testPlayer } from "../test-fixtures";
import {
  createNpcVoice, IDLE_GAP_S, IDLE_RADIUS, MAREN, MAREN_SFX, VARKIS, VARKIS_SFX, type Npc,
} from "./npc-voice";

function snap(area: "hideout" | "map", x: number, entities: SnapshotEntity[]): Snapshot {
  return {
    tick: 1, area, portalsLeft: 6, mapOpen: false, areaTier: 0, atlasSeed: 0, completedNodes: [],
    player: testPlayer({ x, y: 0 }),
    entities: area === "hideout" ? entities : [],
    inventory: { cols: 12, rows: 5, items: [] },
    stash: { cols: 12, rows: 12, items: [] },
    vendor: { cols: 12, rows: 12, items: [] },
    equipment: {},
    shards: {},
  };
}

describe.each([
  { npc: VARKIS, sfx: VARKIS_SFX },
  { npc: MAREN, sfx: MAREN_SFX },
])("$npc.id's voice", ({ npc, sfx }: { npc: Npc; sfx: readonly string[] }) => {
  const self: SnapshotEntity = { id: 3, kind: npc.kind, x: 10, y: 0 };
  const at = (area: "hideout" | "map", x: number) => snap(area, x, [self]);

  /** A voice whose lines each last `seconds`, on a clock the test moves. */
  function rig(seconds = 2) {
    const heard: string[] = [];
    let t = 0;
    const voice = createNpcVoice(npc, { play: (n) => { heard.push(n); return seconds; }, now: () => t });
    return { heard, voice, advance: (s: number) => { t += s; } };
  }

  it("names every line as a two-take npc cue", () => {
    expect(sfx.filter((n) => n.startsWith(`npc-${npc.id}-greet-`))).toHaveLength(4);
    expect(sfx.filter((n) => n.startsWith(`npc-${npc.id}-shop-`))).toHaveLength(4);
    expect(sfx.filter((n) => n.startsWith(`npc-${npc.id}-bye-`))).toHaveLength(3);
  });

  it("greets on the first approach of a hideout visit, and again only after leaving and coming back", () => {
    const { heard, voice, advance } = rig();
    for (const x of [0, 9, 9, 0, 9]) { voice.observe(at("hideout", x)); advance(5); }
    expect(heard.filter((n) => n.includes("greet"))).toHaveLength(1);
    voice.observe(at("map", 0)); advance(5);
    voice.observe(at("hideout", 0)); advance(5);
    voice.observe(at("hideout", 9));
    expect(heard.filter((n) => n.includes("greet"))).toHaveLength(2);
  });

  it("speaks when the window opens and when it closes, not for a window that was never open", () => {
    const { heard, voice, advance } = rig();
    voice.window(false);
    expect(heard).toEqual([]);
    voice.window(true); advance(5);
    voice.window(true); advance(5);
    voice.window(false);
    expect(heard.map((n) => n.replace(/-\d+$/, ""))).toEqual([`npc-${npc.id}-shop`, `npc-${npc.id}-bye`]);
  });

  it("never starts a line over one still playing", () => {
    const { heard, voice, advance } = rig(2);
    voice.window(true);
    advance(1);
    voice.window(false);
    expect(heard).toHaveLength(1);
    advance(1.5);
    voice.window(true);
    expect(heard).toHaveLength(2);
  });

  it("a greeting cut off by a line in progress is spent, not queued", () => {
    const { heard, voice, advance } = rig(2);
    voice.window(true);
    voice.observe(at("hideout", 9));
    advance(5);
    voice.observe(at("hideout", 9));
    expect(heard.filter((n) => n.includes("greet"))).toHaveLength(0);
  });

  it("never says the same line twice in a row within a group, and uses them all", () => {
    const { heard, voice, advance } = rig(1);
    for (let i = 0; i < 200; i++) { voice.window(i % 2 === 0); advance(2); }
    const shop = heard.filter((n) => n.includes("shop"));
    const bye = heard.filter((n) => n.includes("bye"));
    expect(shop).toHaveLength(100);
    expect(bye).toHaveLength(100);
    for (const group of [shop, bye]) {
      for (let i = 1; i < group.length; i++) expect(group[i]).not.toBe(group[i - 1]);
    }
    expect(new Set(shop).size).toBe(4);
    expect(new Set(bye).size).toBe(3);
  });

  it("greets from where the speaker stands, not from the middle of the head", () => {
    const where: unknown[] = [];
    const voice = createNpcVoice(npc, { play: (_n, w) => { where.push(w); return 2; }, now: () => 0 });
    voice.observe(at("hideout", 9));
    expect(where).toEqual([{ x: 10, y: 0 }]);
  });

  it("speaks the shop and parting lines from where the last hideout snapshot saw the speaker", () => {
    const where: unknown[] = [];
    let t = 0;
    const voice = createNpcVoice(npc, { play: (_n, w) => { where.push(w); return 1; }, now: () => t });
    voice.observe(at("hideout", 0)); // too far to greet
    voice.window(true); t += 5;
    voice.observe(at("map", 0)); // leaving the hideout does not move them
    voice.window(false);
    expect(where).toEqual([{ x: 10, y: 0 }, { x: 10, y: 0 }]);
  });

  it("with no sight of the speaker yet, a line still plays, on the player", () => {
    const where: unknown[] = [];
    const voice = createNpcVoice(npc, { play: (_n, w) => { where.push(w); return 1; }, now: () => 0 });
    voice.window(true);
    expect(where).toEqual([null]);
  });

  it("a line that could not play does not hold the voice", () => {
    const heard: string[] = [];
    const voice = createNpcVoice(npc, { play: (n) => { heard.push(n); return 0; }, now: () => 0 });
    voice.window(true);
    voice.window(false);
    expect(heard).toHaveLength(2);
  });
});

describe("Maren's asides", () => {
  const self: SnapshotEntity = { id: 9, kind: "cartographer", x: 10, y: 0 };
  /** The player at `x`, Maren at 10; lines last a second; the clock and the dice are the test's. */
  function rig(random = () => 0) {
    const heard: string[] = [];
    let t = 0;
    const voice = createNpcVoice(MAREN, { play: (n) => { heard.push(n); return 1; }, now: () => t, random });
    const asides = () => heard.filter((n) => n.includes("idle"));
    return { voice, asides, step: (x: number, to: number) => { t = to; voice.observe(snap("hideout", x, [self])); } };
  }

  it("names four aside lines", () => {
    expect(MAREN_SFX.filter((n) => n.startsWith("npc-maren-idle-"))).toHaveLength(4);
    expect(VARKIS_SFX.some((n) => n.includes("idle"))).toBe(false);
  });

  it("waits minutes, not seconds", () => {
    expect(IDLE_GAP_S[0]).toBeGreaterThanOrEqual(180);
    expect(IDLE_GAP_S[1]).toBeGreaterThan(IDLE_GAP_S[0]);
  });

  it("never talks to herself while the player walks about near her, however long", () => {
    const { asides, step } = rig();
    for (let t = 0; t <= 3 * IDLE_GAP_S[1]; t += 5) step(t % 10 === 0 ? 4 : 5, t);
    expect(asides()).toHaveLength(0);
  });

  it("says one once the player has stood still for the gap, and the next a fresh gap later", () => {
    const { asides, step } = rig();
    step(5, 0);
    step(5, IDLE_GAP_S[0] - 1);
    expect(asides()).toHaveLength(0);
    step(5, IDLE_GAP_S[0]);
    expect(asides()).toHaveLength(1);
    step(5, 2 * IDLE_GAP_S[0] - 1);
    expect(asides()).toHaveLength(1);
    step(5, 2 * IDLE_GAP_S[0]);
    expect(asides()).toHaveLength(2);
  });

  it("starts the wait over when the player moves", () => {
    const { asides, step } = rig();
    step(5, 0);
    step(5, IDLE_GAP_S[0] - 10);
    step(6, IDLE_GAP_S[0] - 5);
    step(6, IDLE_GAP_S[0] + 1);
    expect(asides()).toHaveLength(0);
    step(6, 2 * IDLE_GAP_S[0] - 5);
    expect(asides()).toHaveLength(1);
  });

  it("spaces them by a random gap inside the bounds", () => {
    const { asides, step } = rig(() => 0.999);
    step(5, 0);
    step(5, IDLE_GAP_S[1] - 1);
    expect(asides()).toHaveLength(0);
    step(5, IDLE_GAP_S[1]);
    expect(asides()).toHaveLength(1);
  });

  it("keeps quiet across the room, and while her table is open", () => {
    const far = rig();
    far.step(10 - IDLE_RADIUS - 1, 0);
    far.step(10 - IDLE_RADIUS - 1, 1000);
    expect(far.asides()).toHaveLength(0);
    const shopping = rig();
    shopping.step(5, 0);
    shopping.voice.window(true);
    shopping.step(5, 1000);
    expect(shopping.asides()).toHaveLength(0);
  });

  it("starts the wait over on every hideout visit", () => {
    const { asides, step, voice } = rig();
    step(5, 0);
    voice.observe(snap("map", 5, []));
    step(5, 500);
    step(5, 500 + IDLE_GAP_S[0] - 1);
    expect(asides()).toHaveLength(0);
  });

  it("Varkis has none", () => {
    const heard: string[] = [];
    const varkis: SnapshotEntity = { id: 3, kind: "vendor", x: 10, y: 0 };
    let t = 0;
    const voice = createNpcVoice(VARKIS, { play: (n) => { heard.push(n); return 1; }, now: () => t, random: () => 0 });
    for (t = 0; t < 2000; t += 10) voice.observe(snap("hideout", 5, [varkis]));
    expect(heard.filter((n) => !n.includes("greet"))).toEqual([]);
  });
});

describe("two people in one hideout", () => {
  it("each greets only on an approach to them, from where they stand", () => {
    const varkis: SnapshotEntity = { id: 3, kind: "vendor", x: 10, y: 0 };
    const maren: SnapshotEntity = { id: 9, kind: "cartographer", x: -10, y: 0 };
    const heard: string[] = [];
    const voices = [VARKIS, MAREN].map((npc) =>
      createNpcVoice(npc, { play: (n) => { heard.push(n); return 1; }, now: () => 0 }));
    for (const v of voices) v.observe(snap("hideout", -9, [varkis, maren]));
    expect(heard.map((n) => n.replace(/-\d+-?\d*$/, ""))).toEqual(["npc-maren-greet"]);
  });
});
