// Deterministic rare-item name generator. PoE-style two-word names: a shared first word
// and a second word for the item's own kind, so a ring reads as a ring and a wand as a
// wand. Original words, no game data, and none taken from a base or unique name, or a
// rare would read as a set piece. Draws exactly two values from the passed PRNG so
// callers stay replay-stable.
const FIRST = [
  "Corpse", "Doom", "Blood", "Grim", "Dread", "Ghoul", "Rot", "Storm",
  "Bramble", "Viper", "Onyx", "Wraith", "Bone", "Havoc", "Gloom", "Carrion",
  "Hollow", "Raven", "Pyre", "Torment", "Blight", "Mire", "Gale", "Rune",
  "Skull", "Vile", "Frost", "Thunder", "Sable", "Wrath", "Dusk", "Eagle",
];

const MELEE = [
  "Bane", "Bite", "Edge", "Fang", "Razor", "Spike", "Maw", "Render",
  "Roar", "Thirst", "Breaker", "Crusher", "Splitter", "Hunger", "Kiss", "Fury",
];
const CASTER = [
  "Song", "Whisper", "Branch", "Twig", "Needle", "Chant", "Hex", "Glyph",
  "Rod", "Spark", "Call", "Murmur", "Prayer", "Weird", "Root", "Lantern",
];
const SECOND_BY_CLASS: Readonly<Record<string, readonly string[]>> = {
  ring: [
    "Coil", "Knot", "Halo", "Clasp", "Orbit", "Spiral", "Hoop", "Seal",
    "Promise", "Vow", "Eclipse", "Cycle", "Wheel", "Bond", "Link", "Shackle",
  ],
  amulet: [
    "Charm", "Heart", "Locket", "Idol", "Star", "Eye", "Sigil", "Totem",
    "Relic", "Token", "Beacon", "Omen", "Tear", "Chain", "Choker", "Gaze",
  ],
  belt: [
    "Cord", "Lash", "Bind", "Cinch", "Tether", "Rope", "Buckle", "Harness",
    "Noose", "Brace", "Twine", "Truss", "Yoke", "Fetter", "Clutch", "Girth",
  ],
  helmet: [
    "Crown", "Brow", "Visor", "Crest", "Horn", "Mask", "Dome", "Peak",
    "Glare", "Mind", "Thought", "Veil", "Shroud", "Cap", "Tusk", "Wreath",
  ],
  body: [
    "Shell", "Hide", "Husk", "Carapace", "Mantle", "Coat", "Skin", "Pelt",
    "Cloak", "Shelter", "Keep", "Vest", "Cage", "Ribs", "Frame", "Hull",
  ],
  gloves: [
    "Grip", "Fist", "Claw", "Talon", "Touch", "Hand", "Paw", "Palm",
    "Knuckle", "Reach", "Hold", "Snatch", "Mitts", "Fingers", "Clench", "Hook",
  ],
  boots: [
    "Stride", "Tread", "Step", "March", "Track", "Trail", "Path", "Road",
    "Heel", "Spur", "Hoof", "Stomp", "Dash", "Wake", "Roam", "Trek",
  ],
  shield: [
    "Wall", "Guard", "Bulwark", "Aegis", "Bastion", "Rampart", "Barrier", "Screen",
    "Door", "Gate", "Fortress", "Wing", "Mark", "Refuge", "Haven", "Duty",
  ],
  bow: [
    "Arc", "Flight", "Quill", "Fletch", "String", "Nock", "Volley", "Hail",
    "Rain", "Sting", "Bough", "Siren", "Breeze", "Pinion", "Hunt", "Range",
  ],
  wand: CASTER,
  focus: CASTER,
  sword: MELEE,
  mace: MELEE,
};

/** A class with no list of its own (a new weapon kind) ends on a weapon word. */
export function rareName(rnd: () => number, itemClass: string): string {
  const second = SECOND_BY_CLASS[itemClass] ?? MELEE;
  return `${FIRST[rnd() % FIRST.length]} ${second[rnd() % second.length]}`;
}
