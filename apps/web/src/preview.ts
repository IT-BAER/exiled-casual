/**
 * Work on main that the owner has not signed off: shown in a dev build, and in a
 * release only with `?preview=<name>[,<name>]`, so a release keeps what last shipped.
 */
export function previewOn(name: string, dev: boolean, search: string): boolean {
  return dev || (new URLSearchParams(search).get("preview") ?? "").split(",").includes(name);
}

/** Maren's look after v0.7.8: her own head, regrown hair, lace and the Stalker's knee boots. */
export const PREVIEW_MAREN = previewOn("maren", import.meta.env?.DEV === true,
  typeof location === "undefined" ? "" : location.search);

/** The female wardrobe a page loads; the released one is v0.7.8's, frozen until her look ships. */
export function femaleWardrobe(preview: boolean): string {
  return preview ? "/models/wardrobe-female.glb" : "/models/wardrobe-female-released.glb";
}

export const FEMALE_WARDROBE = femaleWardrobe(PREVIEW_MAREN);
