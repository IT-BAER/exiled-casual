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
const COVERED = ["buffs", "fx", "items", "skills", "walls", "water", "world"];

/**
 * Icons whose master is drawn but whose item base does not exist yet. They are
 * not preloaded: a map loads art it may need mid-run, and no drop can hand the
 * player one of these. They come off this list the moment a base claims one.
 */
const UNCLAIMED = new Set([
  "/textures/items/ashen_bracers.png",
  "/textures/items/ashen_quarterstaff.png",
  "/textures/items/ashfall_axe.png",
  "/textures/items/cindercleave_blade.png",
  "/textures/items/cinderfang_dirk.png",
  "/textures/items/emberbone_circlet.png",
  "/textures/items/emberhead_maul.png",
  "/textures/items/emberstep_shoes.png",
]);

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
    const missing = COVERED.flatMap(filesUnder)
      .filter((f) => !WORLD_ART.includes(f) && !UNCLAIMED.has(f));
    expect(missing, "add these to WORLD_ART (or exclude the directory on purpose)").toEqual([]);
  });

  it("lists nothing twice", () => {
    expect(new Set(WORLD_ART).size).toBe(WORLD_ART.length);
  });
});
