import { Matrix, Quaternion } from "@babylonjs/core";

/** The small surface the carry-pose policy needs from a Babylon bone node. */
export interface ShieldCarryNode {
  rotationQuaternion: Quaternion | null;
}

/** One left-arm joint and the local rotation that puts it in the shield hold. */
export interface ShieldCarryJoint {
  node: ShieldCarryNode;
  hold: Quaternion;
}

const SHIELD_LOOKS = new Set(["shield", "buckler", "tower"]);

/**
 * Local shoulder rotation that preserves an authored carry orientation while
 * the shoulder's torso parent follows a different animation.
 *
 * Babylon composes node matrices local-first (`local * parent`), hence the
 * desired local transform is `hold * inverse(current parent)`.
 */
export function shieldCarryRootRotation(
  holdFromRig: Matrix,
  parentFromRig: Matrix,
  result = new Quaternion(),
  inverseParent = new Matrix(),
  local = new Matrix(),
): Quaternion {
  parentFromRig.invertToRef(inverseParent);
  holdFromRig.multiplyToRef(inverseParent, local);
  local.decompose(undefined, result, undefined);
  return result.normalize();
}

/**
 * Restore the left arm's shield hold after the active locomotion clip runs.
 *
 * The shield remains rigidly attached to the hand. What changes is the arm:
 * running may move the body and legs, but it must not roll a tower shield flat
 * or swing the gripping hand away from its handle.
 */
export function applyShieldCarry(
  weapon2: string | null,
  joints: readonly ShieldCarryJoint[],
): boolean {
  const look = weapon2?.split("#")[0] ?? null;
  if (look === null || !SHIELD_LOOKS.has(look)) return false;
  for (const { node, hold } of joints) {
    (node.rotationQuaternion ??= new Quaternion()).copyFrom(hold);
  }
  return true;
}
