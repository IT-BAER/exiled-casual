/**
 * The pointer art the player can pick, at the size they pick, and PoE2's click
 * tilt. index.html draws the default (plain, medium) from the first paint;
 * `applyCursor` replaces it with one `<style>` for the chosen look and size,
 * which covers the menus and the game alike. The bitmaps come from
 * tools/build_cursors.py; every frame has its tip on the top-left corner.
 */
import type { CursorSize, CursorStyle } from "./settings";

export const CURSORS: readonly { id: CursorStyle; label: string; src: string }[] = [
  { id: "plain", label: "Plain", src: "/textures/ui/cursor_plain_64.png" },
  { id: "gilt", label: "Gilt Blade", src: "/textures/ui/cursor_64.png" },
];

/** CSS px. Never above 32: Chromium drops a larger custom cursor near native UI. */
export const CURSOR_SIZE_PX: Record<CursorSize, 20 | 24 | 28 | 32> = {
  small: 20,
  medium: 24,
  large: 28,
  huge: 32,
};

const STEM: Record<CursorStyle, string> = { plain: "cursor_plain", gilt: "cursor" };

function frames(stem: string, px: number): [string, string] {
  return [`/textures/ui/${stem}_${px}.png`, `/textures/ui/${stem}_${px * 2}.png`];
}

/** `url()` first for a browser without image-set; a declaration it cannot parse is dropped. */
function rule(selector: string, [one, two]: [string, string], hot: string, fallback: string): string {
  return (
    `${selector} { cursor: url(${one}) ${hot}, ${fallback} !important; ` +
    `cursor: image-set(url(${one}) 1x, url(${two}) 2x) ${hot}, ${fallback} !important; }`
  );
}

export function cursorCss(style: CursorStyle, size: CursorSize): string {
  const px = CURSOR_SIZE_PX[size];
  const stem = STEM[style];
  return [
    rule("*", frames(stem, px), "0 0", "default"),
    // Held: the same arrow leaning in toward its tip, which stays on the point.
    rule(":root[data-cursor-press], :root[data-cursor-press] *", frames(`${stem}_press`, px), "0 0", "default"),
    // A refusal outranks the tilt: the second selector beats the press rule's.
    rule(
      '[data-cursor="deny"], :root[data-cursor-press] [data-cursor="deny"]',
      frames(`${stem}_deny`, px),
      "0 0",
      "not-allowed",
    ),
  ].join("\n");
}

/** Held so the browser keeps them: a press frame fetched on the first click shows the OS arrow. */
const warm: HTMLImageElement[] = [];

export function applyCursor(style: CursorStyle, size: CursorSize): void {
  let el = document.getElementById("cursor-css");
  if (!el) {
    el = document.createElement("style");
    el.id = "cursor-css";
    document.head.appendChild(el);
  }
  el.textContent = cursorCss(style, size);
  if (typeof Image === "undefined") return;
  const px = CURSOR_SIZE_PX[size];
  for (const suffix of ["", "_press", "_deny"]) {
    for (const url of frames(`${STEM[style]}${suffix}`, px)) {
      const img = new Image();
      img.src = url;
      warm.push(img);
    }
  }
}

/**
 * Sets `<html data-cursor-press>` while any mouse button is held. Capture phase on
 * window, so a panel that stops propagation cannot hide a press; `buttons` on every
 * pointer event, so a release outside the window clears on the next move back in.
 */
export function trackCursorPress(): () => void {
  const root = document.documentElement;
  const set = (on: boolean) => {
    if (on === root.hasAttribute("data-cursor-press")) return;
    if (on) root.setAttribute("data-cursor-press", "");
    else root.removeAttribute("data-cursor-press");
  };
  const onPointer = (e: Event) => set((e as MouseEvent).buttons !== 0);
  const onBlur = () => set(false);
  const types = ["pointerdown", "pointerup", "pointermove", "pointercancel"] as const;
  for (const t of types) window.addEventListener(t, onPointer, true);
  window.addEventListener("blur", onBlur);
  return () => {
    for (const t of types) window.removeEventListener(t, onPointer, true);
    window.removeEventListener("blur", onBlur);
    set(false);
  };
}
