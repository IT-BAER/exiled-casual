import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { MONSTERS } from "@exiled/content-runtime";
import type { Shoreline } from "@exiled/mapgen";
import {
  AMBIENT_BY_BIOME, AMBIENT_DETAIL, BED_DRIFT_PAN, BED_SWELL_DB, BED_SWELL_S, CORE_SFX, DETAIL_GAP_S,
  DETAIL_LEVEL_DB, DETAIL_MIN_TURN, DETAIL_RADIUS, SEA_PAN, ambientCue, distanceCutoff,
  distanceRolloff, moveSfxLoop, playSfx, playSfxAt, preloadSfx, resetSfx, setAmbient, setSfxListener,
  sfxCategory, startSfxLoop, startSfxLoopAt, stopAmbient, stopSfxLoop, toListenerSpace,
} from "./sfx";
import { VARKIS_SFX } from "./varkis-voice";
import { ITEM_MATERIALS } from "./soundscape";

/** `fake.ctx` is null until a test installs a stand-in context, as in headless jsdom.
 *  `sends` records every `send(b, node, wet, category, spatial)` and hands back its wet gain. */
const fake = vi.hoisted(() => ({
  ctx: null as unknown,
  sends: [] as Array<{
    wet: number; category: unknown; spatial: unknown;
    out: { gain: { value: number; setTargetAtTime: (v: number) => void } };
  }>,
}));
vi.mock("./bus", async (orig) => ({
  ...(await orig<typeof import("./bus")>()),
  bus: () => (fake.ctx ? { ctx: fake.ctx } : null),
  send: (_b: unknown, _node: unknown, wet: number, category: unknown, spatial: unknown) => {
    const out = { gain: { value: wet, setTargetAtTime(v: number) { this.value = v; } } };
    fake.sends.push({ wet, category, spatial, out });
    return out;
  },
}));

const DIR = resolve(__dirname, "../../public/audio");
const SRC = resolve(__dirname, "sfx.ts");

/** Cue name -> takes, read out of the source so the list cannot drift from the table. */
function voiceTakes(): Record<string, number> {
  const body = readFileSync(SRC, "utf8");
  const table = body.slice(body.indexOf("const VOICES"), body.indexOf("export type SfxName"));
  return Object.fromEntries([...table.matchAll(/"([a-z0-9-]+)":\s*\{[^}]*\}/g)]
    .map((m) => [m[1]!, Number(/takes:\s*(\d+)/.exec(m[0])?.[1] ?? 1)]));
}

function voiceNames(): string[] {
  return Object.keys(voiceTakes());
}

/** Every file the cues need on disk, without the extension: `<cue>-1..n` for a pool. */
function voiceFiles(): string[] {
  return Object.entries(voiceTakes()).flatMap(([name, n]) =>
    n < 2 ? [name] : Array.from({ length: n }, (_, i) => `${name}-${i + 1}`));
}

function voiceGain(name: string): number {
  const body = readFileSync(SRC, "utf8");
  const match = new RegExp(`"${name}":\\s*\\{\\s*gain:\\s*([\\d.]+)`).exec(body);
  return Number(match?.[1]);
}

