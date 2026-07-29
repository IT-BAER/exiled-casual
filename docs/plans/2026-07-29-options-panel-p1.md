# Options Panel — Increment 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Options prose screen with a real tabbed panel that opens from both the main menu and the in-game Escape menu, carrying a working Graphics tab and a working Sound tab whose every row changes something you can see or hear.

**Architecture:** A pure leaf `settings.ts` owns the shape, the defaults and `sanitize`. The roster gains one optional opaque `settings` field beside `stash`, so no save version changes. `OptionsPanel.tsx` is presentational: it takes a `Settings` and emits the next one, never touching storage or Babylon. Whoever mounts it owns applying (`applyGraphics` on the live scene, `setSoundLevel` on the audio module) and persisting (debounced).

**Tech Stack:** TypeScript, React 18, Babylon.js, Vitest + jsdom + @testing-library/react, npm workspaces.

Spec: `docs/specs/2026-07-29-options-panel-design.md`. Reference plate: `reference-screenshots/options.png` (**PoE 1**).

Plan lives in `docs/plans/` alongside the project's six other plans, matching `docs/specs/` for the design.

## Global Constraints

- **Consult `reference-screenshots/options.png` before AND during the UI work.** Never design from memory.
- **Raster art goes through `/codex-imagegen`**, never hand-authored SVG. Masters into `assets/menu/`, crop-to-alpha and downscale by `tools/build_menu_textures.py`. Renders run long: launch as background agents.
- **No save version bump.** `ROSTER_VERSION` stays `3`.
- **`@exiled/rules` is a pure leaf.** Nothing here touches it.
- **`apps/web/src/settings.ts` must import nothing** — not Babylon, not React, not `@exiled/*`. The menu bundle pulls it in without dragging the renderer.
- Gates before every commit: `npx vitest run` (baseline 1185 pass), `npm run typecheck` rc=0, `npm run build -w apps/web` rc=0.
- Commit style: direct-to-main, one commit per task, no attribution trailers, no emdashes in messages.
- No emdashes in user-visible copy either; the existing menu copy uses commas and colons.

---

### Task 1: Control art (launch first, it renders in the background)

The panel needs five plates that do not exist. Launch this first so it renders while Tasks 2 through 6 are written; it is only *consumed* by Task 7.

**Files:**
- Create: `assets/menu/gem_check_off_v1.png`, `assets/menu/gem_check_on_v1.png`, `assets/menu/slider_track_v1.png`, `assets/menu/slider_handle_v1.png`, `assets/menu/tab_plate_v1.png`
- Modify: `tools/build_menu_textures.py:30-42` (the `PLAN` dict)
- Output (generated, not committed by hand): `apps/web/public/textures/ui/menu/gem_check_off.png`, `gem_check_on.png`, `slider_track.png`, `slider_handle.png`, `tab_plate.png`

**Interfaces:**
- Consumes: nothing.
- Produces: five PNGs under `/textures/ui/menu/`, referenced in Task 7 as `${MENU_ART}/<name>.png`.

- [ ] **Step 1: Look at the plate**

