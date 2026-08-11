import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, MIN_RESOLUTION_SCALE, sanitize } from "./settings";

describe("the keybinds ride in the settings", () => {
  const binds = (raw: unknown) => sanitize({ ui: { keybinds: raw } }).ui.keybinds;

  it("defaults to the keys the game shipped with", () => {
    expect(sanitize(null).ui.keybinds).toEqual({
      moveUp: "w", moveDown: "s", moveLeft: "a", moveRight: "d",
      flaskLife: "q", flaskMana: "e", portal: "y", pickup: "g",
      overlayMap: "tab", inventory: "i", character: "c", passives: "p",
    });
  });

  it("keeps a saved rebind and defaults the rest", () => {
    const got = binds({ pickup: "f", portal: "t" });
    expect(got.pickup).toBe("f");
    expect(got.portal).toBe("t");
    expect(got.moveUp).toBe("w");
  });

  it("lower-cases and refuses junk per entry", () => {
    expect(binds({ pickup: "F" }).pickup).toBe("f");
    expect(binds({ pickup: 3 }).pickup).toBe("g");
    expect(binds({ pickup: "" }).pickup).toBe("g");
    expect(binds({ pickup: "x".repeat(40) }).pickup).toBe("g");
    expect(binds("not an object")).toEqual(DEFAULT_SETTINGS.ui.keybinds);
  });

  it("never hands out Escape or a skill-row digit", () => {
    expect(binds({ pickup: "escape" }).pickup).toBe("g");
    expect(binds({ portal: "3" }).portal).toBe("y");
  });

  /** One key on two actions fires both off one press. First claim wins,
   *  the later action goes unbound rather than inventing a key. */
  it("unbinds the later of two actions claiming one key", () => {
    const got = binds({ flaskLife: "g" });
    expect(got.flaskLife).toBe("g");
    expect(got.pickup).toBe("");
  });
});

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
    expect(sanitize(null).ui).toEqual(DEFAULT_SETTINGS.ui);
    expect(sanitize(null).ui.minimap).toBe(true);
    expect(sanitize(null).ui.lootLabels).toBe(true);
    expect(sanitize({ ui: { minimap: false } }).ui)
      .toEqual({ ...DEFAULT_SETTINGS.ui, minimap: false });
    expect(sanitize({ ui: { lootLabels: "no" } }).ui.lootLabels).toBe(true);
  });

  it("defaults monster health bars OFF and keeps a saved true", () => {
    expect(sanitize(null).ui.monsterHealthBars).toBe(false);
    expect(sanitize({ ui: { monsterHealthBars: true } }).ui.monsterHealthBars).toBe(true);
    expect(sanitize({ ui: { monsterHealthBars: "yes" } }).ui.monsterHealthBars).toBe(false);
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
    // The overlay map floor is 0.15, not 0: fully transparent reads as broken.
    expect(sanitize({ ui: { overlayMapOpacity: 0 } }).ui.overlayMapOpacity).toBe(0.15);
    expect(sanitize({ ui: { overlayMapOpacity: 2 } }).ui.overlayMapOpacity).toBe(1);
    expect(sanitize(null).ui.overlayMapOpacity).toBe(DEFAULT_SETTINGS.ui.overlayMapOpacity);
  });

  it("keeps every saved sound category and defaults older saves", () => {
    expect(sanitize({ sound: {
      music: 0.1,
      interface: 0.2,
      skills: 0.3,
      loot: 0.4,
      environment: 0.5,
    } }).sound).toEqual({
      ...DEFAULT_SETTINGS.sound,
      music: 0.1,
      interface: 0.2,
      skills: 0.3,
      loot: 0.4,
      environment: 0.5,
    });
    expect(sanitize({ sound: { master: 0.6 } }).sound).toEqual({
      ...DEFAULT_SETTINGS.sound,
      master: 0.6,
    });
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

describe("the skill bar is the character's, not the settings'", () => {
  it("no longer carries a skill bar, because the bar is the character's", () => {
    expect("skillBar" in DEFAULT_SETTINGS.ui).toBe(false);
  });

  it("ignores a stale skillBar key in a saved settings blob without throwing", () => {
    const parsed = sanitize({ ui: { skillBar: ["skill.a.v1"] } });
    expect(parsed.ui).not.toHaveProperty("skillBar");
  });
});
