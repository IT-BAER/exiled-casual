/**
 * Every plate an in-game panel is painted with, fetched before it is opened.
 *
 * All of it is CSS `background-image` or `border-image`, which means the browser
 * does not ask for a file until the element that wants it first exists. So the
 * first Escape of a session drew a frameless panel with unpainted buttons for as
 * long as ~465 KB took to arrive, and the first inventory did the same for another
 * 700 KB. It looked like a bug because it is one: the plate is not late, the
 * request is.
 *
 * Warming them costs one round of requests at a moment when the player is looking
 * at a loading screen, and nothing after that — the second open of anything was
 * always instant, which is what says the art was never the problem.
 *
 * This file imports nothing on purpose: it is the list, and the list has to be
 * readable by a test that cannot mount a renderer.
 */

/** Prefix the menu furniture lives under. Mirrors MENU_ART in menu/frames.tsx. */
const MENU = "/textures/ui/menu";

/**
 * In load order. The Escape menu comes first because it is the one the player can
 * ask for a tenth of a second after the world appears; the panels behind it need
 * a walk to the furniture or a keypress first.
 */
export const UI_ART: readonly string[] = [
  // The Escape menu, and every framed panel after it.
  `${MENU}/panel_frame.png`,
  `${MENU}/button_plate.png`,
  `${MENU}/divider.png`,
  // Options, one keypress further in.
  `${MENU}/gem_check_on.png`,
  `${MENU}/gem_check_off.png`,
  `${MENU}/slider_track.png`,
  `${MENU}/slider_handle.png`,
  `${MENU}/tab_plate.png`,
  `${MENU}/row_plate.png`,
  // Item tooltips: the first hover paints the rarity band, so all four warm.
  `${MENU}/tooltip_header_normal.png`,
  `${MENU}/tooltip_header_magic.png`,
  `${MENU}/tooltip_header_rare.png`,
  `${MENU}/tooltip_header_unique.png`,
  // Inventory, stash, character sheet.
  "/textures/ui/char_header_v1.png",
  "/textures/ui/char_stone_v1.png",
  "/textures/ui/char_niche_v2.png",
  "/textures/ui/char_icons_v1.png",
  "/textures/ui/stash_cell_v4.png",
  // The map device's Atlas. The world plate is the largest single file in the UI.
  "/textures/ui/atlas_world_v1.jpg",
  "/textures/ui/atlas_node_header_v1.png",
  "/textures/ui/atlas_node_socket_v2.png",
  "/textures/ui/waystone_icon_v1.png",
];

/**
 * Ask for all of it, in order, and forget about it.
 *
 * `Image` and not `fetch`: it lands in the same cache the CSS will read, at the
 * priority the browser gives an image, and it needs no bookkeeping. Nothing awaits
 * the result — a plate that fails to warm still loads the old way when its panel
 * opens, so there is no failure mode worth handling.
 *
 * Safe to call more than once and safe with no DOM: the second call hits the cache,
 * and in jsdom or a worker it does nothing at all.
 */
export function preloadUiArt(): void {
  if (typeof Image === "undefined") return;
  for (const url of UI_ART) {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
  }
}
