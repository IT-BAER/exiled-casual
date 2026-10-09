import { playSfx, playSfxAt } from "./sfx";

/**
 * Drop and reward cues, one sampled cue per tier (`tools/build_reward_sfx.py`).
 *
 * Tiering follows NeverSink's filter alerts rather than PoE's stock drop noises:
 * junk barely clicks, the good stuff announces itself, and the top tier gets a
 * deep boom you hear before you read the plate. Currency, gold and level-up each
 * have their own voice (docs/09 rule 2).
 */

const CUE: Record<string, string> = {
  normal: "drop-normal",
  magic: "drop-magic",
  rare: "drop-rare",
  unique: "drop-unique",
  currency: "drop-currency",
  gold: "drop-gold",
  "gold-jackpot": "drop-gold-jackpot",
  "level-up": "level-up",
};

interface At { x: number; y: number }

/**
 * Play the drop sound for one tier, from where it landed (sim units), or on the
 * player when it has no place (a level-up, a craft). Silent (and safe) without WebAudio.
 */
export function playDropSound(tier: string | undefined, at?: At, volume = 1): void {
  const cue = CUE[tier ?? "normal"] ?? "drop-normal";
  if (at) playSfxAt(cue, at.x, at.y, volume);
  else playSfx(cue, volume);
}

/** Gold collected, where the pile lay. */
export function playCoinPickup(at: At, volume = 1): void {
  playSfxAt("coin-pickup", at.x, at.y, volume);
}

// Re-exported so App.tsx and the tests keep one import for "the game's volume",
// even though the gain itself now lives on the shared bus.
export { soundLevel, soundMix, setSoundLevel, setSoundMix } from "./bus";
