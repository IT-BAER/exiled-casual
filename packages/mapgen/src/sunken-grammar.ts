// The swamp's hybrid layout: authored ruin rooms and hidden strongrooms sit
// inside a broad, irregular fen. It deliberately reuses the proven loop chunk
// vocabulary, while a denser skeleton and organic rim make traversal different
// from both the enclosed city loop and the unobstructed field.
import { LOOP_GRAMMAR, type Grammar } from "./loop-grammar";

export const SUNKEN_GRAMMAR: Grammar = {
  id: "sunken-ruins",
  chunks: LOOP_GRAMMAR.chunks,
  bossChunk: LOOP_GRAMMAR.bossChunk,
  branchCount: 8,
  spawnTarget: 15,
  organicRim: true,
};