Open `reference-screenshots/options.png`. The four things being matched, all visible in it:
- the round gem checkbox, a dark ember disc sunk into a metal ring; checked adds a gold tick and lights the disc orange
- the slider: a black recessed track with a thin gold border, and a rectangular orange block handle standing proud of it
- the tab plate: a stone tab with a gold-lipped top edge, drawn ONCE and tinted by CSS filter for active/inactive (the project's own rule, `frames.tsx:11-13`: hover and pressed are filters over one plate, because two generations of the same object are never the same object)

- [ ] **Step 2: Launch the render as a background agent**

Use the `/codex-imagegen` skill. All five are authored EMPTY (no baked text) at 1024px on transparent background, matching how `button_plate_v1` and `panel_frame_v1` were authored.

Prompts, one render each:

1. `gem_check_off_v1` — "A single round recessed button from a dark fantasy game interface, seen straight on. An unlit dark ember-red glass gem sunk into a worn gilt-bronze ring bezel. Cold, unlit, slightly dusty. Centred, transparent background, no text, no shadow on the ground."
2. `gem_check_on_v1` — "The same round recessed button, now lit: the glass gem glows warm orange from within, and a gold check mark is struck across it. Worn gilt-bronze ring bezel. Centred, transparent background, no text."
3. `slider_track_v1` — "A long horizontal recessed slot from a dark fantasy game interface. Black inset channel with a thin worn-gold border rail running its full length, ends capped with small gilt fittings. Straight on, transparent background, no handle, no text."
4. `slider_handle_v1` — "A small upright rectangular slider grip from a dark fantasy game interface. Polished orange-amber block held in a gilt-bronze bracket, standing proud with a soft inner glow. Straight on, transparent background, no track, no text."
5. `tab_plate_v1` — "A single trapezoid tab plate from a dark fantasy game interface, wider at the bottom, with a gold-lipped top edge and dark carved stone below it. Straight on, transparent background, empty face, no text, no lettering."

- [ ] **Step 3: Add the five to the build script's PLAN**

In `tools/build_menu_textures.py`, inside `PLAN`, after the `"divider_v1"` line:

```python
    "gem_check_off_v1": ("gem_check_off.png", 128, None),
    "gem_check_on_v1": ("gem_check_on.png", 128, None),
    "slider_track_v1": ("slider_track.png", 512, None),
    "slider_handle_v1": ("slider_handle.png", 64, None),
    "tab_plate_v1": ("tab_plate.png", 384, None),
```

- [ ] **Step 4: Build and verify the outputs exist and are cropped**

Run: `python tools/build_menu_textures.py`
Expected: five new files in `apps/web/public/textures/ui/menu/`. Verify each is non-empty and that the gem is roughly square after the alpha crop:

```bash
python -c "from PIL import Image; import pathlib; d=pathlib.Path('apps/web/public/textures/ui/menu'); [print(f.name, Image.open(f).size) for f in sorted(d.glob('gem_*.png')) + sorted(d.glob('slider_*.png')) + sorted(d.glob('tab_*.png'))]"
```
Expected: `gem_check_off.png` and `gem_check_on.png` within 10% of square (a lopsided gem means the render put it off-centre and needs redoing, the same way the Atlas socket came back an oval at 802x668 and had to be regenerated round).

- [ ] **Step 5: Commit**

```bash
git add assets/menu/gem_check_off_v1.png assets/menu/gem_check_on_v1.png assets/menu/slider_track_v1.png assets/menu/slider_handle_v1.png assets/menu/tab_plate_v1.png tools/build_menu_textures.py apps/web/public/textures/ui/menu/
git commit -m "feat(menu): the three things a settings row is made of"
```

---

### Task 2: The settings leaf

**Files:**
- Create: `apps/web/src/settings.ts`
- Test: `apps/web/src/settings.test.ts`

**Interfaces:**
- Consumes: nothing. This file imports nothing at all.
- Produces:
  - `type ShadowQuality = "off" | "low" | "high"`
  - `type AtmosphereName = "soft" | "heavy"`
  - `interface GraphicsSettings { shadows: ShadowQuality; ambientOcclusion: boolean; bloom: boolean; atmosphere: AtmosphereName; resolutionScale: number }`
  - `interface SoundSettings { master: number; muted: boolean }`
  - `interface Settings { graphics: GraphicsSettings; sound: SoundSettings }`
  - `const DEFAULT_SETTINGS: Settings`
  - `const MIN_RESOLUTION_SCALE = 0.5`
  - `function sanitize(raw: unknown): Settings`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/settings.test.ts`:

```ts
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
    // NaN is a number to typeof and a disaster to setHardwareScalingLevel.
    expect(sanitize({ graphics: { resolutionScale: NaN } }).graphics.resolutionScale).toBe(
      DEFAULT_SETTINGS.graphics.resolutionScale,
    );
    expect(sanitize({ sound: { master: "0.5" } }).sound.master).toBe(DEFAULT_SETTINGS.sound.master);
  });

  it("drops keys it does not know rather than passing them through", () => {
    const got = sanitize({ graphics: { shadows: "off", raytracing: true }, mods: ["a"] }) as
      Record<string, unknown>;
    expect(Object.keys(got).sort()).toEqual(["graphics", "sound"]);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/settings.test.ts`
Expected: FAIL, "Failed to resolve import ./settings".

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/settings.ts`:

```ts
/**
 * What the player has set, and the only thing that parses it.
 *
 * This file imports NOTHING. It is pulled into the menu bundle, which must not
 * grow a renderer or a simulation to draw a checkbox, and it is the trust
 * boundary for the save: `settings` rides in the roster blob as an opaque field
 * exactly as `stash` does, so what comes back off the disk is `unknown` and has
 * to be proven before anything reads it.
 *
 * `sanitize` is therefore TOTAL. A corrupt settings field reads as defaults, the
 * way `readBlob` already treats unparseable JSON, because the alternative is a
 * game that will not start and cannot say why.
 */

export type ShadowQuality = "off" | "low" | "high";

/**
 * Structurally the renderer's `AtmospherePreset`, deliberately re-declared here
 * rather than imported: `engine.ts` pulls in Babylon, and this file is the one
 * the menu reads.
 */
export type AtmosphereName = "soft" | "heavy";

export interface GraphicsSettings {
  shadows: ShadowQuality;
  ambientOcclusion: boolean;
  bloom: boolean;
  atmosphere: AtmosphereName;
  /** 1 is native. Below that the canvas renders small and is scaled up. */
  resolutionScale: number;
}

export interface SoundSettings {
  /** 0..1, linear on the slider and on the gain. */
  master: number;
  muted: boolean;
}

export interface Settings {
  graphics: GraphicsSettings;
  sound: SoundSettings;
}

/** Half resolution. Lower is legible as a bug rather than as a setting. */
export const MIN_RESOLUTION_SCALE = 0.5;

export const DEFAULT_SETTINGS: Settings = {
  graphics: {
    shadows: "high",
    ambientOcclusion: true,
    bloom: true,
    atmosphere: "soft",
    resolutionScale: 1,
  },
  sound: { master: 0.8, muted: false },
};

const SHADOW_QUALITIES: readonly ShadowQuality[] = ["off", "low", "high"];
const ATMOSPHERES: readonly AtmosphereName[] = ["soft", "heavy"];

function obj(raw: unknown): Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function bool(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

/** Finite-checked, then clamped. NaN is a number to `typeof` and poison to Babylon. */
function num(raw: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(hi, Math.max(lo, raw));
}

function member<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback;
}

export function sanitize(raw: unknown): Settings {
  const root = obj(raw);
  const g = obj(root["graphics"]);
  const s = obj(root["sound"]);
  const d = DEFAULT_SETTINGS;
  return {
    graphics: {
      shadows: member(g["shadows"], SHADOW_QUALITIES, d.graphics.shadows),
      ambientOcclusion: bool(g["ambientOcclusion"], d.graphics.ambientOcclusion),
      bloom: bool(g["bloom"], d.graphics.bloom),
      atmosphere: member(g["atmosphere"], ATMOSPHERES, d.graphics.atmosphere),
      resolutionScale: num(
        g["resolutionScale"],
        MIN_RESOLUTION_SCALE,
        1,
        d.graphics.resolutionScale,
      ),
    },
    sound: {
      master: num(s["master"], 0, 1, d.sound.master),
      muted: bool(s["muted"], d.sound.muted),
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/web/src/settings.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/settings.ts apps/web/src/settings.test.ts
git commit -m "feat(settings): a shape for what he sets, and the only thing that trusts the disk"
```

---

### Task 3: The roster carries settings

**Files:**
- Modify: `packages/persistence/src/roster.ts:45-51` (the `RosterBlob` interface) and after line 154 (`putStash`)
- Test: `packages/persistence/src/roster.test.ts` (append; the file exists)

**Interfaces:**
- Consumes: nothing from earlier tasks. `settings` is `unknown` here on purpose.
- Produces: `RosterBlob.settings?: unknown`, and `putSettings(roster: RosterBlob, settings: unknown): RosterBlob`.

- [ ] **Step 1: Write the failing test**

Append to `packages/persistence/src/roster.test.ts`:

```ts
describe("settings on the roster", () => {
  it("puts settings without touching the characters or the stash", () => {
    const base: RosterBlob = { ...emptyRoster(), stash: { grid: [] } };
    const next = putSettings(base, { sound: { muted: true } });
    expect(next.settings).toEqual({ sound: { muted: true } });
    expect(next.stash).toEqual(base.stash);
    expect(next.characters).toBe(base.characters);
    expect(base.settings).toBeUndefined(); // the input is not mutated
  });

  it("does not change the blob version, so an old save still loads", () => {
    const next = putSettings(emptyRoster(), { graphics: { bloom: false } });
    expect(next.version).toBe(ROSTER_VERSION);
    expect(ROSTER_VERSION).toBe(3);
  });

  it("reads a v3 blob that has no settings key at all", () => {
    const old = { version: 3, characters: [] };
    const parsed = asRoster(old);
    expect(parsed).not.toBeNull();
    expect(parsed!.settings).toBeUndefined();
  });
});
```

Make sure the file's import line includes `putSettings`, `asRoster` and `ROSTER_VERSION`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/persistence`
Expected: FAIL, `putSettings is not a function` (or a TS resolution error on the import).

- [ ] **Step 3: Write the implementation**

In `packages/persistence/src/roster.ts`, add the field to `RosterBlob` directly under `stash`:

```ts
  /** Shared across every character, as PoE shares a stash account-wide. Opaque. */
  stash?: unknown;
  /**
   * Client settings, global rather than per character, and opaque for the same
   * reason the stash is: this leaf must not learn what a shadow quality is.
   * OPTIONAL, so a v3 blob written before settings existed still parses and the
   * version does not have to move. `asRoster` rejects a version that is not
   * current, so bumping it would discard the player's roster to buy nothing.
   */
  settings?: unknown;
```

And beside `putStash`:

```ts
/** Replace the client settings. */
export function putSettings(roster: RosterBlob, settings: unknown): RosterBlob {
  return { ...roster, settings };
}
```

Confirm `putSettings` is re-exported: check `packages/persistence/src/index.ts` for how `putStash` leaves the package and add `putSettings` the same way.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/persistence`
Expected: PASS, including the three new tests.

- [ ] **Step 5: Commit**

```bash
git add packages/persistence/src/roster.ts packages/persistence/src/roster.test.ts packages/persistence/src/index.ts
git commit -m "feat(persistence): settings ride beside the stash, and the version stays where it is"
```

---

### Task 4: Reading and writing settings from the menu

**Files:**
- Modify: `apps/web/src/save/roster.ts`
- Test: `apps/web/src/save/roster.test.ts` (create if absent)

**Interfaces:**
- Consumes: `sanitize`, `Settings` (Task 2); `putSettings`, `RosterBlob` (Task 3).
- Produces:
  - `function settingsOf(roster: RosterBlob): Settings`
  - `const SETTINGS_DEBOUNCE_MS = 400`
  - `function saveSettingsSoon(roster: RosterBlob, settings: Settings): void`
  - `function flushSettingsSave(): Promise<void>` (test seam and a way for a caller to force the write)

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/save/roster.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryKv, emptyRoster, loadRoster, saveRoster } from "@exiled/persistence";
import { DEFAULT_SETTINGS } from "../settings";
import {
  SETTINGS_DEBOUNCE_MS,
  flushSettingsSave,
  saveSettingsSoon,
  setKv,
  settingsOf,
} from "./roster";

let store: MemoryKv;

beforeEach(() => {
  store = new MemoryKv();
  setKv(store);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  setKv(null);
});

describe("settingsOf", () => {
  it("reads defaults from a roster that has never had settings", () => {
    expect(settingsOf(emptyRoster())).toEqual(DEFAULT_SETTINGS);
  });

  it("sanitizes whatever was on the disk rather than trusting it", () => {
    const roster = { ...emptyRoster(), settings: { sound: { master: 99 } } };
    expect(settingsOf(roster).sound.master).toBe(1);
  });
});

describe("saveSettingsSoon", () => {
  it("writes once for a burst, with the last value", async () => {
    const roster = emptyRoster();
    for (let i = 1; i <= 10; i++) {
      saveSettingsSoon(roster, { ...DEFAULT_SETTINGS, sound: { master: i / 10, muted: false } });
    }
    expect(store.writes).toBe(0); // nothing yet: the burst is still inside the window
    await vi.advanceTimersByTimeAsync(SETTINGS_DEBOUNCE_MS + 10);
    await flushSettingsSave();
    expect(store.writes).toBe(1);
    const saved = await loadRoster(store);
    expect((saved!.settings as { sound: { master: number } }).sound.master).toBeCloseTo(1);
  });

  it("keeps everything else in the blob", async () => {
    const roster = { ...emptyRoster(), stash: { keep: true } };
    await saveRoster(store, roster);
    saveSettingsSoon(roster, DEFAULT_SETTINGS);
    await vi.advanceTimersByTimeAsync(SETTINGS_DEBOUNCE_MS + 10);
    await flushSettingsSave();
    const saved = await loadRoster(store);
    expect(saved!.stash).toEqual({ keep: true });
  });
});
```

`MemoryKv` must expose a `writes` counter. Check `packages/persistence/src/index.ts`; if it has none, add one:

```ts
  /** How many times save() was called. Lets a test see a debounce actually debouncing. */
  writes = 0;
```
incremented at the top of its `save`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/save/roster.test.ts`
Expected: FAIL, `settingsOf is not exported`.

- [ ] **Step 3: Write the implementation**

In `apps/web/src/save/roster.ts`, extend the import from `@exiled/persistence` with `putSettings`, add `import { sanitize, type Settings } from "../settings";`, and append:

```ts
/** What the player has set, proven safe. A roster with no settings reads as defaults. */
export function settingsOf(roster: RosterBlob): Settings {
  return sanitize(roster.settings);
}

/**
 * How long a burst of changes is allowed to run before it costs a write.
 *
 * Dragging a slider fires per pointer event, and each write is a JSON.stringify
 * of the WHOLE blob (every character's save rides in it) plus an IndexedDB
 * round trip. 400ms is a guess, and the only one in this file.
 */
export const SETTINGS_DEBOUNCE_MS = 400;

let settingsTimer: ReturnType<typeof setTimeout> | null = null;
let settingsWrite: Promise<void> = Promise.resolve();

/**
 * Write settings at most once per burst; the last call wins.
 *
 * ponytail: the roster is captured per call, so a write scheduled here and a
 * character created before it fires would save the older roster. Settings only
 * change from the Options panel, where no character can be created, so the
 * window does not exist today. Re-read the roster here if that ever stops being
 * true.
 */
export function saveSettingsSoon(roster: RosterBlob, settings: Settings): void {
  if (settingsTimer !== null) clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    settingsTimer = null;
    settingsWrite = saveRoster(kv(), putSettings(roster, settings));
  }, SETTINGS_DEBOUNCE_MS);
}

