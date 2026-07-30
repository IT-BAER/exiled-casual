import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { MONSTERS } from "@exiled/content-runtime";
import { CORE_SFX, distanceGain, playSfx } from "./sfx";

const DIR = resolve(__dirname, "../../public/audio");
const SRC = resolve(__dirname, "sfx.ts");

/** Voice names, read out of the source so the list cannot drift from the table. */
function voiceNames(): string[] {
  const body = readFileSync(SRC, "utf8");
  const table = body.slice(body.indexOf("const VOICES"), body.indexOf("export type SfxName"));
  return [...table.matchAll(/"([a-z0-9-]+)":\s*\{/g)].map((m) => m[1]!);
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

describe("playSfx without WebAudio", () => {
  it("is silent and safe, which is what every headless test relies on", () => {
    expect(() => playSfx("ui-click")).not.toThrow();
    expect(() => playSfx("not-a-sound")).not.toThrow();
  });
});
