import type { Intent } from "@exiled/protocol";
import { fp } from "@exiled/fixed-point";

const SKILL_KEYS: Record<string, string> = {
  "1": "skill.ember_bolt.v1",
  "2": "skill.cinder_ground.v1",
  "3": "skill.blink.v1",
};

const FLASK_KEYS: Record<string, "life" | "mana"> = {
  q: "life",
  e: "mana",
};

// Rotated 45° to match the camera yaw (engine.ts, alpha=-π/4): screen-up is
// world (-1,+1), screen-right is (+1,+1). The sim already normalises a diagonal
// (player-movement.ts), so W does not outrun the old axis-aligned W.
const MOVE_KEYS: Record<string, { dx: -1 | 0 | 1; dy: -1 | 0 | 1 }> = {
  w: { dx: -1, dy: 1 },
  s: { dx: 1, dy: -1 },
  a: { dx: -1, dy: -1 },
  d: { dx: 1, dy: 1 },
};

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
export function heldToMoveIntent(held: readonly string[]): Intent {
  let dx = 0;
  let dy = 0;
  for (const k of held) {
    const m = MOVE_KEYS[k.toLowerCase()];
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
): Intent | null {
  // Lower-case so CapsLock / Shift ("W") still map to WASD movement.
  const k = key.toLowerCase();
  const move = MOVE_KEYS[k];
  if (move) return { kind: "moveDir", ...move };

  const slot = FLASK_KEYS[k];
  if (slot) return { kind: "useFlask", slot };

  const skillId = SKILL_KEYS[key];
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
