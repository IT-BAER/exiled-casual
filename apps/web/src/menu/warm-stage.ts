/**
 * Pull everything the character stage needs while the menu is still on screen.
 *
 * Reaching the roster otherwise starts the whole chain at once and strictly in
 * order: the lazy stage chunk (Babylon, ~3.9 MB built), then wardrobe.glb and
 * anim-library.glb (~15 MB together), then the parse, then the shader compile,
 * and only then does anybody appear in the hall. None of it depends on which
 * character is picked, so all of it can happen during the seconds spent reading
 * the menu and choosing local or online.
 *
 * A head start, never a prerequisite: every failure is swallowed and the stage's
 * own load runs exactly as before, taking the models from the HTTP cache when
 * this got there first. Warms once per page life.
 */
import { setDownloaded } from "../load-progress";

/** The models `loadPlayerRig` will ask for, by the same URLs, or the cache misses. */
export const MENU_STAGE_MODELS = ["/models/wardrobe.glb", "/models/wardrobe-female.glb", "/models/anim-library.glb"] as const;

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

/**
 * The same head start for the game itself, from the roster and create screens.
 *
 * At 20 Mbit/s the models the first frame waits on (props, rocks, monsters:
 * 14.5 MB) are about 13 s of download, and none of them depend on the character
 * either, so the roster spends that time instead. The chunk is GameView's, handed in by
 * App so no menu module imports it; importing runs it, which mounts nothing.
 * Each model's bytes feed the loading plate's bar (`load-progress`).
 */
export const GAME_MODELS = ["/models/props.glb", "/models/rocks.glb", "/models/monsters.glb"] as const;

interface GameWarmers {
  chunk: () => Promise<unknown>;
  /** The sim worker's built script, which GameView spawns on mount. */
  worker: string;
  fetch: (url: string, onBytes: (received: number, total: number) => void) => Promise<unknown>;
}

/** Drains the body (or the cache never finishes storing it), counting as it goes. */
async function fetchCounting(url: string, onBytes: (received: number, total: number) => void): Promise<void> {
  // Low priority: the roster's own figure is still downloading beside it.
  const r = await fetch(url, { priority: "low" });
  const total = Number(r.headers.get("content-length")) || 0;
  const reader = r.body?.getReader();
  if (!reader) { await r.blob(); onBytes(total, total); return; }
  let got = 0;
  for (let c = await reader.read(); !c.done; c = await reader.read()) onBytes((got += c.value.byteLength), total);
  // No content-length: the size is known only now.
  if (total === 0) onBytes(got, got);
}

let gameWarmed = false;

export function warmGame(warmers: Pick<GameWarmers, "chunk" | "worker"> & Partial<GameWarmers>): Promise<void> {
  if (gameWarmed) return Promise.resolve();
  gameWarmed = true;
  const fetchOne = warmers.fetch ?? fetchCounting;
  const quiet = (p: Promise<unknown>) => p.then(() => undefined, () => undefined);
  const got = GAME_MODELS.map(() => 0);
  const total = GAME_MODELS.map(() => 0);
  // Only once every size is known: one small file done before the others have
  // answered would otherwise read as everything done.
  const report = () => {
    if (total.some((t) => t === 0)) return;
    setDownloaded(got.reduce((a, b) => a + b, 0) / total.reduce((a, b) => a + b, 0));
  };
  return Promise.all([
    quiet(warmers.chunk()),
    quiet(fetchOne(warmers.worker, () => {})),
    ...GAME_MODELS.map((url, i) => quiet(fetchOne(url, (n, t) => { got[i] = n; total[i] = t; report(); }))),
  ]).then(() => undefined);
}

/** Tests only: forget that the page was already warmed. */
export function resetMenuStageWarm(): void {
  warmed = false;
  gameWarmed = false;
}