/** Wait for the pending settings write. Test seam, and how a caller forces the flush. */
export function flushSettingsSave(): Promise<void> {
  return settingsWrite;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/web/src/save apps/web/src/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/save/roster.ts apps/web/src/save/roster.test.ts packages/persistence/src/index.ts
git commit -m "feat(save): settings read back sanitized, and a drag costs one write"
```

---

### Task 5: Graphics apply to a live scene

**Files:**
- Modify: `apps/web/src/render/engine.ts` (add `applyGraphics` after `applyAtmosphere`, which ends near line 152)
- Test: `apps/web/src/render/graphics.test.ts`

**Interfaces:**
- Consumes: `GraphicsSettings` (Task 2).
- Produces: `function applyGraphics(scene: Scene, engine: Engine | null, g: GraphicsSettings): void`.

Every target is looked up BY NAME off the scene rather than passed in, because `createScene` wraps each piece in its own `try`/`catch` (WebGL1 and `NullEngine` legitimately build none of them) and `SceneHandle` exposes only `scene`, `camera` and the zoom pair. Names, all verified in `engine.ts`: lights `"sun"` (`:355`), `"torch"` (`:363`), `"fill"` (`:350`); pipeline `"ssao"` (`:491`); glow layer `"glow"` (`:507`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/render/graphics.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { applyGraphics } from "./engine";
import { DEFAULT_SETTINGS } from "../settings";

function bareScene() {
  const engine = new NullEngine();
  return { engine, scene: new Scene(engine) };
}

describe("applyGraphics", () => {
  it("is a no-op on a scene that has none of the pieces", () => {
    const { engine, scene } = bareScene();
    for (const shadows of ["off", "low", "high"] as const) {
      expect(() =>
        applyGraphics(scene, engine, { ...DEFAULT_SETTINGS.graphics, shadows }),
      ).not.toThrow();
    }
    expect(() =>
      applyGraphics(scene, null, { ...DEFAULT_SETTINGS.graphics, ambientOcclusion: false }),
    ).not.toThrow();
    engine.dispose();
  });

  it("turns the shadow lights off and back on without disposing anything", () => {
    const { engine, scene } = bareScene();
    const sun = new DirectionalLight("sun", new Vector3(0, -1, 0), scene);
    const torch = new PointLight("torch", new Vector3(0, 2, 0), scene);
    const sunGen = new ShadowGenerator(256, sun);
    new ShadowGenerator(128, torch);

    applyGraphics(scene, engine, { ...DEFAULT_SETTINGS.graphics, shadows: "off" });
    expect(sun.shadowEnabled).toBe(false);
    expect(torch.shadowEnabled).toBe(false);
    // Off must be REVERSIBLE: a disposed generator cannot come back without
    // rebuilding the scene, and the panel has to be able to turn this back on.
    expect(sun.getShadowGenerator()).toBe(sunGen);

    applyGraphics(scene, engine, { ...DEFAULT_SETTINGS.graphics, shadows: "high" });
    expect(sun.shadowEnabled).toBe(true);
    expect(torch.shadowEnabled).toBe(true);
    engine.dispose();
  });

  it("low keeps the sun and drops the torch, which is the expensive one", () => {
    const { engine, scene } = bareScene();
    const sun = new DirectionalLight("sun", new Vector3(0, -1, 0), scene);
    const torch = new PointLight("torch", new Vector3(0, 2, 0), scene);
    new ShadowGenerator(256, sun);
    new ShadowGenerator(128, torch);

    applyGraphics(scene, engine, { ...DEFAULT_SETTINGS.graphics, shadows: "low" });
    expect(sun.shadowEnabled).toBe(true);
    expect(torch.shadowEnabled).toBe(false); // a cube map is six faces
    engine.dispose();
  });

  it("moves the fog band when the atmosphere changes", () => {
    const { engine, scene } = bareScene();
    applyGraphics(scene, engine, { ...DEFAULT_SETTINGS.graphics, atmosphere: "soft" });
    const soft = scene.fogEnd;
    applyGraphics(scene, engine, { ...DEFAULT_SETTINGS.graphics, atmosphere: "heavy" });
    expect(scene.fogEnd).not.toBe(soft);
    expect(scene.fogEnd).toBeLessThan(soft);
    engine.dispose();
  });

  it("asks the engine for the resolution it was given", () => {
    const { engine, scene } = bareScene();
    applyGraphics(scene, engine, { ...DEFAULT_SETTINGS.graphics, resolutionScale: 0.5 });
    expect(engine.getHardwareScalingLevel()).toBeCloseTo(2);
    applyGraphics(scene, engine, { ...DEFAULT_SETTINGS.graphics, resolutionScale: 1 });
    expect(engine.getHardwareScalingLevel()).toBeCloseTo(1);
    engine.dispose();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/render/graphics.test.ts`
Expected: FAIL, `applyGraphics is not exported`.

- [ ] **Step 3: Write the implementation**

In `apps/web/src/render/engine.ts`, add `import type { GraphicsSettings } from "../settings";` at the top with the other imports, and add after `applyAtmosphere`:

```ts
/**
 * Push the player's graphics settings onto a scene that is already running.
 *
 * Every row here is a property flip, never a rebuild, which is what makes the
 * Options panel's "applies live, no SAVE button" an honest promise rather than a
 * reload in disguise.
 *
 * Targets are looked up BY NAME rather than handed in, because `createScene`
 * builds each of them inside its own try/catch: under `NullEngine` and on WebGL1
 * there is legitimately no SSAO pipeline, no glow layer and no shadow generator,
 * and a missing piece must be a no-op rather than a crash. That is also what
 * makes this testable headless.
 *
 * `engine` is nullable so a caller that has settings before it has a renderer
 * can still apply the rest.
 */
export function applyGraphics(scene: Scene, engine: Engine | null, g: GraphicsSettings): void {
  applyAtmosphere(scene, g.atmosphere);

  // Shadows. `shadowEnabled` and NOT disposing the generator: disposing is a
  // one-way door, and the whole point of a live setting is that it comes back.
  const sun = scene.getLightByName("sun");
  if (sun) sun.shadowEnabled = g.shadows !== "off";
  // The torch is a POINT light, so its shadow map is a cube: six faces for one
  // pool of light. It is the first thing to drop and the last to restore.
  const torch = scene.getLightByName("torch");
  if (torch) torch.shadowEnabled = g.shadows === "high";

  const ssao = scene.postProcessRenderPipelineManager.supportedPipelines.find(
    (p) => p.name === "ssao",
  );
  if (ssao && scene.activeCamera) {
    if (g.ambientOcclusion) {
      scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline("ssao", scene.activeCamera);
    } else {
      scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline("ssao", scene.activeCamera);
    }
  }

  const glow = scene.effectLayers.find((l) => l.name === "glow");
  if (glow) glow.isEnabled = g.bloom;

  // Babylon's number is the INVERSE: 2 renders at half width and height.
  if (engine) engine.setHardwareScalingLevel(1 / g.resolutionScale);
}
```

If `getLightByName` returns a type without `shadowEnabled` in this Babylon version, narrow with `as unknown as { shadowEnabled: boolean }` and leave a one-line comment saying why.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/web/src/render/graphics.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the whole render suite, it is the one most likely to be disturbed**

Run: `npx vitest run apps/web/src/render && npm run typecheck`
Expected: PASS, rc=0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/render/engine.ts apps/web/src/render/graphics.test.ts
git commit -m "feat(render): five graphics knobs that bite on a scene already running"
```

---

### Task 6: A master gain to hang a volume on

Today `playDropSound` connects its `dry` and `wet` gains STRAIGHT to `ctx.destination` (`drop-sound.ts:75-76`). There is nowhere to put a volume. This inserts one node.

**Files:**
- Modify: `apps/web/src/audio/drop-sound.ts:40-42` (module state), `:71-80` (the `audio()` builder)
- Test: `apps/web/src/audio/drop-sound.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `function setSoundLevel(master: number, muted: boolean): void`, and `function soundLevel(): number` for the test.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/audio/drop-sound.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { setSoundLevel, soundLevel } from "./drop-sound";

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
    // jsdom has no WebAudio: the menu sets a volume long before the first drop.
    expect(() => setSoundLevel(0.5, false)).not.toThrow();
    expect(soundLevel()).toBeCloseTo(0.5);
  });

  it("clamps, because the slider is not the only caller", () => {
    setSoundLevel(5, false);
    expect(soundLevel()).toBe(1);
    setSoundLevel(-1, false);
    expect(soundLevel()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/audio`
Expected: FAIL, `setSoundLevel is not exported`.

- [ ] **Step 3: Write the implementation**

In `apps/web/src/audio/drop-sound.ts`, replace the module-state block at lines 40-42:

```ts
let ctx: AudioContext | null = null;
let dry: GainNode | null = null;
let wet: GainNode | null = null;
/**
 * The one node everything passes through, so there is somewhere to put a volume.
 *
 * Both busses used to reach `ctx.destination` directly, which meant the Options
 * panel had no gain to hold. It also has to exist as a NUMBER before it exists
 * as a node: the menu sets a volume long before the first drop creates a context.
 */
let master: GainNode | null = null;
let level = 0.8;

/** The gain actually being applied. Muted is zero, and the volume is remembered. */
export function soundLevel(): number {
  return level;
}

/** Set the output volume. Safe before any AudioContext exists. */
export function setSoundLevel(volume: number, muted: boolean): void {
  const clamped = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0;
  level = muted ? 0 : clamped;
  if (master && ctx) master.gain.setTargetAtTime(level, ctx.currentTime, 0.01);
}
```

Then in `audio()`, replace the two direct connections to the destination:

```ts
  ctx = new Ctor();
  dry = ctx.createGain();
  wet = ctx.createGain();
  master = ctx.createGain();
  master.gain.value = level;
  master.connect(ctx.destination);
  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx);
  wet.connect(verb).connect(master);
  dry.connect(master);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/web/src/audio`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/audio/drop-sound.ts apps/web/src/audio/drop-sound.test.ts
git commit -m "feat(audio): one gain everything passes through, so a volume has somewhere to go"
```

---

### Task 7: The panel, its tab strip, and the three controls

**Files:**
- Create: `apps/web/src/menu/OptionsPanel.tsx`
- Test: `apps/web/src/menu/OptionsPanel.test.tsx`

**Interfaces:**
- Consumes: `Settings`, `DEFAULT_SETTINGS`, `MIN_RESOLUTION_SCALE` (Task 2); `FramedPanel`, `MenuButton`, `Divider`, `Label`, `MENU_ART`, `GOLD`, `GOLD_DIM`, `PARCHMENT`, `SERIF` (`frames.tsx`); the five PNGs from Task 1.
- Produces:
  ```ts
  export function OptionsPanel(props: {
    settings: Settings;
    onChange: (next: Settings) => void;
    onClose: () => void;
  }): React.ReactElement
  ```
  Presentational only: it never writes to storage and never imports Babylon, so it renders under jsdom. The mounting screen owns applying and persisting.

- [ ] **Step 1: Look at the plate again before writing any layout**

Open `reference-screenshots/options.png`. Reading top to bottom: carved header wing across the top, gilt name band centred on it reading OPTIONS, round red X on the wing's right end, tab strip under it with the active tab lit and raised, body with small-caps gold group headings and label-left/control-right rows whose controls line up as a COLUMN, footer with the buttons. Two tabs this increment (GRAPHICS, SOUND), not the plate's six; footer is the lit CLOSE alone, not SAVE plus CLOSE.

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/menu/OptionsPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { OptionsPanel } from "./OptionsPanel";
import { DEFAULT_SETTINGS, type Settings } from "../settings";

afterEach(cleanup);

function setup(over: Partial<Settings> = {}) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  const settings: Settings = {
    graphics: { ...DEFAULT_SETTINGS.graphics, ...(over.graphics ?? {}) },
    sound: { ...DEFAULT_SETTINGS.sound, ...(over.sound ?? {}) },
  };
  render(<OptionsPanel settings={settings} onChange={onChange} onClose={onClose} />);
  return { onChange, onClose };
}

describe("OptionsPanel", () => {
  it("opens on Graphics and offers Sound", () => {
    setup();
    expect(screen.getByRole("tab", { name: /graphics/i }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: /sound/i }).getAttribute("aria-selected")).toBe("false");
    // Increment 1 ships two tabs. An empty UI tab would be a lie.
    expect(screen.queryByRole("tab", { name: /^ui$/i })).toBeNull();
  });

  it("switches tabs", () => {
    setup();
    fireEvent.click(screen.getByRole("tab", { name: /sound/i }));
    expect(screen.getByRole("tab", { name: /sound/i }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText(/master volume/i)).toBeTruthy();
  });

  it("has no SAVE button, because it applies live", () => {
    setup();
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^close$/i })).toBeTruthy();
  });

  it("closes from CLOSE, from the X and from Escape", () => {
    const a = setup();
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(a.onClose).toHaveBeenCalledTimes(1);
    cleanup();

    const b = setup();
    fireEvent.click(screen.getByRole("button", { name: /close options/i }));
    expect(b.onClose).toHaveBeenCalledTimes(1);
    cleanup();

    const c = setup();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(c.onClose).toHaveBeenCalledTimes(1);
  });

  it("a checkbox reports the whole next settings object, not a patch", () => {
    const { onChange } = setup({ graphics: { ...DEFAULT_SETTINGS.graphics, bloom: true } });
    fireEvent.click(screen.getByRole("checkbox", { name: /bloom/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as Settings;
    expect(next.graphics.bloom).toBe(false);
    expect(next.graphics.shadows).toBe(DEFAULT_SETTINGS.graphics.shadows);
    expect(next.sound).toEqual(DEFAULT_SETTINGS.sound);
  });

  it("a checkbox shows the state it was given", () => {
    setup({ graphics: { ...DEFAULT_SETTINGS.graphics, ambientOcclusion: false } });
    const box = screen.getByRole("checkbox", { name: /ambient occlusion/i });
    expect(box.getAttribute("aria-checked")).toBe("false");
  });

  it("the shadow row offers exactly off, low and high, and marks the current one", () => {
    setup({ graphics: { ...DEFAULT_SETTINGS.graphics, shadows: "low" } });
    const group = screen.getByRole("radiogroup", { name: /shadows/i });
    const names = Array.from(group.querySelectorAll('[role="radio"]')).map((n) => n.textContent);
    expect(names).toEqual(["Off", "Low", "High"]);
    expect(screen.getByRole("radio", { name: /^low$/i }).getAttribute("aria-checked")).toBe("true");
  });

  it("the slider reports its new value", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("tab", { name: /sound/i }));
    const slider = screen.getByLabelText(/master volume/i) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "0.25" } });
    const next = onChange.mock.calls[0]![0] as Settings;
    expect(next.sound.master).toBeCloseTo(0.25);
  });

  it("says what resolution scale costs, since a soft frame reads as a bug", () => {
    setup();
    expect(screen.getByTestId("options-panel").textContent).toMatch(/sharpness/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run apps/web/src/menu/OptionsPanel.test.tsx`
Expected: FAIL, cannot resolve `./OptionsPanel`.

- [ ] **Step 4: Write the implementation**

Create `apps/web/src/menu/OptionsPanel.tsx`:

```tsx
/**
 * The Options window.
 *
 * Shaped after `reference-screenshots/options.png` (PoE 1): a carved header wing
 * with the name band on it, a strip of tabs, label-left/control-right rows whose
 * controls line up as one column, and a footer. Drawn over whatever is behind it,
 * which is the same component in the menu and in the game.
 *
 * Presentational on purpose. It takes a `Settings` and emits the next WHOLE one;
 * it never writes to storage and never imports the renderer, so it renders in
 * jsdom and the screen that mounts it owns applying and persisting.
 *
 * There is no SAVE button. A graphics knob's whole value is turning it while
 * looking at the frame it changes, and a setting you have to confirm cannot do
 * that. The plate has a SAVE, drawn dark; ours is the lit CLOSE alone.
 */
import React from "react";
import {
  Divider,
  FramedPanel,
  GOLD,
  GOLD_DIM,
  MENU_ART,
  MenuButton,
  PARCHMENT,
  SERIF,
} from "./frames";
import {
  MIN_RESOLUTION_SCALE,
  type Settings,
  type ShadowQuality,
} from "../settings";

type TabId = "graphics" | "sound";
const TABS: readonly { id: TabId; label: string }[] = [
  { id: "graphics", label: "Graphics" },
  { id: "sound", label: "Sound" },
];

export function OptionsPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: Settings;
  onChange: (next: Settings) => void;
  onClose: () => void;
}): React.ReactElement {
  const [tab, setTab] = React.useState<TabId>("graphics");

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setGraphics = (patch: Partial<Settings["graphics"]>): void =>
    onChange({ ...settings, graphics: { ...settings.graphics, ...patch } });
  const setSound = (patch: Partial<Settings["sound"]>): void =>
    onChange({ ...settings, sound: { ...settings.sound, ...patch } });

  return (
    <div
      data-testid="options-panel"
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        // Over whatever is behind it, and dark enough that the panel reads.
        background: "rgba(0,0,0,0.55)",
        zIndex: 40,
      }}
    >
      <FramedPanel style={{ width: "min(46vw, 620px)", maxHeight: "84vh", padding: "14px 20px 16px", display: "flex", flexDirection: "column" }}>
        <Header onClose={onClose} />
        <Tabs current={tab} onPick={setTab} />
        <Divider style={{ margin: "8px 0 12px" }} />

        <div style={{ overflowY: "auto", flex: 1, paddingRight: 6 }}>
          {tab === "graphics" ? (
            <>
              <Group>Detail</Group>
              <Row label="Shadows">
                <Choice<ShadowQuality>
                  label="Shadows"
                  value={settings.graphics.shadows}
                  options={[
                    { value: "off", label: "Off" },
                    { value: "low", label: "Low" },
                    { value: "high", label: "High" },
                  ]}
                  onPick={(shadows) => setGraphics({ shadows })}
                />
              </Row>
              <Row label="Ambient Occlusion">
                <Gem
                  label="Ambient Occlusion"
                  on={settings.graphics.ambientOcclusion}
                  onToggle={(ambientOcclusion) => setGraphics({ ambientOcclusion })}
                />
              </Row>
              <Row label="Bloom">
                <Gem
                  label="Bloom"
                  on={settings.graphics.bloom}
                  onToggle={(bloom) => setGraphics({ bloom })}
                />
              </Row>

              <Group>Atmosphere</Group>
              <Row label="Haze">
                <Choice<Settings["graphics"]["atmosphere"]>
                  label="Haze"
                  value={settings.graphics.atmosphere}
                  options={[
                    { value: "soft", label: "Soft" },
                    { value: "heavy", label: "Heavy" },
                  ]}
                  onPick={(atmosphere) => setGraphics({ atmosphere })}
                />
              </Row>

              <Group>Performance</Group>
              <Row label="Resolution Scale" note="Buys frames with sharpness.">
                <Slider
                  label="Resolution Scale"
                  value={settings.graphics.resolutionScale}
                  min={MIN_RESOLUTION_SCALE}
                  max={1}
                  step={0.05}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onSet={(resolutionScale) => setGraphics({ resolutionScale })}
                />
              </Row>
            </>
          ) : (
            <>
              <Group>Volume</Group>
              <Row label="Master Volume">
                <Slider
                  label="Master Volume"
                  value={settings.sound.master}
                  min={0}
                  max={1}
                  step={0.05}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onSet={(master) => setSound({ master })}
                />
              </Row>
              <Row label="Mute">
                <Gem
                  label="Mute"
                  on={settings.sound.muted}
                  onToggle={(muted) => setSound({ muted })}
                />
              </Row>
              <p style={{ fontFamily: SERIF, fontSize: 12, color: GOLD_DIM, lineHeight: 1.6, marginTop: 14 }}>
                One cue per drop is every sound the game has. Music gets its own slider when there
                is music.
              </p>
            </>
          )}
        </div>

        <Divider style={{ margin: "12px 0 10px" }} />
        <div style={{ display: "flex", justifyContent: "center" }}>
          <MenuButton height={40} style={{ minWidth: 200 }} onClick={onClose} autoFocus>
            Close
          </MenuButton>
        </div>
      </FramedPanel>
    </div>
  );
}

