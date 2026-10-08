import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, GRAPHICS_PRESETS, MIN_RESOLUTION_SCALE, controlModeOf, presetForRenderer, presetOf, sanitize, stepDown, type ControlMode, type GraphicsPreset, type GraphicsSettings } from "./settings";

describe("the keybinds ride in the settings", () => {
  const binds = (raw: unknown, mode: ControlMode = "wasd") =>
    sanitize({ ui: { keybinds: { [mode]: raw } } }).ui.keybinds[mode];

  it("defaults to PoE2's click-to-move keys: skills on QWERT, flasks on 1 and 2", () => {
    expect(sanitize(null).ui.keybinds.mouse).toEqual({
      moveUp: "", moveDown: "", moveLeft: "", moveRight: "",
      skill1: "q", skill2: "w", skill3: "e", skill4: "r", skill5: "t",
      flaskLife: "1", flaskMana: "2", portal: "y", pickup: "g",
      overlayMap: "tab", inventory: "i", character: "c", passives: "p",
    });
  });

  it("defaults to PoE2's WASD keys: the W skill moves to F", () => {
    expect(sanitize(null).ui.keybinds.wasd).toEqual({
      moveUp: "w", moveDown: "s", moveLeft: "a", moveRight: "d",
      skill1: "q", skill2: "e", skill3: "r", skill4: "t", skill5: "f",
      flaskLife: "1", flaskMana: "2", portal: "y", pickup: "g",
      overlayMap: "tab", inventory: "i", character: "c", passives: "p",
    });
  });

  it("never lets a movement key into mouse mode, saved or not", () => {
    const got = binds({ moveUp: "w", pickup: "x" }, "mouse");
    expect(got.moveUp).toBe("");
    expect(got.pickup).toBe("x");
  });

  it("reads a save from before the two modes as the new defaults", () => {
    const legacy = { moveUp: "w", flaskLife: "q", flaskMana: "e", pickup: "f" };
    expect(sanitize({ ui: { keybinds: legacy } }).ui.keybinds).toEqual(DEFAULT_SETTINGS.ui.keybinds);
  });

  it("keeps a saved rebind and defaults the rest", () => {
    const got = binds({ pickup: "v", portal: "z" });
    expect(got.pickup).toBe("v");
    expect(got.portal).toBe("z");
    expect(got.moveUp).toBe("w");
  });

  it("lower-cases and refuses junk per entry", () => {
    expect(binds({ pickup: "V" }).pickup).toBe("v");
    expect(binds({ pickup: 3 }).pickup).toBe("g");
    expect(binds({ pickup: "" }).pickup).toBe("g");
    expect(binds({ pickup: "x".repeat(40) }).pickup).toBe("g");
    expect(binds("not an object")).toEqual(DEFAULT_SETTINGS.ui.keybinds.wasd);
  });

  it("never hands out Escape", () => {
    expect(binds({ pickup: "escape" }).pickup).toBe("g");
  });

  /** One key on two actions fires both off one press. First claim wins,
   *  the later action goes unbound rather than inventing a key. */
  it("unbinds the later of two actions claiming one key", () => {
    const got = binds({ flaskLife: "g" });
    expect(got.flaskLife).toBe("g");
    expect(got.pickup).toBe("");
  });
});