describe("sfx assets", () => {
  /**
   * A voice with no file is a silence nobody notices until they are listening for
   * it, and a file with no voice is dead weight in the bundle. Both are cheap to
   * pin and impossible to spot by eye.
   */
  it("every voice has a file and every file has a voice", () => {
    const voices = voiceFiles();
    expect(voices.length).toBeGreaterThan(10);
    const onDisk = readdirSync(DIR).filter((f) => f.endsWith(".webm")).map((f) => f.slice(0, -5));
    expect([...voices].sort()).toEqual([...onDisk].sort());
  });

  it("everything preloaded is a real voice", () => {
    const voices = new Set(voiceNames());
    for (const name of CORE_SFX) expect(voices.has(name), name).toBe(true);
  });

  it("the cues the soundscape can emit all exist", () => {
    const voices = new Set(voiceNames());
    const body = readFileSync(resolve(__dirname, "soundscape.ts"), "utf8");
    const emitted = [...body.matchAll(/play\("([a-z0-9-]+)"/g)].map((m) => m[1]!);
    const cast = [...body.matchAll(/"skill\.[a-z_.0-9]+":\s*"([a-z0-9-]+)"/g)].map((m) => m[1]!);
    // The flight and impact cues moved into per-skill profiles (skill-fx.ts):
    // the loop reads them off fxProfile() rather than a literal in soundscape.ts.
    const fxBody = readFileSync(resolve(__dirname, "../render/skill-fx.ts"), "utf8");
    const fx = [...fxBody.matchAll(/(?:flightCue|impactCue):\s*"([a-z0-9-]+)"/g)].map((m) => m[1]!);
    expect(emitted.length + fx.length).toBeGreaterThan(5);
    for (const name of [...emitted, ...cast, ...fx]) expect(voices.has(name), name).toBe(true);
  });

  /**
   * `play(cueFor(...))` is invisible to the literal scan above, so the species cues
   * need their own pin — and the interesting half is the other direction: a monster
   * added to the bestiary with no material silently falls back to the generic cue,
   * which is exactly the "sounds generic" complaint this work exists to fix.
   */
  it("every item material can be set down and worn, and the bench and the cursor have theirs", () => {
    const voices = new Set(voiceNames());
    for (const m of ITEM_MATERIALS) {
      expect(voices.has(`item-place-${m}`), `place ${m}`).toBe(true);
      expect(voices.has(`item-equip-${m}`), `equip ${m}`).toBe(true);
    }
    for (const name of ["item-lift", "trade-sell", "trade-buy"]) expect(voices.has(name), name).toBe(true);
  });

  it("every material has both cues, and every monster has a material", () => {
    const body = readFileSync(resolve(__dirname, "soundscape.ts"), "utf8");
    const table = body.slice(body.indexOf("const MATERIAL"), body.indexOf("function cueFor"));
    const entries = [...table.matchAll(/"(monster\.[a-z_0-9.]+)":\s*"([a-z]+)"/g)];
    const voices = new Set(voiceNames());

    for (const material of new Set(entries.map((m) => m[2]!))) {
      expect(voices.has(`monster-hurt-${material}`), `hurt ${material}`).toBe(true);
      expect(voices.has(`monster-death-${material}`), `death ${material}`).toBe(true);
    }

    const mapped = new Set(entries.map((m) => m[1]!));
    const unmapped = [...MONSTERS.keys()].filter((id) => !mapped.has(id));
    expect(unmapped).toEqual([]);
  });

  /**
   * Footstep cues are built from the ground, so they are invisible to the literal
   * scan above — the same blind spot as `cueFor`. A ground one take short would not
   * be silent, it would quietly stop varying.
   */
  it("every ground is a three-take cue, and the fallback ground is one of them", () => {
    const body = readFileSync(resolve(__dirname, "soundscape.ts"), "utf8");
    const table = body.slice(body.indexOf("const GROUND:"), body.indexOf("const DEFAULT_GROUND"));
    // Deduped: GROUND is keyed on what the ear hears, so two biomes may name the
    // same floor (the strand and the desert both walk on dirt).
    const grounds = [...new Set([...table.matchAll(/:\s*"([a-z]+)",/g)].map((m) => m[1]!))];
    const fallback = /const DEFAULT_GROUND = "([a-z]+)"/.exec(body)?.[1];
    const takes = voiceTakes();

    expect(grounds.length).toBeGreaterThan(1);
    expect(grounds).toContain(fallback);
    for (const ground of grounds) expect(takes[`footstep-${ground}`], ground).toBe(3);
    // And nothing else: a leftover from a renamed ground ships bytes nobody plays.
    expect(Object.keys(takes).filter((n) => n.startsWith("footstep")).length).toBe(grounds.length);
  });

  /**
   * The exact failure the first audio pass shipped: ten of these files held silence
   * or near-silence, and nothing in the codebase could tell. Opus spends almost no
   * bytes on silence, so size IS the signal - the shortest real cue here is a 0.17s
   * transient at 4.4 KB, while 0.2s of quiet encodes to well under one.
   */
  it("no shipped sound is silence", () => {
    const thin = readdirSync(DIR)
      .filter((f) => f.endsWith(".webm"))
      .map((f) => ({ f, bytes: statSync(resolve(DIR, f)).size }))
      .filter((r) => r.bytes < 2500);
    expect(thin).toEqual([]);
  });

  it("the masters exist as WAV nowhere in the shipped app", () => {
    // Opus in WebM is a tenth the size; a stray WAV means the conversion was skipped.
    expect(readdirSync(DIR).some((f) => f.endsWith(".wav"))).toBe(false);
    expect(existsSync(DIR)).toBe(true);
  });
});

describe("distanceRolloff", () => {
  const db = (g: number) => 20 * Math.log10(g);

  /** WebAudio's "inverse" model at refDistance 5, rolloffFactor 3, heard from 5 units up. */
  it("is whole under the listener and inverse past it", () => {
    expect(distanceRolloff(0)).toBe(1);
    expect(Math.abs(db(distanceRolloff(2)) - -1.8)).toBeLessThan(0.3);
    expect(Math.abs(db(distanceRolloff(7)) - -10.0)).toBeLessThan(0.3);
    expect(Math.abs(db(distanceRolloff(12)) - -15.3)).toBeLessThan(0.3);
  });

  it("falls off monotonically with distance", () => {
    for (let d = 1; d < 14; d++) expect(distanceRolloff(d)).toBeLessThan(distanceRolloff(d - 1));
  });
});

describe("toListenerSpace", () => {
  // Camera yaw -PI/4 (engine.ts): sim (+1,+1) is screen-right, (-1,+1) screen-up (intents.ts).
  // The listener looks down with -Z as its up and +X to its right.
  it("puts a source screen-right of the player on the listener's right", () => {
    const [x, z] = toListenerSpace(1, 1);
    expect(x).toBeGreaterThan(0);
    expect(z).toBeCloseTo(0, 10);
    expect(toListenerSpace(-1, -1)[0]).toBeLessThan(0);
  });

  it("puts a source screen-up of the player in front of the listener", () => {
    const [x, z] = toListenerSpace(-1, 1);
    expect(x).toBeCloseTo(0, 10);
    expect(z).toBeLessThan(0);
    expect(toListenerSpace(1, -1)[1]).toBeGreaterThan(0);
  });

  it("keeps distance, so rolloff in listener space is rolloff in the sim", () => {
    const [x, z] = toListenerSpace(3, 4);
    expect(Math.hypot(x, z)).toBeCloseTo(5, 10);
  });
});

describe("sfxCategory", () => {
  it("routes every sampled cue into one player-facing volume category", () => {
    for (const name of voiceNames()) {
      const expected = name.startsWith("ambient-")
        ? "ambience"
        : name.startsWith("skill-")
        ? "skills"
        : /^(ui|item|trade)-/.test(name)
        ? "interface"
        : /^(drop|coin|level|container)-/.test(name) ? "loot" : "environment";
      expect(sfxCategory(name), name).toBe(expected);
    }
  });

  it("moving, wearing and trading items is the interface, beside the click", () => {
    for (const name of ["item-lift", "item-place-metal", "item-equip-wood", "trade-sell", "trade-buy"]) {
      expect(sfxCategory(name), name).toBe("interface");
    }
  });

  it("pools the generated monster and NPC cues and the new combat cues as take sets", () => {
    const takes = voiceTakes();
    const monster = [
      "monster-hurt", "monster-death", "monster-melee-hit", "monster-spit",
      "monster-slam-windup", "monster-slam-impact",
      ...["stone", "husk", "bog", "beast", "ember", "spirit"]
        .flatMap((m) => [`monster-hurt-${m}`, `monster-death-${m}`]),
    ];
    const combat = [
      "skill-ember-spark-cast", "skill-ember-spark-impact", "skill-heavy-strike-impact",
      "skill-ground-slam-impact", "player-death",
    ];
    for (const name of [...monster, ...combat]) expect(takes[name], name).toBe(3);
    for (const name of combat) expect(CORE_SFX, name).toContain(name);
    for (const name of VARKIS_SFX) {
      expect(takes[name], name).toBe(2);
      expect(CORE_SFX, name).not.toContain(name);
    }
  });

  it("keeps the Ember Bolt cast transient below the travelling skill", () => {
    expect(voiceGain("skill-ember-bolt-cast")).toBeLessThanOrEqual(0.2);
    expect(voiceGain("skill-ember-bolt-cast")).toBeLessThan(
      voiceGain("skill-ember-bolt-flight"),
    );
  });
});

describe("playSfx without WebAudio", () => {
  it("is silent and safe, which is what every headless test relies on", () => {
    expect(() => playSfx("ui-click")).not.toThrow();
    expect(() => playSfx("not-a-sound")).not.toThrow();
    expect(() => setSfxListener(3, 4)).not.toThrow();
    expect(playSfxAt("monster-death", 1, 1)).toBe(0);
    expect(() => startSfxLoopAt("skill-ember-bolt-flight", "k", 1, 1)).not.toThrow();
    expect(() => moveSfxLoop("k", 2, 2)).not.toThrow();
  });

  it("gives Varkis the room: an npc cue is a world cue", () => {
    expect(sfxCategory("npc-varkis-greet-1")).toBe("environment");
  });
});

describe("distanceCutoff", () => {
  it("keeps a close sound whole and takes the top off a far one", () => {
    expect(distanceCutoff(0)).toBe(20000);
    expect(distanceCutoff(2)).toBe(20000);
    expect(distanceCutoff(6)).toBe(20000);
    expect(distanceCutoff(8)).toBeLessThan(20000);
    expect(distanceCutoff(10)).toBeCloseTo(8944, 0);
    expect(distanceCutoff(14)).toBeCloseTo(4000, 0);
  });

  it("never rises with distance", () => {
    for (let d = 0; d < 20; d++) expect(distanceCutoff(d + 1)).toBeLessThanOrEqual(distanceCutoff(d));
  });
});

describe("take pools", () => {
  const urls: string[] = [];
  const played: string[] = [];
  const gainNodes: Array<{ gain: { value: number } }> = [];
  let missing = new Set<string>();

  beforeEach(() => {
    resetSfx();
    urls.length = 0; played.length = 0; gainNodes.length = 0; missing = new Set();
    vi.stubGlobal("fetch", (url: string) => {
      urls.push(url);
      return Promise.resolve({ ok: !missing.has(url), status: 404, arrayBuffer: () => Promise.resolve(url) });
    });
    fake.ctx = {
      currentTime: 0,
      decodeAudioData: (url: string) => Promise.resolve({ url, duration: 1.5 }),
      createBufferSource: () => ({
        buffer: null as { url: string } | null, loop: false, playbackRate: { value: 1 },
        connect: () => {},
        // A second per voice: a run of footsteps is a walk, never a burst on one instant.
        start() { played.push(this.buffer!.url); (fake.ctx as { currentTime: number }).currentTime += 1; },
        stop: () => {},
      }),
      createGain: () => {
        const node = { gain: { value: 1, setTargetAtTime: () => {} }, connect: () => {} };
        gainNodes.push(node);
        return node;
      },
      createBiquadFilter: () => ({ type: "", frequency: { value: 0, setTargetAtTime: () => {} }, connect: () => {} }),
    };
  });
  afterEach(() => { fake.ctx = null; vi.unstubAllGlobals(); });

  const take = (n: number) => `/audio/footstep-stone-${n}.webm`;

  it("a three-take cue fetches exactly its three takes", async () => {
    await preloadSfx(["footstep-stone"]);
    expect([...urls].sort()).toEqual([1, 2, 3].map(take));
  });

  it("a one-shot reports how long it sounds, and 0 when nothing played", async () => {
    expect(playSfx("ui-click")).toBe(0);
    await preloadSfx(["ui-click"]);
    expect(playSfx("ui-click")).toBeGreaterThan(1.5 / 1.1);
    expect(playSfx("not-a-sound")).toBe(0);
  });

  it("a single-take cue still fetches <cue>.webm", async () => {
    await preloadSfx(["level-up"]);
    expect(urls).toEqual(["/audio/level-up.webm"]);
  });

  it("tags every fetch with the build's audio version, so a rebuilt sound is never a stale cache hit", async () => {
    vi.stubEnv("VITE_AUDIO_VERSION", "ab12cd34ef");
    try {
      await preloadSfx(["level-up", "footstep-stone"]);
      expect([...urls].sort()).toEqual([
        "/audio/footstep-stone-1.webm?v=ab12cd34ef", "/audio/footstep-stone-2.webm?v=ab12cd34ef",
        "/audio/footstep-stone-3.webm?v=ab12cd34ef", "/audio/level-up.webm?v=ab12cd34ef",
      ]);
    } finally { vi.unstubAllEnvs(); }
  });

  it("an unloaded cue loads every take and plays nothing", async () => {
    playSfx("footstep-stone");
    await preloadSfx(["footstep-stone"]);
    expect(played).toEqual([]);
    expect([...urls].sort()).toEqual([1, 2, 3].map(take));
  });

  it("never repeats a take back to back, and uses every one", async () => {
    await preloadSfx(["footstep-stone"]);
    for (let i = 0; i < 300; i++) playSfx("footstep-stone");
    expect(played.length).toBe(300);
    for (let i = 1; i < played.length; i++) expect(played[i]).not.toBe(played[i - 1]);
    expect(new Set(played)).toEqual(new Set([1, 2, 3].map(take)));
  });

  it("a dead take is skipped alone while the others play", async () => {
    missing.add(take(2));
    await preloadSfx(["footstep-stone"]);
    for (let i = 0; i < 100; i++) playSfx("footstep-stone");
    expect(new Set(played)).toEqual(new Set([take(1), take(3)]));
    expect(urls.filter((u) => u === take(2)).length).toBe(1);
  });

  it("a sole surviving take still plays", async () => {
    missing.add(take(1)); missing.add(take(3));
    await preloadSfx(["footstep-stone"]);
    playSfx("footstep-stone"); playSfx("footstep-stone");
    expect(played).toEqual([take(2), take(2)]);
  });

  it("a loop instance picks one take and the next instance a different one", async () => {
    await preloadSfx(["footstep-stone"]);
    startSfxLoop("footstep-stone", "k1");
    startSfxLoop("footstep-stone", "k2");
    expect(played.length).toBe(2);
    expect(played[0]).not.toBe(played[1]);
    stopSfxLoop("k1"); stopSfxLoop("k2");
  });

  it("one-shot level stays within 1.0 dB of voice gain x volume, on both sides", async () => {
    await preloadSfx(["ui-click"]);
    const base = voiceGain("ui-click") * 0.8;
    const lo = base * 10 ** (-1.0 / 20);
    const hi = base * 10 ** (1.0 / 20);
    for (let i = 0; i < 200; i++) playSfx("ui-click", 0.8);
    const levels = gainNodes.map((g) => g.gain.value);
    expect(levels.length).toBe(200);
    for (const v of levels) {
      expect(v).toBeGreaterThanOrEqual(lo - 1e-12);
      expect(v).toBeLessThanOrEqual(hi + 1e-12);
    }
    expect(Math.min(...levels)).toBeLessThan(base);
    expect(Math.max(...levels)).toBeGreaterThan(base);
  });
});

describe("stacked one-shots", () => {
  const clock = { now: 0 };
  /** The gain nodes made since the last `playSfx`; a one-shot's level is the first. */
  let made: Array<{ gain: { value: number } }> = [];

  beforeEach(() => {
    resetSfx();
    clock.now = 0;
    vi.stubGlobal("fetch", (url: string) =>
      Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(url) }));
    fake.ctx = {
      get currentTime() { return clock.now; },
      decodeAudioData: (url: string) => Promise.resolve({ url, duration: 1.5 }),
      createBufferSource: () => ({
        buffer: null, loop: false, playbackRate: { value: 1 }, connect: () => {}, start: () => {}, stop: () => {},
      }),
      createGain: () => {
        const node = { gain: { value: 1, setTargetAtTime: () => {} }, connect: () => {} };
        made.push(node);
        return node;
      },
      createBiquadFilter: () => ({ type: "", frequency: { value: 0, setTargetAtTime: () => {} }, connect: () => {} }),
    };
  });
  afterEach(() => { fake.ctx = null; vi.unstubAllGlobals(); });

  /** Summed power of the one-shots that started, in units of one voice at its own gain. */
  function power(name: string, levels: number[]): number {
    return levels.reduce((s, g) => s + (g / voiceGain(name)) ** 2, 0);
  }

  /** `n` plays of one cue `gap` seconds apart: the level of each that started. */
  async function levelsOf(name: string, n: number, gap = 0): Promise<number[]> {
    await preloadSfx([name]);
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      made = [];
      if (playSfx(name) > 0) out.push(made[0]!.gain.value);
      clock.now += gap;
    }
    return out;
  }

  it("caps one cue at three voices in the same instant, summing to under +1.5 dB of one voice", async () => {
    const levels = await levelsOf("skill-arrow-impact", 10);
    expect(levels).toHaveLength(3);
    // The level jitter is +-1 dB per voice, so one voice alone may already sit 1 dB up.
    expect(10 * Math.log10(power("skill-arrow-impact", levels))).toBeLessThan(1.5 + 1);
  });

  it("frees the cue again once the burst is past its attack", async () => {
    expect(await levelsOf("skill-arrow-impact", 6, 0.2)).toHaveLength(6);
  });

  it("never quiets one cue for another: a unique drop rings at full level over a pile of normals", async () => {
    await levelsOf("drop-normal", 5);
    const [unique] = await levelsOf("drop-unique", 1);
    expect(unique! / voiceGain("drop-unique")).toBeGreaterThan(10 ** (-1.01 / 20));
  });
});

