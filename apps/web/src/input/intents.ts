import type { Intent } from "@exiled/protocol";
import { fp } from "@exiled/fixed-point";
import { DEFAULT_KEYBINDS, type KeybindAction, type Keybinds } from "../settings";

// Rotated 45° to match the camera yaw (engine.ts, alpha=-π/4): screen-up is
// world (-1,+1), screen-right is (+1,+1). The sim already normalises a diagonal
// (player-movement.ts), so W does not outrun the old axis-aligned W.
const MOVE_DIRS: Partial<Record<KeybindAction, { dx: -1 | 0 | 1; dy: -1 | 0 | 1 }>> = {
  moveUp: { dx: -1, dy: 1 },
  moveDown: { dx: 1, dy: -1 },
  moveLeft: { dx: -1, dy: -1 },
  moveRight: { dx: 1, dy: 1 },
};

/** The action a pressed key is bound to, or null. "" never matches: unbound. */
function actionFor(key: string, binds: Keybinds): KeybindAction | null {
  if (key === "") return null;
  for (const action of Object.keys(binds) as KeybindAction[]) {
    if (binds[action] === key) return action;
  }
  return null;
}

/**
 * Pure: every movement key currently held, as one direction.
 *
 * Summed, not last-one-wins. Each key is a world diagonal (the camera is yawed
 * 45 degrees), so W+D sums to world +y, which is the screen diagonal between
 * them — the whole reason two keys are held. Opposing pairs cancel to a stop
 * instead of leaving the player walking on whichever key was pressed last.
 *
 * The sum is reduced to its signs because that is what the sim's moveDir takes;
 * it normalises the length itself, so W+A+D is exactly as fast as W.
 */
export function heldToMoveIntent(held: readonly string[], binds: Keybinds = DEFAULT_KEYBINDS): Intent {
  let dx = 0;
  let dy = 0;
  for (const k of held) {
    const action = actionFor(k.toLowerCase(), binds);
    const m = action && MOVE_DIRS[action];
    if (m) {
      dx += m.dx;
      dy += m.dy;
    }
  }
  if (dx === 0 && dy === 0) return { kind: "stop" };
  return { kind: "moveDir", dx: Math.sign(dx) as -1 | 0 | 1, dy: Math.sign(dy) as -1 | 0 | 1 };
}

/**
 * Pure: map a KeyboardEvent.key + current world-space aim point to an Intent.
 * Returns null for unmapped keys.
 * `aim` is in world-space floats (already converted from screen via pointerToWorld).
 */
export function keyToIntent(
  key: string,
  aim: { x: number; y: number },
  /**
   * Which skill the numbered keys fire. Passed in rather than a table in here,
   * because the bar is reorderable now (Hud.tsx) and the key row is the bar's own
   * order: a fixed 1-to-3 map would have gone on firing Ember Bolt off the socket
   * the player had just dragged it out of.
   */
  skillForKey?: (key: string) => string | null,
  binds: Keybinds = DEFAULT_KEYBINDS,
): Intent | null {
  // Lower-case so CapsLock / Shift ("W") still map to WASD movement.
  const k = key.toLowerCase();
  const action = actionFor(k, binds);
  const move = action && MOVE_DIRS[action];
  if (move) return { kind: "moveDir", ...move };

  if (action === "flaskLife") return { kind: "useFlask", slot: "life" };
  if (action === "flaskMana") return { kind: "useFlask", slot: "mana" };

  // The way home rides the Portal Scroll intent rather than a bare useSkill so
  // both entry points — this key and the right-click on the scroll itself —
  // arrive as the same command (protocol-bridge.ts turns it into the Portal
  // skill, cast time and cooldown included).
  if (action === "portal") return { kind: "usePortalScroll" };

  const skillId = skillForKey?.(key);
  if (skillId) {
    return { kind: "useSkill", skillId, tx: fp(aim.x), ty: fp(aim.y) };
  }

  return null;
}

/**
 * Pure: convert a Babylon ground-plane pick result (world x, z) to sim Fixed coords.
 * Sim y maps to Babylon z (ground plane).
 */
export function pointerToWorld(pick: {
  x: number;
  z: number;
}): { x: ReturnType<typeof fp>; y: ReturnType<typeof fp> } {
  return { x: fp(pick.x), y: fp(pick.z) };
}
