import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { WORLD_ART } from "./world-art";

const PUBLIC = resolve(__dirname, "../../public");

/**
 * The directories under `public/textures` whose whole contents belong in the
 * preload, and the ones that belong to somebody else. See `world-art.ts` for why
 * each exclusion is an exclusion; this is the machine-checkable half of it.
 */
const COVERED = ["buffs", "fx", "gear", "items", "skills", "walls", "water", "world"];

function filesUnder(dir: string): string[] {
  const root = resolve(PUBLIC, "textures", dir);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((e) => statSync(resolve(root, e)).isFile())
    .map((e) => `/textures/${dir}/${e}`);
}

describe("WORLD_ART", () => {
  it("names files that exist", () => {
    for (const url of WORLD_ART) {
      expect(existsSync(resolve(PUBLIC, url.slice(1))), url).toBe(true);
    }
  });

  it("lists everything in the covered directories", () => {
    const missing = COVERED.flatMap(filesUnder).filter((f) => !WORLD_ART.includes(f));
    expect(missing, "add these to WORLD_ART (or exclude the directory on purpose)").toEqual([]);
  });

  it("lists nothing twice", () => {
    expect(new Set(WORLD_ART).size).toBe(WORLD_ART.length);
  });
});
