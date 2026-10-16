import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const PUBLIC = resolve(__dirname, "../public");
const ROOTS = [resolve(__dirname), resolve(__dirname, "../../../packages")];

/**
 * Every quoted image path the shipped source names in full, with where it was found.
 * A renamed file 404s silently in the browser; this is the place it fails loudly.
 * Template paths (`${theme}.png`) are not matched and need their own test.
 */
function literals(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist") continue;
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry) || entry.includes(".test.")) continue;
      const body = readFileSync(full, "utf8");
      for (const m of body.matchAll(/["'`(](\/(?:hud|textures)\/[A-Za-z0-9_./-]+\.(?:png|jpg|jpeg|webp))["'`)]/g)) {
        if (!out.has(m[1]!)) out.set(m[1]!, full);
      }
    }
  };
  ROOTS.forEach(walk);
  return out;
}

describe("image paths in source", () => {
  it("finds the paths it is meant to guard", () => {
    expect(literals().size).toBeGreaterThan(50);
  });

  it("names only files that exist under public/", () => {
    const missing = [...literals()].filter(([url]) => !existsSync(resolve(PUBLIC, url.slice(1))));
    expect(missing).toEqual([]);
  });
});
