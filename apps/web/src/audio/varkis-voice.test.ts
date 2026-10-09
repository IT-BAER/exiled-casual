import { describe, it, expect } from "vitest";
import type { Snapshot, SnapshotEntity } from "@exiled/protocol";
import { testPlayer } from "../test-fixtures";
import { createVarkisVoice, VARKIS_SFX } from "./varkis-voice";

const vendor: SnapshotEntity = { id: 3, kind: "vendor", x: 10, y: 0 };

function snap(area: "hideout" | "map", x: number): Snapshot {
  return {
    tick: 1, area, portalsLeft: 6, mapOpen: false, areaTier: 0, atlasSeed: 0, completedNodes: [],
    player: testPlayer({ x, y: 0 }),
    entities: area === "hideout" ? [vendor] : [],
    inventory: { cols: 12, rows: 5, items: [] },
    stash: { cols: 12, rows: 12, items: [] },
    vendor: { cols: 12, rows: 12, items: [] },
    equipment: {},
    shards: {},
  };
}

/** A voice whose lines each last `seconds`, on a clock the test moves. */
function rig(seconds = 2) {
  const heard: string[] = [];
  let t = 0;
  const voice = createVarkisVoice({ play: (n) => { heard.push(n); return seconds; }, now: () => t });
  return { heard, voice, advance: (s: number) => { t += s; } };
}

describe("Varkis's voice", () => {
  it("names every line as a two-take npc cue", () => {
    expect(VARKIS_SFX.filter((n) => n.startsWith("npc-varkis-greet-"))).toHaveLength(4);
    expect(VARKIS_SFX.filter((n) => n.startsWith("npc-varkis-shop-"))).toHaveLength(4);
    expect(VARKIS_SFX.filter((n) => n.startsWith("npc-varkis-bye-"))).toHaveLength(3);
  });

  it("greets on the first approach of a hideout visit, and again only after leaving and coming back", () => {
    const { heard, voice, advance } = rig();
    for (const x of [0, 9, 9, 0, 9]) { voice.observe(snap("hideout", x)); advance(5); }
    expect(heard.filter((n) => n.includes("greet"))).toHaveLength(1);
    voice.observe(snap("map", 0)); advance(5);
    voice.observe(snap("hideout", 0)); advance(5);
    voice.observe(snap("hideout", 9));
    expect(heard.filter((n) => n.includes("greet"))).toHaveLength(2);
  });

  it("speaks when his window opens and when it closes, not for a window that was never open", () => {
    const { heard, voice, advance } = rig();
    voice.window(false);
    expect(heard).toEqual([]);
    voice.window(true); advance(5);
    voice.window(true); advance(5);
    voice.window(false);
    expect(heard.map((n) => n.replace(/-\d+$/, ""))).toEqual(["npc-varkis-shop", "npc-varkis-bye"]);
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
    voice.observe(snap("hideout", 9));
    advance(5);
    voice.observe(snap("hideout", 9));
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

  it("a line that could not play does not hold the voice", () => {
    const heard: string[] = [];
    const voice = createVarkisVoice({ play: (n) => { heard.push(n); return 0; }, now: () => 0 });
    voice.window(true);
    voice.window(false);
    expect(heard).toHaveLength(2);
  });
});
