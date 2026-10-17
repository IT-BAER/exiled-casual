// @vitest-environment node
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MAP_BASES } from "@exiled/content-runtime";
import { PATCHES } from "./ground-patch";
import { tilesetDir } from "./level";

describe("ground patches", () => {
  const publicDir = fileURLToPath(new URL("../../public", import.meta.url));

  it("every patch spec names a tileset that exists and a plate on disk", () => {
    const tilesets = new Set(Object.values(MAP_BASES).map((b) => b.tilesetId));
    for (const [id, spec] of Object.entries(PATCHES)) {
      expect(tilesets.has(id), id).toBe(true);
      expect(existsSync(`${publicDir}${tilesetDir(id)}/${spec.file}`), id).toBe(true);
    }
  });

  it("leaves the desert and the coast on their own plates", () => {
    expect(PATCHES["tileset.desert"]).toBeUndefined();
    expect(PATCHES["tileset.coast"]).toBeUndefined();
  });
});
