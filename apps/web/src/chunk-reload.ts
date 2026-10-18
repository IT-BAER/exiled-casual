/**
 * A screen chunk that fails to load is almost always a tab older than the last deploy,
 * asking for a hashed file the deploy replaced. A reload fetches the current index and
 * its chunks. At most once a minute per tab, so a chunk that is really missing shows its
 * error instead of reloading forever; a tab that cannot remember the reload never reloads.
 */
const KEY = "exiled.chunkReloadAt";
const WINDOW_MS = 60_000;

interface Deps {
  storage: Pick<Storage, "getItem" | "setItem">;
  reload: () => void;
  now: () => number;
}

const browser = (): Deps => ({ storage: sessionStorage, reload: () => location.reload(), now: Date.now });

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
