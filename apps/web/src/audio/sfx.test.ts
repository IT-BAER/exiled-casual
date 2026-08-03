import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { MONSTERS } from "@exiled/content-runtime";
import { CORE_SFX, distanceCutoff, distanceGain, playSfx, sfxCategory, worldSfxMix } from "./sfx";

const DIR = resolve(__dirname, "../../public/audio");
const SRC = resolve(__dirname, "sfx.ts");

/** Voice names, read out of the source so the list cannot drift from the table. */
function voiceNames(): string[] {
  const body = readFileSync(SRC, "utf8");
  const table = body.slice(body.indexOf("const VOICES"), body.indexOf("export type SfxName"));
  return [...table.matchAll(/"([a-z0-9-]+)":\s*\{/g)].map((m) => m[1]!);
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
    const voices = voiceNames();
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
    expect(emitted.length).toBeGreaterThan(5);
    for (const name of [...emitted, ...cast]) expect(voices.has(name), name).toBe(true);
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
   * Footstep cues are built from the ground and a random fall, so they are invisible
   * to the literal scan above — the same blind spot as `cueFor`. A ground one file
   * short would not be silent, it would quietly stop varying.
   */
  it("every ground has all of its falls, and the fallback ground is one of them", () => {
    const body = readFileSync(resolve(__dirname, "soundscape.ts"), "utf8");
    const table = body.slice(body.indexOf("const GROUND:"), body.indexOf("const DEFAULT_GROUND"));
    const grounds = [...table.matchAll(/:\s*"([a-z]+)",/g)].map((m) => m[1]!);
    const variants = Number(/const GROUND_VARIANTS = (\d+)/.exec(body)?.[1]);
    const fallback = /const DEFAULT_GROUND = "([a-z]+)"/.exec(body)?.[1];
    const voices = new Set(voiceNames());

    expect(grounds.length).toBeGreaterThan(1);
    expect(variants).toBeGreaterThan(1);
    expect(grounds).toContain(fallback);
    for (const ground of grounds) {
      for (let i = 1; i <= variants; i++) {
        expect(voices.has(`footstep-${ground}-${i}`), `footstep-${ground}-${i}`).toBe(true);
      }
    }
    // And nothing else: a leftover from a renamed ground ships bytes nobody plays.
    const shipped = [...voices].filter((n) => n.startsWith("footstep"));
    expect(shipped.length).toBe(grounds.length * variants);
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

describe("distanceGain", () => {
  it("is loudest underfoot and silent past the frame", () => {
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(14)).toBe(0);
    expect(distanceGain(40)).toBe(0);
  });

  it("falls off monotonically", () => {
    for (let d = 1; d < 14; d++) expect(distanceGain(d)).toBeLessThan(distanceGain(d - 1));
  });
});

describe("worldSfxMix", () => {
  it("moves across stereo space as the source actually travels", () => {
    const near = worldSfxMix(1, 0)[2];
    const middle = worldSfxMix(7, 0)[2];
    const edge = worldSfxMix(14, 0)[2];

    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(0.1);
    expect(middle).toBeGreaterThan(near);
    expect(edge).toBeGreaterThan(middle);
  });

  it("routes every sampled cue into one player-facing volume category", () => {
    for (const name of voiceNames()) {
      const expected = name.startsWith("ambient-")
        ? "music"
        : name.startsWith("skill-")
        ? "skills"
        : name.startsWith("ui-") ? "interface" : "environment";
      expect(sfxCategory(name), name).toBe(expected);
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
