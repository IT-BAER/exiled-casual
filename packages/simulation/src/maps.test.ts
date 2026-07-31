import { describe, it, expect } from "vitest";
import { BIOME_IDS, LAYOUT_GRAMMAR_IDS } from "@exiled/content-schema";
import { BIOMES, MAP_BASES, mapBase, biomeOf } from "@exiled/content-runtime";
import { GRAMMARS } from "@exiled/mapgen";
import {
  ATLAS_NODE_COUNT,
  MAP_BASE_IDS,
  atlasGraph,
  mapBaseIdForIndex,
  mapBaseIdForNode,
} from "@exiled/rules";

/**
 * `@exiled/rules` is a pure leaf, so it holds only the map base IDS while
 * `@exiled/content-runtime` holds their definitions, and neither may import the
 * other. This file is where the two halves are checked against each other — the
 * same arrangement as `GEAR_TEXTURE` in the renderer.
 */
describe("map bases", () => {
  it("rules' id list and content-runtime's definitions are the same set", () => {
    expect([...MAP_BASE_IDS].sort()).toEqual(Object.keys(MAP_BASES).sort());
  });

  it("every definition's id matches the key it is filed under", () => {
    for (const [key, base] of Object.entries(MAP_BASES)) expect(base.id).toBe(key);
  });

  it("every base names a real biome and a real layout grammar", () => {
    for (const base of Object.values(MAP_BASES)) {
      expect(BIOME_IDS, `${base.id} biome`).toContain(base.biomeId);
      expect(LAYOUT_GRAMMAR_IDS, `${base.id} grammar`).toContain(base.layoutGrammarId);
      // The grammar id has to be one mapgen can actually build.
      expect(Object.keys(GRAMMARS), `${base.id} grammar`).toContain(base.layoutGrammarId);
    }
  });

  it("every biome is described, and every described biome is used", () => {
    expect(Object.keys(BIOMES).sort()).toEqual([...BIOME_IDS].sort());
    const used = new Set(Object.values(MAP_BASES).map((b) => b.biomeId));
    expect([...used].sort()).toEqual([...BIOME_IDS].sort());
  });

  it("gives every Atlas node a base that exists", () => {
    for (const node of atlasGraph(7)) {
      const id = mapBaseIdForNode(node.id);
      expect(MAP_BASE_IDS, `${node.name}`).toContain(id);
      expect(mapBase(id).id).toBe(id);
    }
  });

  it("spreads the biomes across the Atlas rather than favouring one", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < ATLAS_NODE_COUNT; i++) {
      const b = mapBase(mapBaseIdForIndex(i)).biomeId;
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([...BIOME_IDS].sort());
    // 12 nodes over 4 biomes: an even three each, so no biome is a novelty.
    for (const [biome, n] of counts) expect(n, `${biome} nodes`).toBe(3);
  });

  it("resolves an unknown node to a real base rather than throwing mid-run", () => {
    expect(MAP_BASE_IDS).toContain(mapBaseIdForNode("node.does_not_exist"));
    expect(biomeOf("map.not_a_base").id).toBeTruthy();
  });

  it("at least three distinct layout profiles are reachable from the Atlas", () => {
    const grammars = new Set(
      Array.from({ length: ATLAS_NODE_COUNT }, (_, i) =>
        mapBase(mapBaseIdForIndex(i)).layoutGrammarId),
    );
    expect(grammars.size).toBeGreaterThanOrEqual(3);
  });
});
