import { describe, it, expect, afterEach } from "vitest";
import { MemoryKv, IndexedDbKv } from "./index";

/** An indexedDB whose every write transaction aborts with `error`, as a full disk does. */
function abortingIndexedDb(error: Error) {
  const db = {
    transaction: () => {
      const tx: { error: Error | null; onabort?: () => void; onerror?: () => void; oncomplete?: () => void; objectStore: () => unknown } = {
        error: null,
        objectStore: () => ({ put: () => setTimeout(() => { tx.error = error; tx.onabort?.(); }) }),
      };
      return tx;
    },
  };
  return {
    open: () => {
      const req: { result?: unknown; onsuccess?: () => void } = {};
      setTimeout(() => { req.result = db; req.onsuccess?.(); });
      return req;
    },
  };
}

describe("IndexedDbKv", () => {
  afterEach(() => { delete (globalThis as { indexedDB?: unknown }).indexedDB; });

  it("rejects a write the browser aborts, such as one over the storage quota", async () => {
    const quota = new Error("QuotaExceededError");
    (globalThis as { indexedDB?: unknown }).indexedDB = abortingIndexedDb(quota);
    const settled = new Promise((_, reject) => setTimeout(() => reject(new Error("never settled")), 200));
    await expect(Promise.race([new IndexedDbKv().save("x"), settled])).rejects.toBe(quota);
  });
});

// IndexedDbKv needs a browser and is exercised live; MemoryKv is the seam
// contract the run-transaction proof relies on.
describe("MemoryKv", () => {
  it("returns null before anything is saved", async () => {
    expect(await new MemoryKv().load()).toBeNull();
  });

  it("round-trips the saved blob", async () => {
    const kv = new MemoryKv();
    await kv.save("hello");
    expect(await kv.load()).toBe("hello");
  });

  it("overwrites wholesale on re-save", async () => {
    const kv = new MemoryKv();
    await kv.save("first");
    await kv.save("second");
    expect(await kv.load()).toBe("second");
  });
});
