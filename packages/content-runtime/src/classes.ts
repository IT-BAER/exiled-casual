// The playable classes: who a character is, before they have done anything.
//
// `@exiled/rules` is a pure leaf and holds only the ids — `simulation/classes.test.ts`
// fails if its list and these definitions ever disagree, the same arrangement
// `MAP_BASES` uses.
//
// `startingGear` is the class's own family, head to foot: every armour slot is
// filled on creation, and each piece resolves to that family's wardrobe look
// (`gear-looks.ts`). The belt is the one slot with no geometry - it carries
// stats and sits in the paper doll, and a belt under a cuirass or a robe is not
// seen anyway.
import type { CharacterClass } from "@exiled/content-schema";
import { CLASS_IDS, DEFAULT_CLASS_ID } from "@exiled/rules";

export const CLASSES: Record<string, CharacterClass> = {
  "class.ironsworn": {
    id: "class.ironsworn",
    name: "Ironsworn",
    blurb: "Took the oath at the forge and has not put the hammer down since.",
    archetype: "strength",
    startingGear: {
      helmet: "base.ironsworn_helm",
      body: "base.ironsworn_plate",
      gloves: "base.ironsworn_gauntlets",
      boots: "base.ironsworn_sabatons",
      belt: "base.ironsworn_girdle",
    },
    portrait: "/textures/ui/menu/portrait_ironsworn.png",
  },
  "class.stalker": {
    id: "class.stalker",
    name: "Stalker",
    blurb: "Walked out of the treeline one night and never said which one.",
    archetype: "dexterity",
    startingGear: {
      helmet: "base.stalker_hood",
      body: "base.stalker_leathers",
      gloves: "base.stalker_gloves",
      boots: "base.stalker_boots",
      belt: "base.stalker_strap",
    },
    portrait: "/textures/ui/menu/portrait_stalker.png",
  },
  "class.emberbound": {
    id: "class.emberbound",
    name: "Emberbound",
    blurb: "Carries a fire that was never hers to borrow.",
    archetype: "intellect",
    startingGear: {
      helmet: "base.ember_cowl",
      body: "base.ember_robe",
      gloves: "base.ember_wraps",
      boots: "base.ember_slippers",
      belt: "base.ember_sash",
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
