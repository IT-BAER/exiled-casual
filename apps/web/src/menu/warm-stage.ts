/**
 * Pull everything the character stage needs while the menu is still on screen.
 *
 * Reaching the roster otherwise starts the whole chain at once and strictly in
 * order: the lazy stage chunk (Babylon, ~3.9 MB built), then wardrobe.glb and
 * anim-library.glb (~7 MB together), then the parse, then the shader compile,
 * and only then does anybody appear in the hall. None of it depends on which
 * character is picked, so all of it can happen during the seconds spent reading
 * the menu and choosing local or online.
 *
 * A head start, never a prerequisite: every failure is swallowed and the stage's
 * own load runs exactly as before, taking the models from the HTTP cache when
 * this got there first. Warms once per page life.
 */

/** The models `loadPlayerRig` will ask for, by the same URLs, or the cache misses. */
export const MENU_STAGE_MODELS = ["/models/wardrobe.glb", "/models/anim-library.glb"] as const;

interface Warmers {
  chunk: () => Promise<unknown>;
  fetch: (url: string) => Promise<unknown>;
}

const defaults: Warmers = {
  chunk: () => import("./MenuStage"),
  // The body must be read, not just the headers: a response nobody drains is a
  // response the cache never finishes storing.
  fetch: (url) => fetch(url).then((r) => r.blob()),
};

let warmed = false;

export function warmMenuStage(warmers: Partial<Warmers> = {}): Promise<void> {
  if (warmed) return Promise.resolve();
  warmed = true;
  const w = { ...defaults, ...warmers };
  const quiet = (p: Promise<unknown>) => p.then(() => undefined, () => undefined);
  return Promise.all([
    quiet(w.chunk()),
    ...MENU_STAGE_MODELS.map((url) => quiet(w.fetch(url))),
  ]).then(() => undefined);
}

/** Tests only: forget that the page was already warmed. */
export function resetMenuStageWarm(): void {
  warmed = false;
}
