/**
 * The pointer art the player can pick. The CSS that draws it lives in
 * index.html, keyed on `<html data-cursor-style>`, so the cursor is right from
 * the first paint and covers the menus and the game alike. With no attribute the
 * page draws the plain arrow, the default.
 */
import type { CursorStyle } from "./settings";

export const CURSORS: readonly { id: CursorStyle; label: string; src: string }[] = [
  { id: "plain", label: "Plain", src: "/textures/ui/cursor_plain_64.png" },
  { id: "gilt", label: "Gilt Blade", src: "/textures/ui/cursor_64.png" },
];

export function applyCursor(style: CursorStyle): void {
  document.documentElement.dataset["cursorStyle"] = style;
}
