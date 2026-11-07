import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { DEVLOG_TILES } from "./devlog.generated";
import { parseDevlog, render, TILE_COUNT } from "../../../tools/devlog_to_menu.mjs";

const README = new URL("../../../devlog/README.md", import.meta.url);
const PUBLIC = new URL("../public", import.meta.url);

/** A tile image the menu downloads up front; the lightbox's full image only loads on click. */
const TILE_BUDGET = 60 * 1024;
const FULL_BUDGET = 220 * 1024;

const td = (file: string, caption: string) =>
  `<td width="50%"><img src="screenshots/${file}" alt="alt of ${file}" width="100%"><br><sub>${caption}</sub></td>`;

describe("the menu's devlog tiles", () => {
  it("are the newest shots: the last section first, each section in reading order, GIFs skipped", () => {
    const text = [
      "# Devlog", "",
      "## 2026-07-20 · Old", "", td("2026-07-20-a.jpeg", "Old one."), "",
      "## 2026-07-21 · Middle", "", td("2026-07-21-b.png", "Middle one."), td("2026-07-21-c.gif", "Moving."), "",
      "## 2026-07-22 · New", "", td("2026-07-22-d.jpeg", "First new."), td("2026-07-22-e.jpeg", "Second new."), "",
    ].join("\n");
    expect(parseDevlog(text, 3)).toEqual([
      { file: "2026-07-22-d.jpeg", alt: "alt of 2026-07-22-d.jpeg", caption: "First new.", date: "2026-07-22" },
      { file: "2026-07-22-e.jpeg", alt: "alt of 2026-07-22-e.jpeg", caption: "Second new.", date: "2026-07-22" },
      { file: "2026-07-21-b.png", alt: "alt of 2026-07-21-b.png", caption: "Middle one.", date: "2026-07-21" },
    ]);
  });

  it("are the devlog, not a copy of it", () => {
    const shots = parseDevlog(readFileSync(README, "utf8"), TILE_COUNT);
    expect(shots).toHaveLength(3);
    expect(DEVLOG_TILES.map((t) => t.caption)).toEqual(shots.map((s) => s.caption));
    // Byte-for-byte: if this fails, run `node tools/devlog_to_menu.mjs`.
    const generated = readFileSync(new URL("./devlog.generated.ts", import.meta.url), "utf8");
    expect(generated.replace(/\r\n/g, "\n")).toBe(render(shots));
  });

  it("ship small enough for the menu's first load", () => {
    for (const t of DEVLOG_TILES) {
      for (const [src, budget] of [[t.src, TILE_BUDGET], [t.full, FULL_BUDGET]] as const) {
        const file = new URL(`.${src}`, `${PUBLIC.href}/`);
        expect(existsSync(file), src).toBe(true);
        expect(statSync(file).size, src).toBeLessThan(budget);
      }
    }
  });
});
