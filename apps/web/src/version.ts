/**
 * What build this is, for a human.
 *
 * Deliberately NOT `CONTENT_VERSION` (`@exiled/content-runtime`), which is a
 * data key: map layouts and saves are generated against it, so it changes when
 * the content shape does and never because a release was cut. This one is the
 * release, and it is the only version the player is ever shown.
 *
 * `<version> <Phase>`: the phase is the promise (Alpha means saves may not
 * survive, Beta means they should), the number is the release, patch included.
 */
export const GAME_VERSION = "v0.5.1 Alpha";
