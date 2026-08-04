// Map generation entry point. Pure and deterministic: the same
// (seed, contentVersion, grammar) always yields an identical AreaLayout.
//
// World coordinates are plain numbers in sim world units; the caller converts
// to fixed-point at the sim boundary. The walkable grid is integer cells.
//
// The area is assembled from authored chunks on a 9x9 tile lattice. See
// assemble-area.ts. A grammar is a chunk library plus a branch count, so a new
// biome layout is content and not a new generator. The single exception is
// `routeShape`: a loop and a ribbon are different shapes, not different chunks.
import { assembleArea } from "./assemble-area";
import { LOOP_GRAMMAR, type Grammar } from "./loop-grammar";
import { FIELD_GRAMMAR } from "./field-grammar";
import { SUNKEN_GRAMMAR } from "./sunken-grammar";
import { STRAND_GRAMMAR } from "./strand-grammar";
import { generateCoast } from "./coast";
import type { AreaLayout } from "./grid";

// Re-exported so existing importers of "./mapgen" keep working unchanged.
export {
  ALGORITHM_VERSION,
  CELL_SIZE,
  CORRIDOR_WIDTH_CELLS,
  MIN_ROUTE_WIDTH,
  SPAWN_TARGET,
} from "./grid";
export type { AreaLayout, WalkableGrid, Socket, ValidationCheck } from "./grid";
export { fallbackLayout, GRID_CELLS } from "./fallback";

/** Which chunk library and branch count an area is built from. `coast` is the
 *  one id that names a GENERATOR rather than a library: a beach is not a route
 *  with wall on both sides, so no chunk vocabulary can express it. */
export type GrammarId = "loop" | "open-field" | "sunken-ruins" | "strand" | "coast";
export type ChunkGrammarId = Exclude<GrammarId, "coast">;

export const GRAMMARS: Record<ChunkGrammarId, Grammar> = {
  loop: LOOP_GRAMMAR,
  "open-field": FIELD_GRAMMAR,
  "sunken-ruins": SUNKEN_GRAMMAR,
  strand: STRAND_GRAMMAR,
};

/** Spawn points a coast aims for. The strand grammar's own number: the beach is
 *  the same size and the same walk, only a better shape. */
const COAST_SPAWN_TARGET = 16;

export function isGrammarId(v: string): v is GrammarId {
  return v === "loop" || v === "open-field" || v === "sunken-ruins" ||
    v === "strand" || v === "coast";
}

export function generateArea(
  seed: number,
  contentVersion: string,
  grammarId: GrammarId = "loop",
): AreaLayout {
  if (grammarId === "coast") return generateCoast(seed, contentVersion, COAST_SPAWN_TARGET);
  return assembleArea(seed, contentVersion, GRAMMARS[grammarId]);
}
