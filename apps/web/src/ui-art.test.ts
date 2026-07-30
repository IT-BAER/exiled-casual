import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { UI_ART } from "./ui-art";

const PUBLIC = resolve(__dirname, "../public");
const SRC = resolve(__dirname);
/** Split pattern, named because a raw newline in a literal is a syntax error. */
const NEWLINE = /\r?\n/;

/** Every `/textures/...` path the client's source actually asks for. */
function referenced(): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry) || entry.includes(".test.")) continue;
      const body = readFileSync(full, "utf8");
      for (const m of body.matchAll(/["'`](\/textures\/ui\/[A-Za-z0-9_./-]+\.(?:png|jpg|jpeg|webp))["'`]/g)) {
        out.add(m[1]!);
      }
      // The menu art is written against a MENU_ART prefix rather than in full.
      for (const m of body.matchAll(/\$\{MENU_ART\}\/([A-Za-z0-9_.-]+\.(?:png|jpg))/g)) {
        out.add(`/textures/ui/menu/${m[1]!}`);
      }
      // And sometimes the basename itself is the expression: the checkbox picks
      // between two plates inline. Any quoted bare name on a MENU_ART line that
      // resolves to a real file counts as asked for.
      for (const line of body.split(NEWLINE)) {
        if (!line.includes("MENU_ART}")) continue;
        for (const m of line.matchAll(/"([A-Za-z0-9_-]+)"/g)) {
          const guess = `/textures/ui/menu/${m[1]!}.png`;
          if (existsSync(resolve(PUBLIC, guess.slice(1)))) out.add(guess);
        }
      }
    }
  };
  walk(SRC);
  return out;
}

describe("UI_ART", () => {
  it("names files that exist", () => {
    for (const url of UI_ART) {
      expect(existsSync(resolve(PUBLIC, url.slice(1))), url).toBe(true);
    }
  });

  it("has no duplicates", () => {
    expect(new Set(UI_ART).size).toBe(UI_ART.length);
  });

  /**
   * The point of the list is that nothing an in-game panel paints itself with is
   * left to be fetched when the panel opens. A plate added to a panel and not to
   * the list is exactly the stall this exists to remove, and it is invisible in
   * review — so the list is checked against what the source actually asks for.
   */
  it("covers every plate the in-game panels ask for", () => {
    const used = referenced();
    const listed = new Set(UI_ART);
    // Screens the player only ever sees BEFORE the game starts warm themselves by
    // being on screen; there is nothing to preload them ahead of.
    const menuOnly = new Set([
      "/textures/ui/menu/logo.png",
      "/textures/ui/menu/menu_backdrop.jpg",
      "/textures/ui/menu/select_backdrop.jpg",
      "/textures/ui/menu/fog_sheet.png",
      "/textures/ui/menu/portrait_ironsworn.png",
      "/textures/ui/menu/portrait_stalker.png",
      "/textures/ui/menu/portrait_emberbound.png",
      // The loading plate's vignette is an <img>, not a CSS background, so the
      // browser starts it with the plate itself. There is nothing earlier to
      // warm it at: the plate IS the wait.
      "/textures/ui/menu/loading_vignette.png",
    ]);
    const missed = [...used].filter((u) => !listed.has(u) && !menuOnly.has(u));
    expect(missed).toEqual([]);
  });

  it("lists nothing the source never asks for", () => {
    const used = referenced();
    expect(UI_ART.filter((u) => !used.has(u))).toEqual([]);
  });
});
