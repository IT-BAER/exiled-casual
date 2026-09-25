/**
 * What the browser tab says.
 *
 * The tab is the one piece of the game the player sees while doing something
 * else, so it names where they left off: the hall they are standing in, the
 * screen they stopped on, or just the game when it is on the menu.
 *
 * Imports nothing, so the menu bundle pays two lines for it.
 */
export const GAME_NAME = "Exiled Casual";

/** `Exiled Casual - Vaal Foundry`, or `home` when nowhere in particular. */
export function titleFor(where?: string | null, home: string = GAME_NAME): string {
  const place = where?.trim();
  // A hyphen, never an em dash: they are banned in everything this project puts
  // in front of a person, and a tab title is the most public string it has.
  return place ? `${GAME_NAME} - ${place}` : home;
}

/** The descriptive title index.html ships, read before anything renames the tab.
 *  Crawlers render the menu, so the menu must keep it rather than the bare name. */
const HOME_TITLE =
  (typeof document !== "undefined" && document.title.trim()) || GAME_NAME;

/** Set it. A no-op without a document, which is every headless test. */
export function setTitle(where?: string | null): void {
  if (typeof document === "undefined") return;
  document.title = titleFor(where, HOME_TITLE);
}
