/**
 * The people in the hideout, by name.
 *
 * Its own module and not `meshes.ts`, where the disenchanter's body is built: the
 * HUD needs the name for the label over him and the header on his window, and the
 * HUD must not pull Babylon in to print a word. Same reason `settings.ts` imports
 * nothing.
 */

/**
 * The disenchanter. He had no name at all and his hover label read "Vendor", which
 * is a job title on a form rather than a person you walk up to — PoE's vendors are
 * Nessa and Tarkleigh before they are a shop. Both halves live here so the label
 * over him and the header on his window cannot drift apart.
 */
export const VENDOR_NAME = "Varkis";
export const VENDOR_TITLE = "the Disenchanter";