/** The carved band with the name on it, and the X on its right end. */
function Header({ onClose }: { onClose: () => void }): React.ReactElement {
  return (
    <div style={{ position: "relative", display: "grid", placeItems: "center", marginBottom: 8 }}>
      <div
        style={{
          fontFamily: SERIF,
          fontSize: 20,
          letterSpacing: 5,
          textTransform: "uppercase",
          color: GOLD,
          textShadow: "0 1px 2px rgba(0,0,0,0.9)",
        }}
      >
        Options
      </div>
      <button
        type="button"
        aria-label="Close options"
        onClick={onClose}
        style={{
          position: "absolute",
          right: -6,
          top: -2,
          width: 26,
          height: 26,
          borderRadius: "50%",
          border: "1px solid #6d2a1c",
          background: "radial-gradient(circle at 40% 35%, #b4402a, #5d1c12)",
          color: "#f0d3c6",
          fontFamily: SERIF,
          fontSize: 14,
          lineHeight: 1,
          cursor: "pointer",
        }}
      >
        X
      </button>
    </div>
  );
}

function Tabs({ current, onPick }: { current: TabId; onPick: (id: TabId) => void }): React.ReactElement {
  return (
    <div role="tablist" aria-label="Options sections" style={{ display: "flex", gap: 4 }}>
      {TABS.map((t) => {
        const on = t.id === current;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={on}
            onClick={() => onPick(t.id)}
            style={{
              appearance: "none",
              border: "none",
              padding: "8px 20px 10px",
              backgroundColor: "transparent",
              backgroundImage: `url(${MENU_ART}/tab_plate.png)`,
              backgroundSize: "100% 100%",
              backgroundRepeat: "no-repeat",
              fontFamily: SERIF,
              fontSize: 13,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: on ? "#f6e6bd" : "#9a8f7e",
              // One plate, tinted. Two renders of the same tab are never the
              // same tab, and a tab that changes shape reads as a glitch.
              filter: on ? "brightness(1.3) saturate(1.1)" : "brightness(0.62) saturate(0.7)",
              transform: on ? "none" : "translateY(2px)",
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function Group({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        fontFamily: SERIF,
        fontSize: 13,
        letterSpacing: 3,
        textTransform: "uppercase",
        color: GOLD,
        margin: "12px 0 8px",
      }}
    >
      {children}
    </div>
  );
}

/** Label left, control right. The control column is fixed so they line up. */
function Row({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 260px",
        alignItems: "center",
        gap: 12,
        minHeight: 40,
      }}
    >
      <div>
        <div style={{ fontFamily: SERIF, fontSize: 14, color: PARCHMENT }}>{label}</div>
        {note !== undefined && (
          <div style={{ fontFamily: SERIF, fontSize: 11, color: GOLD_DIM }}>{note}</div>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
        {children}
      </div>
    </div>
  );
}

/** The round gem checkbox. Two plates, swapped; the art carries the state. */
function Gem({
  label,
  on,
  onToggle,
}: {
  label: string;
  on: boolean;
  onToggle: (next: boolean) => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      onClick={() => onToggle(!on)}
      style={{
        appearance: "none",
        border: "none",
        padding: 0,
        width: 28,
        height: 28,
        backgroundColor: "transparent",
        backgroundImage: `url(${MENU_ART}/${on ? "gem_check_on" : "gem_check_off"}.png)`,
        backgroundSize: "100% 100%",
        backgroundRepeat: "no-repeat",
        cursor: "pointer",
      }}
    />
  );
}

/** A short row of exclusive stone tabs, for a setting with three states. */
function Choice<T extends string>({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onPick: (next: T) => void;
}): React.ReactElement {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: "flex", gap: 4 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            type="button"
            aria-checked={on}
            onClick={() => onPick(o.value)}
            style={{
              appearance: "none",
              padding: "5px 12px",
              border: `1px solid ${on ? GOLD : "#3a352c"}`,
              background: on ? "rgba(200,164,77,0.16)" : "rgba(0,0,0,0.45)",
              fontFamily: SERIF,
              fontSize: 12,
              letterSpacing: 1.4,
              color: on ? "#f6e6bd" : "#9a8f7e",
              cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The painted track with a real range input laid invisibly over it.
 *
 * The native input is what carries the drag: pointer capture, keyboard, and the
 * accessible name all come free, and the game's own pointer handlers cannot eat
 * a drag that never leaves the input. The art is the background under it.
 */
function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onSet,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onSet: (next: number) => void;
}): React.ReactElement {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
      <div
        style={{
          position: "relative",
          flex: 1,
          height: 22,
          backgroundImage: `url(${MENU_ART}/slider_track.png)`,
          backgroundSize: "100% 100%",
          backgroundRepeat: "no-repeat",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `calc(${pct}% - 7px)`,
            width: 14,
            backgroundImage: `url(${MENU_ART}/slider_handle.png)`,
            backgroundSize: "100% 100%",
            backgroundRepeat: "no-repeat",
            pointerEvents: "none",
          }}
        />
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onSet(Number(e.target.value))}
          style={{ position: "absolute", inset: 0, width: "100%", opacity: 0, cursor: "pointer", margin: 0 }}
        />
      </div>
      <span style={{ fontFamily: SERIF, fontSize: 12, color: GOLD_DIM, width: 44, textAlign: "right" }}>
        {format(value)}
      </span>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run apps/web/src/menu/OptionsPanel.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/menu/OptionsPanel.tsx apps/web/src/menu/OptionsPanel.test.tsx
git commit -m "feat(menu): a window with tabs, and rows whose controls line up"
```

---

### Task 8: Both entry points, and settings that actually reach the renderer

**Files:**
- Modify: `apps/web/src/App.tsx` (the `info` route at `:71-79`, the boot read at `:46-54`, the `GameView` mount at `:68`)
- Modify: `apps/web/src/GameView.tsx` (props, the scene/engine refs in the mount effect near `:95-96`, the Escape menu at `:291`, `GameMenu` at `:308`)
- Modify: `apps/web/src/menu/InfoScreen.tsx` (drop `OPTIONS_TEXT`)
- Test: `apps/web/src/menu/OptionsPanel.test.tsx` (append the wiring tests)

**Interfaces:**
- Consumes: `OptionsPanel` (Task 7); `settingsOf`, `saveSettingsSoon` (Task 4); `applyGraphics` (Task 5); `setSoundLevel` (Task 6).
- Produces: `GameView` gains two props, `settings: Settings` and `onSettingsChange: (next: Settings) => void`.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/menu/OptionsPanel.test.tsx`:

```tsx
describe("the Options route", () => {
  it("the main menu opens the panel, not the old prose screen", async () => {
    const { App } = await import("../App");
    const { setKv } = await import("../save/roster");
    const { MemoryKv } = await import("@exiled/persistence");
    setKv(new MemoryKv());
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /options/i }));
    expect(screen.getByTestId("options-panel")).toBeTruthy();
    expect(screen.queryByText(/there is nothing to set yet/i)).toBeNull();
    setKv(null);
  });
});
```

Note the dynamic imports: `App` pulls in `GameView`'s module graph, and importing it at the top of this file would drag Babylon into every test in it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/menu/OptionsPanel.test.tsx`
Expected: FAIL, `Unable to find an element by: [data-testid="options-panel"]` (the prose screen renders instead).

- [ ] **Step 3: Wire the main menu**

In `apps/web/src/App.tsx`:

Replace the `InfoScreen` import line with:
```ts
import { InfoScreen, CREDITS_TEXT } from "./menu/InfoScreen";
import { OptionsPanel } from "./menu/OptionsPanel";
import { DEFAULT_SETTINGS, type Settings } from "./settings";
import { setSoundLevel } from "./audio/drop-sound";
```
and extend the `./save/roster` import with `saveSettingsSoon` and `settingsOf`.

Change the `Screen` union's info arm and add an options overlay flag:
```ts
  | { kind: "info"; which: "credits" }
```

Add state beside the others:
```ts
  const [settings, setSettings] = React.useState<Settings>(DEFAULT_SETTINGS);
  const [optionsOpen, setOptionsOpen] = React.useState(false);
```

In the boot effect, read settings from the same roster:
```ts
    void readRoster().then((r) => {
      if (!live) return;
      setRoster(r);
      setSettings(settingsOf(r));
      setSelectedId(r.lastPlayedId ?? r.characters[0]?.id ?? null);
    });
```

Add the one place that both applies and persists:
```ts
  /**
   * Applies live and writes debounced. Sound is module state on the audio
   * module, so setting it here covers the menu and the game at once; graphics
   * need a scene and are applied by whoever owns one.
   */
  const changeSettings = React.useCallback(
    (next: Settings) => {
      setSettings(next);
      setSoundLevel(next.sound.master, next.sound.muted);
      saveSettingsSoon(roster, next);
    },
    [roster],
  );

  // The saved volume has to reach the audio module even if he never opens Options.
  React.useEffect(() => {
    setSoundLevel(settings.sound.master, settings.sound.muted);
  }, [settings.sound.master, settings.sound.muted]);
```

Replace the info route with a credits-only route:
```ts
  if (screen.kind === "info") {
    return (
      <InfoScreen title="Credits" body={CREDITS_TEXT} onBack={() => setScreen({ kind: "menu" })} />
    );
  }
```

Point the game mount at the settings:
```tsx
    return (
      <GameView
        characterId={screen.characterId}
        settings={settings}
        onSettingsChange={changeSettings}
        onExit={() => setScreen({ kind: "select" })}
      />
    );
```

Change the menu's Options button and render the panel over the menu:
```tsx
        onOptions={() => setOptionsOpen(true)}
```
and inside the final fragment, after the `ModeDialog` block:
```tsx
      {optionsOpen && (
        <OptionsPanel
          settings={settings}
          onChange={changeSettings}
          onClose={() => setOptionsOpen(false)}
        />
      )}
```

In `apps/web/src/menu/InfoScreen.tsx`, delete the `OPTIONS_TEXT` export (lines 20-24) and trim the file's doc comment so it describes Credits alone. Check nothing else imports it: `grep -rn "OPTIONS_TEXT" apps/web/src` must come back empty.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run apps/web/src/menu/OptionsPanel.test.tsx`
Expected: PASS, 10 tests.

- [ ] **Step 5: Wire the in-game Escape menu**

In `apps/web/src/GameView.tsx`:

Add to the imports:
```ts
import { applyGraphics, createScene } from "./render/engine";
import { OptionsPanel } from "./menu/OptionsPanel";
import type { Settings } from "./settings";
```
(the `createScene` import at `:3` becomes the combined line above).

Widen the component's props to include `settings: Settings` and `onSettingsChange: (next: Settings) => void`.

Add state and refs beside `gameMenuOpen`:
```ts
  const [optionsOpen, setOptionsOpen] = useState(false);
  // The Options panel applies graphics to the LIVE scene, and the scene is built
  // inside the mount effect where nothing else can reach it.
  const sceneRef = useRef<Scene | null>(null);
  const engineRef = useRef<Engine | null>(null);
```

In the mount effect, right after `const { scene, camera, detachZoom } = createScene(engine);`:
```ts
    sceneRef.current = scene;
    engineRef.current = engine;
```
and in the cleanup, before `engine.dispose()`:
```ts
      sceneRef.current = null;
      engineRef.current = null;
```

Add the apply effect AFTER the mount effect, so the refs are set by the time it runs:
```ts
  // Graphics apply to the scene the mount effect built. Ordered after it on
  // purpose: effects run in declaration order, so the refs are already set on
  // the first pass, and this is also what applies the SAVED settings at boot.
  useEffect(() => {
    const scene = sceneRef.current;
    if (scene === null) return;
    applyGraphics(scene, engineRef.current, settings.graphics);
  }, [settings.graphics]);
```

Include the panel in the overlay bookkeeping so Escape behaves. `overlayOpenRef.current` at `:55` gains `|| optionsOpen`, which means the first Escape closes Options and the second raises the game menu, matching how every other overlay behaves.

Render it above the game menu:
```tsx
      {optionsOpen && (
        <OptionsPanel
          settings={settings}
          onChange={onSettingsChange}
          onClose={() => setOptionsOpen(false)}
        />
      )}
```

Give `GameMenu` the button. Change its signature to
`{ onResume, onOptions, onExit }: { onResume: () => void; onOptions: () => void; onExit?: () => void }`,
add a `<MenuButton>`-styled Options entry between Resume and Exit matching the buttons already there, and at the call site (`:291`):
```tsx
        <GameMenu
          onResume={() => setGameMenuOpen(false)}
          onOptions={() => { setGameMenuOpen(false); setOptionsOpen(true); }}
```
Closing the game menu first is the existing rule in this file: overlays do not stack, they take turns.

- [ ] **Step 6: Verify the whole suite, the types and the bundle**

Run: `npx vitest run`
Expected: PASS, at least 1185 + the new tests, 0 failures.

Run: `npm run typecheck`
Expected: rc=0.

Run: `npm run build -w apps/web`
Expected: rc=0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/GameView.tsx apps/web/src/menu/InfoScreen.tsx apps/web/src/menu/OptionsPanel.test.tsx
git commit -m "feat(options): the same window from the menu and from the game"
```

---

### Task 9: See it, in the running game

Tests prove the wiring. They cannot prove the panel looks like the plate, and layout is exactly what a screenshot is for.

**Files:**
- Create: `review/options-graphics.jpeg`, `review/options-sound.jpeg`, `review/options-in-game.jpeg`

- [ ] **Step 1: Run the dev server**

Run: `npm run dev -w apps/web`
Note the port. An older instance may still hold 5173; use whatever this one prints or stale code is served.

- [ ] **Step 2: Capture the three frames**

Drive the browser yourself; do not ask for the screen to be posed. The panel holds still, so a plain full-page capture is fine (the scripted `scene.render()` plus `drawImage` dance is only needed for transient FX). Capture: the Graphics tab from the main menu, the Sound tab, and the panel open over a live hideout from the Escape menu.

Stage all three in `review/` under plain names.

- [ ] **Step 3: Compare against the plate, and fix what is off**

Open `reference-screenshots/options.png` beside them. Check, in this order: the name band centred on the header, the X on the right end, the active tab lit and raised against the dark inactive one, the control column lining up down the rows, and the footer button reading as the lit CLOSE. Fix and re-capture rather than shipping close-enough.

- [ ] **Step 4: Get sign-off before anything enters devlog/**

Ask for sign-off on the three `review/` frames. Only after that do they become
`devlog/screenshots/2026-07-29-options-panel.jpeg` (JPEG q75-80) with a one-line caption under the date in `devlog/README.md`.

- [ ] **Step 5: Commit the devlog entry (only once signed off)**

```bash
git add devlog/screenshots/2026-07-29-options-panel.jpeg devlog/README.md
git commit -m "docs(devlog): the options window, open over the hideout"
```

---

## Self-Review

**Spec coverage.** Panel shell, tab strip and both entry points: Tasks 7 and 8. Graphics tab, all five rows: Tasks 5 and 7. Sound tab: Tasks 6 and 7. Control art: Task 1. `settings.ts` pure leaf with `sanitize`: Task 2. Optional roster field with no version bump: Task 3. Live apply plus debounced write: Tasks 4, 5 and 8. Every spec §8 test appears: sanitize table (Task 2), roster round-trip with and without settings (Task 3), `applyGraphics` under NullEngine and on a populated scene (Task 5), the debounce writing once with the last value (Task 4). The UI tab and damage numbers are increments 2 and 3 and are deliberately absent, including from the tab strip.

**Types.** `Settings`, `GraphicsSettings`, `SoundSettings`, `ShadowQuality`, `AtmosphereName`, `DEFAULT_SETTINGS`, `MIN_RESOLUTION_SCALE` are defined once in Task 2 and used under those exact names in Tasks 4, 5, 7 and 8. `applyGraphics(scene, engine, g)`, `setSoundLevel(volume, muted)`, `soundLevel()`, `settingsOf(roster)`, `saveSettingsSoon(roster, settings)`, `flushSettingsSave()`, `putSettings(roster, settings)` keep their signatures across every task that names them.

**Known risk carried forward.** `MemoryKv.writes` (Task 4) may not exist; the step says to add it. `getLightByName` returning a type without `shadowEnabled` (Task 5) has a stated fallback. Both are the only two places the plan expects to meet the codebase and possibly lose.
