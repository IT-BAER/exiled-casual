// Map generation entry point. Pure and deterministic: the same
// (seed, contentVersion, grammar) always yields an identical AreaLayout.
//
// World coordinates are plain numbers in sim world units; the caller converts
// to fixed-point at the sim boundary. The walkable grid is integer cells.
//
// The area is assembled from authored chunks on a 7x7 tile lattice — see
// assemble-area.ts. A grammar is a chunk library plus a branch count, never a
// second code path, so a new biome layout is content and not a new generator.
import { assembleArea } from "./assemble-area";
import { LOOP_GRAMMAR, type Grammar } from "./loop-grammar";
import { FIELD_GRAMMAR } from "./field-grammar";
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

/** Which chunk library and branch count an area is built from. */
export type GrammarId = "loop" | "open-field";

export const GRAMMARS: Record<GrammarId, Grammar> = {
  loop: LOOP_GRAMMAR,
  "open-field": FIELD_GRAMMAR,
};

export function isGrammarId(v: string): v is GrammarId {
  return v === "loop" || v === "open-field";
}

export function generateArea(
  seed: number,
  contentVersion: string,
  grammarId: GrammarId = "loop",
): AreaLayout {
  return assembleArea(seed, contentVersion, GRAMMARS[grammarId]);
}
