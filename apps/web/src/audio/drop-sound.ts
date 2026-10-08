import { playSfx } from "./sfx";

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

/** Play the drop sound for one tier. Silent (and safe) without WebAudio. */
export function playDropSound(tier: string | undefined, volume = 1, pan = 0): void {
  playSfx(CUE[tier ?? "normal"] ?? "drop-normal", volume, 0, pan);
}

/** Gold collected. */
export function playCoinPickup(volume = 1, pan = 0): void {
  playSfx("coin-pickup", volume, 0, pan);
}

// Re-exported so App.tsx and the tests keep one import for "the game's volume",
// even though the gain itself now lives on the shared bus.
export { soundLevel, soundMix, setSoundLevel, setSoundMix } from "./bus";
