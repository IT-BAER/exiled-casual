/**
 * What a class looks like on the rig.
 *
 * Its own module, and not part of `MenuStage`, so the answer can be checked
 * without a canvas. Every class shares the one wired body, so the answer is a
 * constant; the function stays so a class that ever earns its own silhouette
 * has one place to change.
 */
import { BASE_LOOKS, type Looks } from "../render/rig";

/** The look every class shows: there is no per-class wardrobe any more. */
export function looksForClass(_classId: string): Looks {
  return BASE_LOOKS;
}