describe("the control mode is chosen per character", () => {
  const controls = (raw: unknown) => sanitize({ ui: { controls: raw } }).ui.controls;

  it("starts with no character having chosen", () => {
    expect(sanitize(null).ui.controls).toEqual({});
  });

  it("keeps a valid choice and drops junk entries", () => {
    expect(controls({ a: "wasd", b: "mouse", c: "keyboard", d: 1 })).toEqual({ a: "wasd", b: "mouse" });
    expect(controls(["wasd"])).toEqual({});
  });

  it("caps how many characters a hand-edited save can list", () => {
    const many = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`c${i}`, "wasd"]));
    expect(Object.keys(controls(many)).length).toBe(64);
  });

  it("reads a character that never chose as mouse movement", () => {
    expect(controlModeOf(sanitize(null), "nobody")).toBe("mouse");
    expect(controlModeOf(sanitize({ ui: { controls: { x: "wasd" } } }), "x")).toBe("wasd");
  });

  it("reads only a character's own entry, never what every object inherits", () => {
    expect(controlModeOf(sanitize(null), "constructor")).toBe("mouse");
    expect(controlModeOf(sanitize(null), "toString")).toBe("mouse");
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

  it("defaults monster health bars ON and keeps a saved false", () => {
    expect(sanitize(null).ui.monsterHealthBars).toBe(true);
    expect(sanitize({ ui: { monsterHealthBars: false } }).ui.monsterHealthBars).toBe(false);
    expect(sanitize({ ui: { monsterHealthBars: "yes" } }).ui.monsterHealthBars).toBe(true);
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

describe("graphics presets and auto-detect", () => {
  it("tiers a GPU off the renderer string", () => {
    const cases: [string, GraphicsPreset][] = [
      ["ANGLE (Intel, Intel(R) Arc(TM) 140T GPU (16GB) Direct3D11 vs_5_0 ps_5_0, D3D11)", "medium"],
      ["ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)", "medium"],
      ["ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)", "ultra"],
      ["ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)", "medium"],
      ["ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)", "ultra"],
      ["ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)", "ultra"],
      ["ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)", "low"],
      ["llvmpipe (LLVM 15.0.7, 256 bits)", "low"],
      ["Apple M2", "high"],
      ["", "high"],
    ];
    for (const [renderer, want] of cases) expect([renderer, presetForRenderer(renderer)]).toEqual([renderer, want]);
  });

  it("a first launch takes the detected preset and stays on auto", () => {
    const got = sanitize(undefined, "ANGLE (Intel, Intel(R) Arc(TM) 140T GPU)").graphics;
    expect(presetOf(got)).toBe("medium");
    expect(got.auto).toBe(true);
    expect(sanitize({ sound: { muted: true } }, "Intel(R) UHD Graphics").graphics.shadows).toBe(GRAPHICS_PRESETS.medium.shadows);
  });

  it("saved graphics are never re-detected, and an old save is not auto", () => {
    const got = sanitize({ graphics: { shadows: "high" } }, "Intel(R) UHD Graphics").graphics;
    expect(got.shadows).toBe("high");
    expect(got.auto).toBe(false);
    expect(sanitize({ graphics: { auto: true } }).graphics.auto).toBe(true);
  });

  it("knows a preset by its knobs and calls anything else custom", () => {
    for (const p of ["low", "medium", "high", "ultra"] as const) {
      expect(presetOf({ ...DEFAULT_SETTINGS.graphics, ...GRAPHICS_PRESETS[p] })).toBe(p);
    }
    expect(presetOf({ ...DEFAULT_SETTINGS.graphics, ...GRAPHICS_PRESETS.ultra, bloom: false })).toBeNull();
  });

  it("steps down one preset at a time and stops at low", () => {
    let g: GraphicsSettings | null = { ...DEFAULT_SETTINGS.graphics, ...GRAPHICS_PRESETS.ultra, torchWarmth: 0.2 };
    const seen: (GraphicsPreset | null)[] = [];
    while ((g = stepDown(g))) seen.push(presetOf(g));
    expect(seen).toEqual(["high", "medium", "low"]);
    expect(stepDown({ ...DEFAULT_SETTINGS.graphics, ...GRAPHICS_PRESETS.high, bloom: false })).toBeNull();
    expect(stepDown({ ...DEFAULT_SETTINGS.graphics, ...GRAPHICS_PRESETS.high })!.torchWarmth).toBe(DEFAULT_SETTINGS.graphics.torchWarmth);
  });

  it("accepts the medium shadow step", () => {
    expect(sanitize({ graphics: { shadows: "medium" } }).graphics.shadows).toBe("medium");
  });
});