/** A fake AudioParam: `to` is where it is going, set directly or by a glide. */
interface FakeParam { value: number; to: number; setTargetAtTime(v: number): void }
function param(v = 0): FakeParam {
  const p = {
    to: v,
    get value() { return this.to; },
    set value(x: number) { this.to = x; },
    setTargetAtTime(t: number) { this.to = t; },
  };
  return p;
}

describe("positional voices", () => {
  interface Panner {
    panningModel: string; distanceModel: string; refDistance: number; rolloffFactor: number;
    coneInnerAngle: number; coneOuterAngle: number;
    positionX: FakeParam; positionY: FakeParam; positionZ: FakeParam;
  }
  let panners: Panner[];
  let gains: Array<{ gain: FakeParam }>;
  let filters: Array<{ frequency: FakeParam }>;
  let stereos: Array<{ pan: FakeParam }>;
  let played: number;
  let listener: Record<string, unknown>;

  function install(modernListener = true): void {
    resetSfx();
    panners = []; gains = []; filters = []; stereos = []; played = 0; fake.sends.length = 0;
    vi.stubGlobal("fetch", (url: string) =>
      Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(url) }));
    listener = modernListener
      ? {
          positionX: param(), positionY: param(), positionZ: param(),
          forwardX: param(), forwardY: param(), forwardZ: param(-1),
          upX: param(), upY: param(1), upZ: param(),
        }
      : { setPosition: vi.fn(), setOrientation: vi.fn() };
    fake.ctx = {
      currentTime: 0,
      listener,
      decodeAudioData: (url: string) => Promise.resolve({ url, duration: 5 }),
      createBufferSource: () => ({
        buffer: null, loop: false, playbackRate: { value: 1 },
        connect: () => {}, start() { played++; (fake.ctx as { currentTime: number }).currentTime += 1; }, stop: () => {},
      }),
      createGain: () => { const n = { gain: param(1), connect: () => {} }; gains.push(n); return n; },
      createBiquadFilter: () => {
        const n = { type: "", frequency: param(0), connect: () => {} };
        filters.push(n);
        return n;
      },
      createPanner: () => {
        const n = {
          panningModel: "HRTF", distanceModel: "", refDistance: 1, rolloffFactor: 0,
          coneInnerAngle: 0, coneOuterAngle: 0,
          positionX: param(), positionY: param(), positionZ: param(),
          connect: () => {},
        };
        panners.push(n);
        return n;
      },
      createStereoPanner: () => { const n = { pan: param(0), connect: () => {} }; stereos.push(n); return n; },
    };
    setSfxListener(0, 0);
  }
  afterEach(() => { fake.ctx = null; setSfxListener(0, 0); vi.unstubAllGlobals(); });

  it("places a world one-shot through an equal-power inverse panner at its source", async () => {
    install();
    await preloadSfx(["npc-varkis-greet-1"]);
    expect(playSfxAt("npc-varkis-greet-1", 3, 1)).toBeGreaterThan(4);
    expect(panners).toHaveLength(1);
    const p = panners[0]!;
    expect(p).toMatchObject({
      panningModel: "equalpower", distanceModel: "inverse", refDistance: 5, rolloffFactor: 3,
      coneInnerAngle: 360, coneOuterAngle: 360,
    });
    const [x, z] = toListenerSpace(3, 1);
    expect(p.positionX.value).toBeCloseTo(x, 10);
    expect(p.positionY.value).toBe(0);
    expect(p.positionZ.value).toBeCloseTo(z, 10);
    // The panner sits on the dry path only; the room return stays diffuse.
    expect(fake.sends[0]!.spatial).toBe(p);
  });

  /** Equal-power azimuth as the WebAudio spec derives it: the source direction projected
   *  onto the plane normal to the listener's up, measured from its front, in degrees. */
  function azimuth(src: Panner): number {
    const l = listener as Record<string, FakeParam>;
    const v = [src.positionX.value - l.positionX!.value, src.positionY.value - l.positionY!.value,
      src.positionZ.value - l.positionZ!.value];
    const f = [l.forwardX!.value, l.forwardY!.value, l.forwardZ!.value];
    const u = [l.upX!.value, l.upY!.value, l.upZ!.value];
    const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    const r = [f[1]! * u[2]! - f[2]! * u[1]!, f[2]! * u[0]! - f[0]! * u[2]!, f[0]! * u[1]! - f[1]! * u[0]!];
    const along = dot(v, u);
    const proj = v.map((c, i) => c - along * u[i]!);
    return (Math.atan2(dot(proj, r), dot(proj, f)) * 180) / Math.PI;
  }

  it("hears a voice beside the player near the middle and the screen edge hard to one side", async () => {
    install();
    await preloadSfx(["npc-varkis-greet-1", "npc-varkis-greet-2", "npc-varkis-greet-3"]);
    // Varkis a step and a half screen-right: sim (+1,+1) is screen-right.
    playSfxAt("npc-varkis-greet-1", 1.06, 1.06);
    const near = azimuth(panners[0]!);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(25);
    playSfxAt("npc-varkis-greet-2", 6.7, 6.7);
    expect(azimuth(panners[1]!)).toBeGreaterThan(55);
    playSfxAt("npc-varkis-greet-3", -1.06, -1.06);
    expect(azimuth(panners[2]!)).toBeLessThan(0);
  });

  it("does not start a world one-shot at or past the audible edge", async () => {
    install();
    await preloadSfx(["monster-death"]);
    expect(playSfxAt("monster-death", 14, 0)).toBe(0);
    expect(playSfxAt("monster-death", 10, 10)).toBe(0);
    expect(played).toBe(0);
    expect(playSfxAt("monster-death", 13.9, 0)).toBeGreaterThan(0);
    expect(played).toBe(1);
    // Measured from the listener, not the origin.
    setSfxListener(20, 0);
    expect(playSfxAt("monster-death", 26, 0)).toBeGreaterThan(0);
  });

  it("an already playing voice moves in the mix as the listener walks", async () => {
    install();
    await preloadSfx(["npc-varkis-greet-1"]);
    playSfxAt("npc-varkis-greet-1", 5, 0);
    const p = panners[0]!;
    const lx = listener["positionX"] as FakeParam;
    const lz = listener["positionZ"] as FakeParam;
    const rel = () => [p.positionX.value - lx.value, p.positionZ.value - lz.value] as const;
    expect(rel()[0]).toBeGreaterThan(0); // sim +x is partly screen-right
    setSfxListener(5, 0);
    expect(rel()[0]).toBeCloseTo(0, 10);
    expect(rel()[1]).toBeCloseTo(0, 10);
    // Walk past him toward screen-right: now he is on the left.
    setSfxListener(8, 3);
    expect(rel()[0]).toBeLessThan(0);
  });

  it("falls back to listener.setPosition where AudioParams are missing", async () => {
    install(false);
    setSfxListener(2, 0);
    await preloadSfx(["monster-death"]);
    playSfxAt("monster-death", 3, 0);
    const [x, z] = toListenerSpace(2, 0);
    expect(listener["setPosition"]).toHaveBeenLastCalledWith(x, 5, z);
    setSfxListener(4, 1);
    const [x2, z2] = toListenerSpace(4, 1);
    expect(listener["setPosition"]).toHaveBeenLastCalledWith(x2, 5, z2);
  });

  it("muffles a far one-shot and gives it more room, scaled with its level", async () => {
    install();
    await preloadSfx(["monster-death"]);
    playSfxAt("monster-death", 7, 0);
    // monster-death wet 0.24: 1 + 2 * 7/14 = 2x the room.
    expect(fake.sends[0]!.wet).toBeCloseTo(0.48, 10);
    expect(fake.sends[0]!.out.gain.value).toBeCloseTo(0.48 * distanceRolloff(7), 10);
    expect(filters.map((f) => f.frequency.value)).toContain(distanceCutoff(7));
  });

  it("a drop under the player is neither muffled nor panned off-centre", async () => {
    install();
    await preloadSfx(["drop-rare"]);
    playSfxAt("drop-rare", 0, 0);
    expect(filters).toEqual([]);
    expect(panners[0]!.positionX.value).toBe(0);
  });

  it("player-attached and UI cues stay centred, with no panner", async () => {
    install();
    await preloadSfx(["ui-click"]);
    playSfx("ui-click");
    expect(panners).toEqual([]);
    expect(fake.sends[0]!.spatial ?? null).toBeNull();
  });

  describe("ambient details", () => {
    const fetched = () => (vi.mocked(fetch).mock.calls as unknown as Array<[string]>).map(([u]) => u);
    function installTimed(): void {
      install();
      vi.stubGlobal("fetch", vi.fn((url: string) =>
        Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(url) })));
      vi.useFakeTimers();
    }
    afterEach(() => { stopAmbient(); vi.useRealTimers(); vi.restoreAllMocks(); });

    it("every bed has a detail pool of several takes", () => {
      const takes = voiceTakes();
      for (const bed of new Set([ambientCue(null), ...Object.values(AMBIENT_BY_BIOME)])) {
        const pool = AMBIENT_DETAIL[bed];
        expect(pool, bed).toBeDefined();
        expect(takes[pool!], pool).toBeGreaterThanOrEqual(3);
        expect(sfxCategory(pool!)).toBe(sfxCategory(bed));
      }
    });

    it("drops one-shots around the player at random gaps while the bed plays", async () => {
      installTimed();
      vi.spyOn(Math, "random").mockReturnValue(0);
      setSfxListener(10, 4);
      setAmbient("forest");
      // Shortest gap, nearest ring.
      await vi.advanceTimersByTimeAsync(DETAIL_GAP_S[0] * 1000 - 1);
      expect(panners).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(panners).toHaveLength(1);
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      await vi.advanceTimersByTimeAsync(DETAIL_GAP_S[0] * 1000);
      expect(panners).toHaveLength(2);
      const mid = (DETAIL_GAP_S[0] + DETAIL_GAP_S[1]) / 2;
      await vi.advanceTimersByTimeAsync(mid * 1000);
      expect(panners).toHaveLength(3);
      const [lx, lz] = toListenerSpace(10, 4);
      const ring = (p: Panner) => Math.hypot(p.positionX.value - lx, p.positionZ.value - lz);
      expect(ring(panners[0]!)).toBeCloseTo(DETAIL_RADIUS[0], 9);
      expect(ring(panners[2]!)).toBeCloseTo((DETAIL_RADIUS[0] + DETAIL_RADIUS[1]) / 2, 9);
      expect(fetched().some((u) => u.includes("/ambient-forest-detail-"))).toBe(true);
    });

    it("stops with the bed, and a new biome draws from its own pool", async () => {
      installTimed();
      vi.spyOn(Math, "random").mockReturnValue(0.999);
      setAmbient("forest");
      setAmbient("forest");
      await vi.advanceTimersByTimeAsync(DETAIL_GAP_S[1] * 1000);
      expect(panners).toHaveLength(1); // asking twice does not double the rate
      stopAmbient();
      await vi.advanceTimersByTimeAsync(DETAIL_GAP_S[1] * 3000);
      expect(panners).toHaveLength(1);
      setAmbient("swamp");
      await vi.advanceTimersByTimeAsync(DETAIL_GAP_S[1] * 1000);
      expect(panners).toHaveLength(2);
      expect(fetched().some((u) => u.includes("/ambient-swamp-detail-"))).toBe(true);
    });

    it("plays each detail at its own level, most of them faint", async () => {
      installTimed();
      vi.spyOn(Math, "random").mockReturnValue(0);
      setAmbient("forest");
      await vi.advanceTimersByTimeAsync(DETAIL_GAP_S[0] * 1000);
      const peak = voiceGain("ambient-forest-detail");
      // Level jitter at random 0 is -1 dB, at the top +1 dB.
      expect(gains.at(-1)!.gain.value).toBeCloseTo(peak * 10 ** ((DETAIL_LEVEL_DB[0] - 1) / 20), 9);
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      await vi.advanceTimersByTimeAsync(DETAIL_GAP_S[0] * 1000);
      const mid = gains.at(-1)!.gain.value / peak;
      // Halfway up the draw is still in the quiet half of the range.
      expect(20 * Math.log10(mid)).toBeLessThan((DETAIL_LEVEL_DB[0] + DETAIL_LEVEL_DB[1]) / 2);
      vi.spyOn(Math, "random").mockReturnValue(0.999999);
      await vi.advanceTimersByTimeAsync(((DETAIL_GAP_S[0] + DETAIL_GAP_S[1]) / 2) * 1000);
      expect(gains.at(-1)!.gain.value).toBeCloseTo(peak * 10 ** ((DETAIL_LEVEL_DB[1] + 1) / 20), 4);
    });

    it("never drops two details in a row from the same side", async () => {
      installTimed();
      const seq = [0.93, 0.02, 0.51, 0.77, 0.33, 0.98, 0.11, 0.64, 0.45, 0.07, 0.86];
      let i = 0;
      vi.spyOn(Math, "random").mockImplementation(() => seq[i++ % seq.length]!);
      setSfxListener(10, 4);
      setAmbient("forest");
      await vi.advanceTimersByTimeAsync(DETAIL_GAP_S[1] * 1000 * 12);
      expect(panners.length).toBeGreaterThanOrEqual(8);
      const [lx, lz] = toListenerSpace(10, 4);
      const angles = panners.map((p) => Math.atan2(p.positionZ.value - lz, p.positionX.value - lx));
      for (let k = 1; k < angles.length; k++) {
        const d = Math.abs(angles[k]! - angles[k - 1]!) % (2 * Math.PI);
        expect(Math.min(d, 2 * Math.PI - d)).toBeGreaterThanOrEqual(DETAIL_MIN_TURN - 1e-9);
      }
    });

    it("the bed swells and drifts slowly within its bounds, and stops with it", async () => {
      installTimed();
      vi.spyOn(Math, "random").mockReturnValue(0);
      setAmbient("forest");
      await vi.advanceTimersByTimeAsync(0);
      const bedGain = gains[0]!;
      const pan = stereos[0]!;
      expect(fake.sends[0]!.spatial).toBe(pan);
      const peak = voiceGain("ambient-forest");
      expect(bedGain.gain.value).toBeCloseTo(peak, 9);
      expect(pan.pan.value).toBe(0);
      await vi.advanceTimersByTimeAsync(BED_SWELL_S[0] * 1000);
      expect(bedGain.gain.value).toBeCloseTo(peak * 10 ** (-BED_SWELL_DB / 20), 9);
      expect(pan.pan.value).toBeCloseTo(-BED_DRIFT_PAN, 9);
      vi.spyOn(Math, "random").mockReturnValue(0.999999);
      await vi.advanceTimersByTimeAsync(BED_SWELL_S[0] * 1000);
      expect(bedGain.gain.value).toBeCloseTo(peak * 10 ** (BED_SWELL_DB / 20), 4);
      expect(pan.pan.value).toBeCloseTo(BED_DRIFT_PAN, 4);
      stopAmbient();
      expect(bedGain.gain.value).toBe(0);
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      await vi.advanceTimersByTimeAsync(BED_SWELL_S[1] * 3000);
      expect(bedGain.gain.value).toBe(0);
    });

    it("hears the Strand's surf from the sea side, louder near the water", async () => {
      installTimed();
      vi.spyOn(Math, "random").mockReturnValue(0.5); // no swell, no drift
      const shore = (seaSide: 1 | -1): Shoreline => ({
        along: "x", start: -40, step: 0.5, cross: new Float32Array(161).fill(10), seaSide,
      });
      setSfxListener(0, -10);
      setAmbient("coast", shore(1));
      await vi.advanceTimersByTimeAsync(0);
      const bedGain = gains[0]!;
      const pan = stereos[0]!;
      const peak = voiceGain("ambient-shore");
      // Sea at greater sim y: screen-right and up, so the surf leans right.
      expect(pan.pan.value).toBeGreaterThan(0.2);
      expect(pan.pan.value).toBeLessThanOrEqual(SEA_PAN);
      const far = bedGain.gain.value;
      expect(far).toBeLessThan(peak);
      setSfxListener(0, 9);
      expect(bedGain.gain.value).toBeCloseTo(peak, 9);
      expect(bedGain.gain.value).toBeGreaterThan(far);
      // The same map mirrored puts the water, and the surf, on the other side.
      setSfxListener(0, 30);
      setAmbient("coast", shore(-1));
      expect(pan.pan.value).toBeLessThan(-0.2);
      // Every other biome keeps a centred bed.
      setAmbient("forest");
      await vi.advanceTimersByTimeAsync(0);
      expect(stereos.at(-1)!.pan.value).toBe(0);
    });
  });

  it("a moving loop follows its source, sweeps its muffle, and falls silent past the edge", async () => {
    install();
    await preloadSfx(["skill-ember-bolt-flight"]);
    startSfxLoopAt("skill-ember-bolt-flight", "bolt", 1, 0);
    const p = panners[0]!;
    const lp = filters[0]!;
    expect(lp.frequency.value).toBe(distanceCutoff(1));
    moveSfxLoop("bolt", 6, 4);
    const [x, z] = toListenerSpace(6, 4);
    expect(p.positionX.value).toBeCloseTo(x, 10);
    expect(p.positionZ.value).toBeCloseTo(z, 10);
    expect(lp.frequency.value).toBeCloseTo(distanceCutoff(Math.hypot(6, 4)), 6);
    const level = gains[0]!.gain;
    expect(level.value).toBeGreaterThan(0);
    moveSfxLoop("bolt", 14, 0);
    expect(level.value).toBe(0);
    stopSfxLoop("bolt");
  });
});
