/**
 * The furniture the hideout is lived in with, and the floor it takes up.
 *
 * Content rather than art, and it lives here rather than in the renderer because
 * two of them need it: `apps/web/src/render/hideout.ts` stands the props up, and
 * `simulation/areas.ts` turns the same list into collision so the player walks
 * around a table instead of through it. A second copy on the client would drift
 * the day one of these numbers moves, and the drift would be invisible — the
 * table would simply stop being where it stops you.
 *
 * Every piece is capped near a metre. The camera sits about 49 degrees above the
 * horizon, so a prop of height h hides roughly 0.87h of world behind it, and a
 * hideout you cannot see yourself in is worse than a bare one. The tallest thing
 * here is a broken column at 1.12.
 */

/** The `props.glb` kinds the hideout dresses itself with. */
export type DecorKind = "rug" | "table" | "bench" | "crate" | "barrel" | "pillar" | "brazier";

export interface Decor {
  kind: DecorKind;
  /** World x and z. Sim (x, y) is Babylon (x, z), same as every actor. */
  x: number;
  z: number;
  /** Radians about Y. See SCREEN_SQUARE for what to measure it against. */
  yaw: number;
}

/**
 * A prop turned this far reads square to the SCREEN rather than to the world grid.
 *
 * The camera looks along the diagonal, so a table built along +X runs off toward
 * the corner of the frame. Furniture composed for a fixed camera wants its long
 * edge across that camera's view, which is this angle and not zero. It is
 * `-CAMERA_ALPHA` from render/engine.ts; hideout.test.ts pins the two together.
 */
export const SCREEN_SQUARE = Math.PI / 4;

/**
 * A placement written where the composition actually happens: on the screen.
 *
 * The camera's 45-degree lean means world coordinates say nothing about where a
 * prop lands in the frame — (-8.6, 6.2) reads as "the far corner" and is in fact
 * ten units off the top edge, which is exactly the mistake the first pass made
 * with all four columns. So these are screen units: `sx` runs right along the
 * frame, `sy` runs up it, the origin is the player's arrival point, and the visible
 * box is about 19 by 9.5. `areas.ts` turns its own literals by the same angle for
 * the same reason.
 */
function at(sx: number, sy: number): { x: number; z: number } {
  const r = Math.SQRT1_2;
  return { x: (sx - sy) * r, z: (sx + sy) * r };
}

/**
 * Where everything stands.
 *
 * Composed against what is already there, none of which moves: on screen the map
 * device sits top-centre with its portal arc across the top, the stash is
 * left-of-centre, the disenchanter mirrors it on the right, and the player arrives
 * dead centre. What is left is the whole bottom half and the two flanks, and the
 * lane from the player to the device stays clear because that is the walk every
 * session starts with.
 *
 * The corners are kept inside the frame and clear of the HUD: the bottom two are
 * behind the life and mana globes, so the columns take the top corners and the
 * mid-flanks instead.
 */
export const HIDEOUT_DECOR: readonly Decor[] = [
  // A table with a bench either side, down on the left where nothing else is.
  { kind: "table", ...at(-6.0, -1.2), yaw: SCREEN_SQUARE },
  { kind: "bench", ...at(-6.0, -2.1), yaw: SCREEN_SQUARE },
  { kind: "bench", ...at(-6.0, -0.3), yaw: SCREEN_SQUARE },
  // Under the player on arrival, so the first thing the floor does is stop being
  // flagstone. Just below him, not under his feet: a rug he is standing on is a rug
  // nobody sees.
  { kind: "rug", ...at(0, -2.1), yaw: SCREEN_SQUARE },
  // Stores on the stash side. Spread in plan and never stacked in height: two
  // crates on top of each other is the one shape here that would occlude.
  { kind: "crate", ...at(-7.1, 0.6), yaw: SCREEN_SQUARE + 0.5 },
  { kind: "crate", ...at(-7.9, -0.4), yaw: SCREEN_SQUARE - 0.3 },
  { kind: "barrel", ...at(-7.6, 1.6), yaw: 0 },
  { kind: "barrel", ...at(-8.6, 0.9), yaw: 0 },
  // And a few past the disenchanter, so the right flank is not bare stone.
  { kind: "barrel", ...at(6.4, -1.1), yaw: 0 },
  { kind: "crate", ...at(7.2, -2.0), yaw: SCREEN_SQUARE + 0.9 },
  { kind: "crate", ...at(5.9, -2.7), yaw: SCREEN_SQUARE - 0.6 },
  // Broken columns at the edges of the frame. They are the only thing here that
  // says the hideout is a ruin somebody moved into.
  { kind: "pillar", ...at(-8.8, 3.4), yaw: 0.4 },
  { kind: "pillar", ...at(8.8, 3.4), yaw: -0.9 },
  { kind: "pillar", ...at(-9.0, -1.5), yaw: 2.6 },
  { kind: "pillar", ...at(9.0, -1.5), yaw: 1.7 },
  // Fire. Two bowls out at the flanks and one down at the foot of the frame, so
  // the room is lit from its own corners instead of only from the lamp the
  // player carries — see render/lights.ts for what actually lights them. The
  // left one stands out by the broken column at (-8.8, 3.4) rather than in the
  // middle of the flank: from there its pool reaches the dead stone in the
  // corner, which nothing else was lighting.
  { kind: "brazier", ...at(-7.4, 3.4), yaw: 0 },
  { kind: "brazier", ...at(7.4, 3.2), yaw: 0 },
  { kind: "brazier", ...at(0, -4.0), yaw: 0 },
];

/**
 * What a piece of furniture stands on, as discs in SCREEN units around its own
 * centre: `[along the frame, up the frame, radius]`, metres.
 *
 * Two discs for the long pieces. One disc wide enough to cover a 2.2-metre table
 * is a metre of blocked floor off both its ends, and one narrow enough to fit its
 * depth lets the player walk through both halves of the top — a table is the
 * biggest thing in the room and the one whose edge is read as an edge.
 *
 * Deliberately UNDER the prop's real half-width, roughly two thirds of it. The
 * player's own body is a 0.5 disc, so a footprint drawn to the silhouette stops
 * him half a metre short of the timber and reads as an invisible wall around the
 * furniture. Shoulders clipping a tabletop is what every ARPG does and nobody
 * sees; a gap is what everybody sees.
 *
 * Screen units rather than local ones because the long pieces are placed at
 * SCREEN_SQUARE exactly (see above), so `at` rotates a footprint the same way it
 * rotated the placement, and no handedness question arises. A rug is floor.
 */
const FOOTPRINT: Record<DecorKind, readonly (readonly [number, number, number])[]> = {
  rug: [],
  table: [[-0.65, 0, 0.3], [0.65, 0, 0.3]],
  bench: [[-0.32, 0, 0.18], [0.32, 0, 0.18]],
  crate: [[0, 0, 0.28]],
  barrel: [[0, 0, 0.2]],
  pillar: [[0, 0, 0.3]],
  brazier: [[0, 0, 0.2]],
};

/** Every disc the hideout's furniture stands on, in world (x, z) metres. */
export function hideoutFootprints(): { x: number; z: number; r: number }[] {
  const out: { x: number; z: number; r: number }[] = [];
  for (const d of HIDEOUT_DECOR) {
    for (const [sx, sy, r] of FOOTPRINT[d.kind]) {
      const o = at(sx, sy);
      out.push({ x: d.x + o.x, z: d.z + o.z, r });
    }
  }
  return out;
}
