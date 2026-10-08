import { MOUSE_SLOT_BASE, MOVE_SOCKET, SKILL_ACTIONS, type ControlMode, type Keybinds } from "./settings";

/** The numbered socket (0-based) a pressed key fires, or -1. Shift and CapsLock read as the bare key. */
export function socketForKey(key: string, binds: Keybinds): number {
  const k = key.toLowerCase();
  if (k === "") return -1;
  return SKILL_ACTIONS.findIndex((action) => binds[action] === k);
}

const LEFT = MOUSE_SLOT_BASE;
const RIGHT = MOUSE_SLOT_BASE + 2;

/**
 * The bar rewritten for a control mode, PoE2's two schemes. WASD walks on the
 * keys, so Move leaves the bar and left click takes the class's default attack.
 * Mouse gives left click back to Move; whatever skill sat there goes to right
 * click, else the first free socket, else off the bar (its gem stays earned).
 */
export function barForMode(
  bar: readonly (string | null)[],
  mode: ControlMode,
  defaultAttack: string,
): (string | null)[] {
  const out = bar.map((id) => (id === MOVE_SOCKET ? null : id));
  if (mode === "wasd") {
    const at = out.indexOf(defaultAttack);
    if (at !== -1) out[at] = null;
    out[LEFT] = defaultAttack;
    return out;
  }
  const displaced = out[LEFT] ?? null;
  out[LEFT] = MOVE_SOCKET;
  if (displaced === null) return out;
  const free = out[RIGHT] === null ? RIGHT : out.findIndex((id) => id === null);
  if (free !== -1) out[free] = displaced;
  return out;
}

/**
 * The bar made legal for its mode, or the SAME bar when it already is, so a caller
 * can compare by identity and send nothing. Mouse mode needs Move on left click
 * and nowhere else. WASD needs no Move at all; a Move on left click is a bar never
 * laid out for WASD, so it gets the full layout, while a stray one elsewhere is
 * just taken off without touching the player's own left-click choice.
 */
export function enforceMode(
  bar: readonly (string | null)[],
  mode: ControlMode,
  defaultAttack: string,
): readonly (string | null)[] {
  const moves = bar.filter((id) => id === MOVE_SOCKET).length;
  if (mode === "mouse") {
    return bar[LEFT] === MOVE_SOCKET && moves === 1 ? bar : barForMode(bar, "mouse", defaultAttack);
  }
  if (moves === 0) return bar;
  if (bar[LEFT] === MOVE_SOCKET) return barForMode(bar, "wasd", defaultAttack);
  return bar.map((id) => (id === MOVE_SOCKET ? null : id));
}
