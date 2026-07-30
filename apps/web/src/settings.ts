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
  /**
   * Colour of the light the player carries, 0 is a pale cold flame and 1 is a
   * deep ember. Everyone reads "warm" differently on their own panel, so this is
   * a taste knob rather than a quality one, and it changes nothing but a colour.
   */
  torchWarmth: number;
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
  /**
   * Which skill sits in which numbered socket of the skill bar, in bar order.
   * `null` is an empty socket. A setting rather than sim state because it is a
   * preference about the screen, not about the character: nothing the sim owns
   * changes when a skill moves from 1 to 4.
   */
  skillBar: (string | null)[];
}

/** Numbered sockets on the bar. The three mouse buttons are not reorderable yet. */
export const SKILL_SLOT_COUNT = 5;

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
    torchWarmth: 0.55,
  },
  sound: { master: 0.8, muted: false },
  ui: {
    minimap: true,
    lootLabels: true,
    skillBar: ["skill.ember_bolt.v1", "skill.cinder_ground.v1", "skill.blink.v1", null, null],
  },
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

/**
 * A saved skill bar, proven rather than trusted: exactly SKILL_SLOT_COUNT entries,
 * each a string or null, and no skill in two sockets at once. A bar written by a
 * build that shipped a different skill list still parses — a skill that no longer
 * exists simply draws as an empty socket and fires nothing.
 */
function skillBar(raw: unknown, fallback: (string | null)[]): (string | null)[] {
  if (!Array.isArray(raw)) return [...fallback];
  const seen = new Set<string>();
  const out: (string | null)[] = [];
  for (let i = 0; i < SKILL_SLOT_COUNT; i++) {
    const v = raw[i];
    if (typeof v === "string" && v.length > 0 && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    } else {
      out.push(null);
    }
  }
  return out;
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
      torchWarmth: num(g["torchWarmth"], 0, 1, d.graphics.torchWarmth),
    },
    sound: {
      master: num(s["master"], 0, 1, d.sound.master),
      muted: bool(s["muted"], d.sound.muted),
    },
    ui: {
      minimap: bool(u["minimap"], d.ui.minimap),
      lootLabels: bool(u["lootLabels"], d.ui.lootLabels),
      skillBar: skillBar(u["skillBar"], d.ui.skillBar),
    },
  };
}
