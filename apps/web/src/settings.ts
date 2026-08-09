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
  music: number;
  interface: number;
  skills: number;
  loot: number;
  environment: number;
  muted: boolean;
}

/** What the HUD draws. Both default on: a HUD you have to switch on is a HUD nobody finds. */
export interface UiSettings {
  minimap: boolean;
  lootLabels: boolean;
  /** The `Life 100/100` readouts over the globes. The globes say it too. */
  orbNumbers: boolean;
  /**
   * Opacity of the Tab overlay map, the big centred one meant to be left open
   * while running. Floored well above zero: a fully transparent overlay is a
   * toggle that appears to do nothing.
   */
  overlayMapOpacity: number;
  /**
   * A thin life bar over any damaged monster. Default OFF: the flash on hit is
   * the game's answer, this is the readout for players who want the number-ish
   * version. Bosses keep their own big bar either way.
   */
  monsterHealthBars: boolean;
  /**
   * Which skill sits in which numbered socket of the skill bar, in bar order.
   * `null` is an empty socket. A setting rather than sim state because it is a
   * preference about the screen, not about the character: nothing the sim owns
   * changes when a skill moves from 1 to 4.
   */
  skillBar: (string | null)[];
  /** What the non-skill keys do. See KEYBIND_ACTIONS. */
  keybinds: Keybinds;
  /**
   * Print what the sim is doing to the browser console (see debug.ts). Default
   * OFF: it is a firehose, and it is here for the session where something needs
   * a timeline rather than for every session.
   */
  debugLogging: boolean;
}

/** Total sockets: 5 numbered (keys 1-5) then L, M, R mouse. The HUD draws them
 *  as two rows and MUST slice to MOUSE_SLOT_BASE for the numbered row. */
export const SKILL_SLOT_COUNT = 8;
export const MOUSE_SLOT_BASE = 5;
/** Left click's default. A sentinel, not null: clearing L gives movement back. */
export const MOVE_SOCKET = "builtin.move";

/** Everything a key can be told to do. Escape and the skill row (1-5) stay fixed. */
export const KEYBIND_ACTIONS = [
  "moveUp", "moveDown", "moveLeft", "moveRight",
  "flaskLife", "flaskMana", "portal", "pickup",
  "overlayMap", "inventory", "character", "passives",
] as const;
export type KeybindAction = (typeof KEYBIND_ACTIONS)[number];
/** Values are lower-cased `KeyboardEvent.key`s; "" is unbound. */
export type Keybinds = Record<KeybindAction, string>;

export const DEFAULT_KEYBINDS: Keybinds = {
  moveUp: "w", moveDown: "s", moveLeft: "a", moveRight: "d",
  flaskLife: "q", flaskMana: "e", portal: "y", pickup: "g",
  overlayMap: "tab", inventory: "i", character: "c", passives: "p",
};

/** Keys no action may take: the menu key, and the skill row the HUD draws. */
const RESERVED_KEYS = new Set(["escape", "1", "2", "3", "4", "5"]);

/**
 * A saved keybind map, proven: each action a non-reserved, short, lower-cased
 * key, defaulting per entry. One key on two actions would fire both off one
 * press, so the first claimant (in KEYBIND_ACTIONS order) keeps it and the
 * later one goes unbound — the UI's own swap never produces that state, only a
 * hand-edited save does.
 */
function keybinds(raw: unknown): Keybinds {
  const src = obj(raw);
  const out = {} as Keybinds;
  const claimed = new Set<string>();
  for (const action of KEYBIND_ACTIONS) {
    const v = src[action];
    let key = typeof v === "string" && v.length > 0 && v.length <= 24
      ? v.toLowerCase() : DEFAULT_KEYBINDS[action];
    if (RESERVED_KEYS.has(key)) key = DEFAULT_KEYBINDS[action];
    if (claimed.has(key)) key = "";
    if (key !== "") claimed.add(key);
    out[action] = key;
  }
  return out;
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
    atmosphere: "heavy",
    resolutionScale: 1,
    torchWarmth: 0.55,
  },
  sound: {
    master: 0.8,
    music: 1,
    interface: 1,
    skills: 1,
    loot: 1,
    environment: 1,
    muted: false,
  },
  ui: {
    minimap: true,
    lootLabels: true,
    orbNumbers: true,
    overlayMapOpacity: 0.6,
    monsterHealthBars: false,
    skillBar: [
      "skill.ember_bolt.v1", "skill.cinder_ground.v1", "skill.blink.v1", null, null,
      MOVE_SOCKET, null, null,
    ],
    keybinds: { ...DEFAULT_KEYBINDS },
    debugLogging: false,
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
    // A save from before the mouse row is 5 long. Missing entries take the
    // default rather than null, so the left button still walks.
    if (i >= raw.length) {
      const d = fallback[i] ?? null;
      out.push(d !== null && !seen.has(d) ? (seen.add(d), d) : null);
      continue;
    }
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
      music: num(s["music"], 0, 1, d.sound.music),
      interface: num(s["interface"], 0, 1, d.sound.interface),
      skills: num(s["skills"], 0, 1, d.sound.skills),
      loot: num(s["loot"], 0, 1, d.sound.loot),
      environment: num(s["environment"], 0, 1, d.sound.environment),
      muted: bool(s["muted"], d.sound.muted),
    },
    ui: {
      minimap: bool(u["minimap"], d.ui.minimap),
      lootLabels: bool(u["lootLabels"], d.ui.lootLabels),
      orbNumbers: bool(u["orbNumbers"], d.ui.orbNumbers),
      overlayMapOpacity: num(u["overlayMapOpacity"], 0.15, 1, d.ui.overlayMapOpacity),
      monsterHealthBars: bool(u["monsterHealthBars"], d.ui.monsterHealthBars),
      skillBar: skillBar(u["skillBar"], d.ui.skillBar),
      keybinds: keybinds(u["keybinds"]),
      debugLogging: bool(u["debugLogging"], d.ui.debugLogging),
    },
  };
}
