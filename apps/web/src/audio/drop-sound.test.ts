import { describe, it, expect, beforeEach, vi } from "vitest";
import { playCoinPickup, playDropSound, setSoundLevel, setSoundMix, soundLevel, soundMix } from "./drop-sound";
import { playSfx } from "./sfx";

vi.mock("./sfx", () => ({ playSfx: vi.fn() }));

beforeEach(() => {
  setSoundLevel(0.8, false);
  vi.mocked(playSfx).mockClear();
});

describe("playDropSound", () => {
  it.each([
    ["normal", "drop-normal"],
    ["magic", "drop-magic"],
    ["rare", "drop-rare"],
    ["unique", "drop-unique"],
    ["currency", "drop-currency"],
    ["gold", "drop-gold"],
    ["gold-jackpot", "drop-gold-jackpot"],
    ["level-up", "level-up"],
  ])("plays %s as %s", (tier, cue) => {
    playDropSound(tier, 0.5, -0.25);
    expect(playSfx).toHaveBeenCalledWith(cue, 0.5, 0, -0.25);
  });

  it("falls back to the normal drop for no tier or an unknown one", () => {
    playDropSound(undefined);
    playDropSound("mythic");
    expect(vi.mocked(playSfx).mock.calls.map((c) => c[0])).toEqual(["drop-normal", "drop-normal"]);
  });
});

describe("playCoinPickup", () => {
  it("plays the coin cue", () => {
    playCoinPickup(0.7, 0.1);
    expect(playSfx).toHaveBeenCalledWith("coin-pickup", 0.7, 0, 0.1);
  });
});

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
