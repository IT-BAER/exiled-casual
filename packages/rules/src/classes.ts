/**
 * The playable classes, as ids only.
 *
 * `@exiled/rules` is a pure leaf, so it may hold the id strings and nothing
 * else; the names, blurbs, portraits and starting gear live in
 * `@exiled/content-runtime`, and `simulation/classes.test.ts` fails if the two
 * lists ever disagree. Same arrangement as `MAP_BASE_IDS` above.
 *
 * A class picks a look, a portrait, a starting outfit and ONE number: its
 * default attack (`DEFAULT_ATTACK_BY_CLASS` in content-runtime). Nothing in
 * `stats.ts` reads the id even so. PoE keys the default attack off the equipped
 * weapon instead, and that is where this goes once weapon bases and a weapon
 * damage stat exist — the class map is the stand-in until then, not the design.
 * Borrowed from PoE1's class select (the roster row's "Level 96 Champion"
 * line); the names and fiction are original.
 */
export const CLASS_IDS = ["class.ironsworn", "class.stalker", "class.emberbound"] as const;

export type ClassId = (typeof CLASS_IDS)[number];

/** What a character with an unknown or missing class id is treated as. */
export const DEFAULT_CLASS_ID: ClassId = "class.stalker";

/** Narrow an arbitrary string to a class id, falling back rather than throwing mid-run. */
export function classIdOr(id: string): ClassId {
  return (CLASS_IDS as readonly string[]).includes(id) ? (id as ClassId) : DEFAULT_CLASS_ID;
}
