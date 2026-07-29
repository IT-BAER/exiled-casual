/**
 * Single-blob persistence seam. The whole save state is one string written
 * atomically under one key, so a forced restart mid-write can never leave a
 * half-committed state: the reader sees either the old blob or the new one,
 * never a mix. That atomicity IS the run-transaction integrity proof — see
 * `@exiled/simulation`'s persist module and spec §8.
 */
export interface KvStore {
  /** The saved blob, or null if nothing has been saved yet. */
  load(): Promise<string | null>;
  /** Overwrite the saved blob atomically. */
  save(value: string): Promise<void>;
}

/** In-memory adapter — deterministic and fault-injectable, for tests. */
export class MemoryKv implements KvStore {
  private blob: string | null = null;
  /** How many times save() was called. Lets a test see a debounce actually debouncing. */
  writes = 0;
  load(): Promise<string | null> {
    return Promise.resolve(this.blob);
  }
  save(value: string): Promise<void> {
    this.writes++;
    this.blob = value;
    return Promise.resolve();
  }
}

const DB_NAME = "exiled-casual";
const STORE = "state";
const KEY = "save";

/** Browser adapter: one object store, one record. Atomic per put. */
export class IndexedDbKv implements KvStore {
  private dbp: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (this.dbp) return this.dbp;
    this.dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbp;
  }

  async load(): Promise<string | null> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async save(value: string): Promise<void> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

export * from "./roster.js";
