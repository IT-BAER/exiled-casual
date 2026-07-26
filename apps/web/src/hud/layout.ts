/**
 * Geometry the bottom bar and the inventory panel both need.
 *
 * They meet at the bottom-right corner of the screen: the panel's foot is the
 * bar's top edge and their left edges have to fall on one line, which they do
 * not if each file keeps its own copy of the number. `BAR_H` lives in Hud.tsx
 * with the rest of the globe-relative measurements; the widths live here.
 *
 * All of it is a fraction of the viewport width, as PoE1's own corner is. A
 * fixed-px cell held its proportion at exactly one window width: at 2048 the
 * panel — and so the bar docked to its left edge — came out 19% wider against
 * the globe than on the 2558 reference crop, which is what left bare stone
 * beside the numbered skill row. These vw figures put the panel's outer edge
 * on the reference's own: globe zone 11.41vw + panel 16.03vw = 27.44vw.
 */

/** Backpack grid cell. */
export const CELL_VW = 2.1;
export const CELL = `${CELL_VW}vw`;

/** Padding inside the panel frame, both sides. 0.97vw is the 20px it used to be. */
const PANEL_PAD_VW = 0.97;
export const PANEL_PAD = `${PANEL_PAD_VW}vw`;

/**
 * Panel width, frame included: the 12-column backpack plus its padding and the
 * 1px border on each side. The equipment paper-doll (10 units of `U`) is
 * narrower, so the grid is what sets it.
 */
const PANEL_W_VW = 12 * CELL_VW + 2 * PANEL_PAD_VW;
export const PANEL_W = `calc(${PANEL_W_VW.toFixed(2)}vw + 2px)`;
