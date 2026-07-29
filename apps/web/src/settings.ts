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

/** What the HUD draws. Both default on: a HUD you have to switch on is a HUD nobody finds. */
export interface UiSettings {
  minimap: boolean;
  lootLabels: boolean;
}

export interface Settings {
  graphics: GraphicsSettings;
  sound: SoundSettings;
  ui: UiSettings;
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
  ui: { minimap: true, lootLabels: true },
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
  const u = obj(root["ui"]);
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
    ui: {
      minimap: bool(u["minimap"], d.ui.minimap),
      lootLabels: bool(u["lootLabels"], d.ui.lootLabels),
    },
  };
}
