// Deterministic rare-item name generator. PoE-style two-word names drawn from fixed word
// pools (faithful to how the game names rares from an internal list). Original words, no
// game data. Draws exactly two values from the passed PRNG so callers stay replay-stable.
const FIRST = [
  "Corpse", "Doom", "Blood", "Grim", "Dread", "Ghoul", "Rot", "Ember",
  "Storm", "Bramble", "Viper", "Onyx", "Wraith", "Bone", "Havoc", "Gloom",
];
const SECOND = [
  "Husk", "Whisper", "Bane", "Grip", "Song", "Maw", "Shard", "Veil",
  "Render", "Coil", "Roar", "Spike", "Thirst", "Weaver", "Knot", "Sorrow",
];

export function rareName(rnd: () => number): string {
  return `${FIRST[rnd() % FIRST.length]} ${SECOND[rnd() % SECOND.length]}`;
}
