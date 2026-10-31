/**
 * A screen chunk that fails to load is almost always a tab older than the last deploy,
 * asking for a hashed file the deploy replaced. A reload fetches the current index and
 * its chunks. At most once a minute per tab, so a chunk that is really missing shows its
 * error instead of reloading forever; a tab that cannot remember the reload never reloads.
 */
import { telemetry } from "./telemetry/client";

const KEY = "exiled.chunkReloadAt";
const WINDOW_MS = 60_000;

interface Deps {
  storage: Pick<Storage, "getItem" | "setItem">;
  reload: () => void;
  now: () => number;
}

/**
 * Every reload the page does to itself, said first and sent by beacon: once the page is
 * gone the queue goes with it, and a silent reload reads as a player who left.
 */
export function reloadPage(
  reason: "chunk" | "webgl",
  t: Pick<typeof telemetry, "track" | "flush"> = telemetry,
  reload: () => void = () => location.reload(),
): void {
  t.track({ k: "reload", reason });
  t.flush(true);
  reload();
}

const browser = (): Deps => ({ storage: sessionStorage, reload: () => reloadPage("chunk"), now: Date.now });

export function reloadOnChunkError<T>(load: () => Promise<T>, deps?: Deps): () => Promise<T> {
  return () =>
    load().catch((err: unknown) => {
      const d = deps ?? browser();
      try {
        const last = Number(d.storage.getItem(KEY) ?? -Infinity);
        if (d.now() - last < WINDOW_MS) throw err;
        d.storage.setItem(KEY, String(d.now()));
      } catch {
        throw err;
      }
      d.reload();
      // Never settles: the screen keeps its loading state until the page is gone.
      return new Promise<T>(() => {});
    });
}
