// The strand: open sand between the sea and the treeline, from PoE 1's Strand
// and Beach. Both are described the same way by the wiki, and it is the one
// thing they have that neither of our layouts had: "the layout is fairly
// linear, following the shoreline will lead to the Boss Arena", "a single
// broad corridor, toward the end of which the boss arena can be found".
//
// So this is the field's chunk vocabulary (open ground with rock and scrub
// blobs, which is what a beach is) drawn on a ribbon instead of a loop. The
// eight spurs are what make the corridor BROAD rather than a lane: hung off a
// walk instead of a ring they widen it irregularly, which is a cove or a dune
// pocket rather than a dead end you notice as one.
import { FIELD_GRAMMAR } from "./field-grammar";
import type { Grammar } from "./loop-grammar";

export const STRAND_GRAMMAR: Grammar = {
  id: "strand",
  chunks: FIELD_GRAMMAR.chunks,
  bossChunk: FIELD_GRAMMAR.bossChunk,
  // Past eight, spur candidates run out against the ribbon's own body often
  // enough to matter: 0.8% of seeds fall back at eight, 5.4% at eleven.
  branchCount: 8,
  spawnTarget: 16,
  organicRim: true,
  routeShape: "ribbon",
};
