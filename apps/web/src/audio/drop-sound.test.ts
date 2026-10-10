import { describe, it, expect, beforeEach, vi } from "vitest";
import { playCoinPickup, playDropSound, setSoundLevel, setSoundMix, soundLevel, soundMix } from "./drop-sound";
import { playSfx, playSfxAt } from "./sfx";

vi.mock("./sfx", () => ({ playSfx: vi.fn(), playSfxAt: vi.fn() }));

beforeEach(() => {
  setSoundLevel(0.8, false);
  vi.mocked(playSfx).mockClear();
  vi.mocked(playSfxAt).mockClear();
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
  ])("plays %s as %s, at the drop", (tier, cue) => {
    playDropSound(tier, { x: 3, y: -1 }, 0.5);
    expect(playSfxAt).toHaveBeenCalledWith(cue, 3, -1, 0.5);
    expect(playSfx).not.toHaveBeenCalled();
  });

  it("plays a reward with no place (level-up, the inventory) on the player", () => {
    playDropSound("level-up");
    expect(playSfx).toHaveBeenCalledWith("level-up", 1);
    expect(playSfxAt).not.toHaveBeenCalled();
  });

  it("falls back to the normal drop for no tier or an unknown one", () => {
    playDropSound(undefined);
    playDropSound("mythic");
    expect(vi.mocked(playSfx).mock.calls.map((c) => c[0])).toEqual(["drop-normal", "drop-normal"]);
  });
});

describe("playCoinPickup", () => {
  it("plays the coin cue where the pile lay", () => {
    playCoinPickup({ x: 1, y: 2 }, 0.7);
    expect(playSfxAt).toHaveBeenCalledWith("coin-pickup", 1, 2, 0.7);
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
      ambience: 0.15,
      interface: 0.2,
      skills: 0.3,
      loot: 2,
      environment: -1,
    });
    expect(soundLevel()).toBeCloseTo(0.7);
    expect(soundMix()).toEqual({
      music: 0.1,
      ambience: 0.15,
      interface: 0.2,
      skills: 0.3,
      loot: 1,
      environment: 0,
    });
  });
});
