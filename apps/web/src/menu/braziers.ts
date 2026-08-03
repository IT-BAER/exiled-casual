import type { BrazierSpot } from "./atmos";

/**
 * The two braziers painted into `menu_backdrop.jpg`, as fractions of THAT IMAGE
 * (see `BrazierSpot`). Found by thresholding the art for warm pixels rather than
 * by eye, and the reflection in the flood water had to be excluded from the
 * cluster or every flame sat half a bowl too low.
 *
 * Its own module because the teaser page (`src/soon.tsx`) burns the same two
 * bowls and must not drag the menu's buttons, audio and news in to get them.
 */
export const BRAZIERS: readonly BrazierSpot[] = [
  { x: 0.525, y: 0.819, r: 0.045, flame: 0.024, phase: 0 },
  { x: 0.750, y: 0.816, r: 0.075, flame: 0.048, phase: 2.4 },
];
