// The playable classes: who a character is, before they have done anything.
//
// `@exiled/rules` is a pure leaf and holds only the ids — `simulation/classes.test.ts`
// fails if its list and these definitions ever disagree, the same arrangement
// `MAP_BASES` uses.
//
// Cosmetic only. The wardrobe is a single male rig with two looks per slot, so
// a class cannot change the body; what it changes is the outfit that body is
// created in, and the baked armour texture on each starting base is what makes
// the three read as three different people at character-select distance.
import type { CharacterClass } from "@exiled/content-schema";
import { CLASS_IDS, DEFAULT_CLASS_ID } from "@exiled/rules";

export const CLASSES: Record<string, CharacterClass> = {
  "class.ironsworn": {
    id: "class.ironsworn",
    name: "Ironsworn",
    blurb: "Took the oath at the forge and has not put the hammer down since.",
    archetype: "strength",
    // No helmet: the bare head over heavy plate is the whole silhouette.
    startingGear: {
      body: "base.ironsworn_plate",
      gloves: "base.ember_gauntlets",
      boots: "base.ashen_treads",
      belt: "base.cinderchain_sash",
    },
    portrait: "/textures/ui/menu/portrait_ironsworn.png",
  },
  "class.stalker": {
    id: "class.stalker",
    name: "Stalker",
    blurb: "Walked out of the treeline one night and never said which one.",
    archetype: "dexterity",
    startingGear: {
      helmet: "base.cinder_cap",
      body: "base.stalker_leathers",
      gloves: "base.ember_gauntlets",
      boots: "base.ashen_treads",
      belt: "base.cinderchain_sash",
    },
    portrait: "/textures/ui/menu/portrait_stalker.png",
  },
  "class.emberbound": {
    id: "class.emberbound",
    name: "Emberbound",
    blurb: "Carries a fire that was never hers to borrow.",
    archetype: "intellect",
    // Bare hands: a caster's hands have to read as hands.
    startingGear: {
      helmet: "base.cinder_cap",
      body: "base.emberbound_robe",
      boots: "base.ashen_treads",
      belt: "base.cinderchain_sash",
    },
    portrait: "/textures/ui/menu/portrait_emberbound.png",
  },
};

/** The class for an id. Unknown ids fall back rather than throwing mid-run. */
export function characterClass(id: string): CharacterClass {
  return CLASSES[id] ?? CLASSES[DEFAULT_CLASS_ID]!;
}

/** Every class, in the order the create screen offers them. */
export const CLASS_LIST: readonly CharacterClass[] = CLASS_IDS.map((id) => CLASSES[id]!);
