import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { MONSTERS } from "@exiled/content-runtime";
import {
  CORE_SFX, distanceCutoff, distanceRolloff, moveSfxLoop, playSfx, playSfxAt, preloadSfx, resetSfx,
  setSfxListener, sfxCategory, startSfxLoop, startSfxLoopAt, stopSfxLoop, toListenerSpace,
} from "./sfx";
import { VARKIS_SFX } from "./varkis-voice";

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
        ? "music"
        : name.startsWith("skill-")
        ? "skills"
        : name.startsWith("ui-")
        ? "interface"
        : /^(drop|coin|level|container)-/.test(name) ? "loot" : "environment";
      expect(sfxCategory(name), name).toBe(expected);
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
    expect(distanceCutoff(8)).toBeLessThan(20000);
    expect(distanceCutoff(14)).toBeCloseTo(900, 0);
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
        start() { played.push(this.buffer!.url); },
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
  let played: number;
  let listener: Record<string, unknown>;

  function install(modernListener = true): void {
    resetSfx();
    panners = []; gains = []; filters = []; played = 0; fake.sends.length = 0;
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
        connect: () => {}, start() { played++; }, stop: () => {},
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
