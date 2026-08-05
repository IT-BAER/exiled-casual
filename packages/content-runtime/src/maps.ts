// Map bases and biomes: what a place is made of.
//
// The Atlas node brings the name, the position and the lore; the Waystone
// brings the tier; this brings the look and the shape. `@exiled/rules` is a
// pure leaf and may only hold the base IDS — `content.test.ts` fails if its
// list and these definitions ever disagree.
import type { Biome, BiomeId, MapBase } from "@exiled/content-schema";

export const BIOMES: Record<BiomeId, Biome> = {
  vaal_stone: {
    id: "vaal_stone",
    name: "Vaal Stone",
    // Cold green-grey: cut stone under a sky that has not been seen in centuries.
    tint: [0.62, 0.70, 0.68],
  },
  desert: {
    id: "desert",
    name: "Desert",
    // Bleached warm: the light is the enemy here, not the dark.
    tint: [1.00, 0.90, 0.72],
  },
  swamp: {
    id: "swamp",
    name: "Swamp",
    // Sunk green, low and heavy.
    tint: [0.55, 0.68, 0.52],
  },
  forest: {
    id: "forest",
    name: "Forest",
    // Filtered through a canopy: dim, cool, a little blue.
    tint: [0.66, 0.74, 0.62],
  },
  coast: {
    id: "coast",
    name: "Coast",
    // Open sky off open water: the one biome with nothing overhead, so it keeps
    // more of the light than any of them.
    //
    // WARM, not cold. This was [0.82,0.88,0.94] on the reasoning that light off
    // the sea comes back blue, and the reference says otherwise:
    // `reference-screenshots/beach-map.jpg` is a warm midday beach throughout —
    // its dry sand measures RGB 217/180/120 — and under a cool tint ours read as
    // bone. The sand's own gold now lives in the plate (FLOOR_GRADE in
    // tools/build_tileset_textures.py, which is the only place it can live
    // without turning the character orange too); this is the daylight over it.
    // Written with the largest channel at 1: `applyBiomeTint` divides by the
    // mean anyway, so only the RATIO is load-bearing, and every other biome is
    // authored inside 0..1.
    tint: [1.0, 0.95, 0.88],
    // The only biome where the void outside the rim is a thing and not an edge.
    sea: true,
    // Open sky, midday, off water that throws half of it back up. Every other
    // biome is underground or under a canopy; this one is the reference's beach,
    // where the sand is the brightest thing on the screen by a wide margin.
    light: 2.4,
  },
};

/**
 * One base per biome. Two Atlas nodes sharing a base are still two different
 * places — the map seed is per node and per Waystone — they are just built from
 * the same stone and the same layout grammar.
 *
 * Grammar per the design: the city takes the loop, the dry and wooded wilds
 * take the open field, and the swamp breaks a denser ruin loop across open fen.
 */
export const MAP_BASES: Record<string, MapBase> = {
  "map.vaal_stone": {
    id: "map.vaal_stone",
    biomeId: "vaal_stone",
    tilesetId: "tileset.vaal_stone",
    layoutGrammarId: "loop",
  },
  "map.desert": {
    id: "map.desert",
    biomeId: "desert",
    tilesetId: "tileset.desert",
    layoutGrammarId: "open-field",
  },
  "map.swamp": {
    id: "map.swamp",
    biomeId: "swamp",
    tilesetId: "tileset.swamp",
    layoutGrammarId: "sunken-ruins",
  },
  "map.forest": {
    id: "map.forest",
    biomeId: "forest",
    tilesetId: "tileset.forest",
    layoutGrammarId: "open-field",
  },
  "map.coast": {
    id: "map.coast",
    biomeId: "coast",
    tilesetId: "tileset.coast",
    layoutGrammarId: "coast",
  },
};

/** The base for an id. Unknown ids fall back rather than throwing mid-run. */
export function mapBase(id: string): MapBase {
  return MAP_BASES[id] ?? MAP_BASES["map.vaal_stone"]!;
}

export function biomeOf(mapBaseId: string): Biome {
  return BIOMES[mapBase(mapBaseId).biomeId];
}
