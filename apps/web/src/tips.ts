/**
 * What the loading screen reads out while it waits.
 *
 * Client copy, not simulated content, so it lives here rather than in
 * `@exiled/content-runtime`: nothing in the sim may depend on it and
 * `@exiled/rules` stays the pure leaf it is.
 *
 * House rules for a line: it says something the player can DO, it fits on one
 * line at 1080p, and it is true of this game rather than of PoE. A tip that
 * describes a mechanic we have not built is a lie the player finds out about.
 */
export const TIPS: readonly string[] = [
  "Hold the mouse button to keep moving. The character walks to where you point, not where you click once.",
  "Q drinks the life flask, E the mana flask. Both refill on the kills you were going to make anyway.",
  "A rare monster carries an element in its name. The colour it glows is the resistance it is about to test.",
  "Waystones open maps at the device in your hideout. The tier on the stone is the tier of the map.",
  "Unidentified items hide their mods, not their base. A good base is worth the scroll.",
  "Every map is worth finishing: the boss at the end pays out whether the floor did or not.",
  "The stash is shared by every character you make. What one finds, the next one starts with.",
  "Sell what you will not wear. The bench pays in shards, and shards become orbs.",
  "Press C for the character sheet. Resistances are capped, but overcapping is what survives a map mod.",
  "Blink costs mana and crosses a gap. It is a defensive skill wearing a movement skill's coat.",
];

/**
 * One tip per load, chosen at random.
 *
 * Deliberately not sequential: a rotation the player can predict stops being
 * read after the third map, which is the whole failure mode of loading tips.
 */
export function pickTip(rand: () => number = Math.random): string {
  return TIPS[Math.floor(rand() * TIPS.length)] ?? TIPS[0]!;
}
