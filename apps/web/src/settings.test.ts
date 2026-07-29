import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, MIN_RESOLUTION_SCALE, sanitize } from "./settings";

describe("sanitize", () => {
  it("gives defaults for anything that is not a settings object", () => {
    for (const junk of [undefined, null, 0, "", "graphics", [], true, NaN]) {
      expect(sanitize(junk)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("keeps the fields it recognises and defaults the rest", () => {
    const got = sanitize({ graphics: { shadows: "low" }, sound: { muted: true } });
    expect(got.graphics.shadows).toBe("low");
    expect(got.sound.muted).toBe(true);
    expect(got.graphics.bloom).toBe(DEFAULT_SETTINGS.graphics.bloom);
    expect(got.sound.master).toBe(DEFAULT_SETTINGS.sound.master);
  });

  it("carries the HUD toggles, defaulting them on", () => {
    expect(sanitize(null).ui).toEqual({ minimap: true, lootLabels: true });
    expect(sanitize({ ui: { minimap: false } }).ui).toEqual({ minimap: false, lootLabels: true });
    expect(sanitize({ ui: { lootLabels: "no" } }).ui.lootLabels).toBe(true);
  });

  it("refuses an enum member it has never heard of", () => {
    const got = sanitize({ graphics: { shadows: "ultra", atmosphere: "swamp" } });
    expect(got.graphics.shadows).toBe(DEFAULT_SETTINGS.graphics.shadows);
    expect(got.graphics.atmosphere).toBe(DEFAULT_SETTINGS.graphics.atmosphere);
  });

  it("clamps the numbers instead of trusting them", () => {
    expect(sanitize({ sound: { master: 9 } }).sound.master).toBe(1);
    expect(sanitize({ sound: { master: -3 } }).sound.master).toBe(0);
    expect(sanitize({ graphics: { resolutionScale: 4 } }).graphics.resolutionScale).toBe(1);
    expect(sanitize({ graphics: { resolutionScale: 0.01 } }).graphics.resolutionScale).toBe(
      MIN_RESOLUTION_SCALE,
    );
    // NaN is a number to typeof and poison to setHardwareScalingLevel.
    expect(sanitize({ graphics: { resolutionScale: NaN } }).graphics.resolutionScale).toBe(
      DEFAULT_SETTINGS.graphics.resolutionScale,
    );
    expect(sanitize({ sound: { master: "0.5" } }).sound.master).toBe(DEFAULT_SETTINGS.sound.master);
  });

  it("drops keys it does not know rather than passing them through", () => {
    const got = sanitize({ graphics: { shadows: "off", raytracing: true }, mods: ["a"] }) as
      unknown as Record<string, unknown>;
    expect(Object.keys(got).sort()).toEqual(["graphics", "sound", "ui"]);
    expect(Object.keys(got["graphics"] as object).sort()).toEqual(
      Object.keys(DEFAULT_SETTINGS.graphics).sort(),
    );
  });

  it("returns a fresh object, so a caller cannot edit the defaults", () => {
    const a = sanitize(null);
    a.sound.master = 0.01;
    expect(DEFAULT_SETTINGS.sound.master).not.toBe(0.01);
    expect(sanitize(null).sound.master).toBe(DEFAULT_SETTINGS.sound.master);
  });
});
