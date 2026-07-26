/**
 * Geometry the bottom bar and the inventory panel both need.
 *
 * They meet at the bottom-right corner of the screen: the panel's foot is the
 * bar's top edge and their left edges have to fall on one line, which they do
 * not if each file keeps its own copy of the number. `BAR_H` lives in Hud.tsx
 * with the rest of the globe-relative measurements; the widths live here.
 */

/** Backpack grid cell. The drag math reads it, so it is a whole number of px. */
export const CELL = 48;

/** Padding inside the panel frame, both sides. */
export const PANEL_PAD = 20;

/**
 * Panel width, frame included: the 12-column backpack plus its padding and the
 * 1px border. The equipment paper-doll (10 units of 46px) is narrower, so the
 * grid is what sets it.
 */
export const PANEL_W = 12 * CELL + 2 * PANEL_PAD + 2;
