import { describe, it, expect, beforeEach } from "vitest";
import { setSoundLevel, setSoundMix, soundLevel, soundMix } from "./drop-sound";

beforeEach(() => setSoundLevel(0.8, false));

describe("setSoundLevel", () => {
  it("is the volume when it is not muted", () => {
    setSoundLevel(0.3, false);
    expect(soundLevel()).toBeCloseTo(0.3);
  });

  it("is silence when it is muted, whatever the volume says", () => {
    setSoundLevel(0.9, true);
    expect(soundLevel()).toBe(0);
  });

  it("remembers the volume across a mute, so unmuting does not reset it", () => {
    setSoundLevel(0.4, true);
    setSoundLevel(0.4, false);
    expect(soundLevel()).toBeCloseTo(0.4);
  });

  it("survives being called before there is any audio context at all", () => {
    // No WebAudio here: the menu sets a volume long before the first drop.
    expect(() => setSoundLevel(0.5, false)).not.toThrow();
    expect(soundLevel()).toBeCloseTo(0.5);
  });

  it("clamps, because the slider is not the only caller", () => {
    setSoundLevel(5, false);
    expect(soundLevel()).toBe(1);
    setSoundLevel(-1, false);
    expect(soundLevel()).toBe(0);
    setSoundLevel(NaN, false);
    expect(soundLevel()).toBe(0);
  });
});

describe("setSoundMix", () => {
  it("keeps category levels independent and clamps untrusted values", () => {
    setSoundMix({
      master: 0.7,
      muted: false,
      music: 0.1,
      interface: 0.2,
      skills: 0.3,
      loot: 2,
      environment: -1,
    });
    expect(soundLevel()).toBeCloseTo(0.7);
    expect(soundMix()).toEqual({
      music: 0.1,
      interface: 0.2,
      skills: 0.3,
      loot: 1,
      environment: 0,
    });
  });
});
