import { describe, expect, it, vi } from "vitest";
import { reloadOnChunkError, reloadPage } from "./chunk-reload";

function env() {
  const store = new Map<string, string>();
  return {
    deps: {
      storage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
      reload: vi.fn(),
      now: () => 0,
    },
  };
}

const settles = (p: Promise<unknown>) =>
  Promise.race([p.then(() => "settled", () => "settled"), new Promise((r) => setTimeout(() => r("pending"), 20))]);

describe("reloadOnChunkError", () => {
  it("passes a loaded chunk through and never reloads", async () => {
    const e = env();
    await expect(reloadOnChunkError(() => Promise.resolve(42), e.deps)()).resolves.toBe(42);
    expect(e.deps.reload).not.toHaveBeenCalled();
  });

  it("reloads once when a chunk fails, and holds the screen until the page goes", async () => {
    const e = env();
    const load = reloadOnChunkError(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module")), e.deps);
    expect(await settles(load())).toBe("pending");
    expect(e.deps.reload).toHaveBeenCalledTimes(1);
  });

  it("shows the error instead of reloading again within a minute", async () => {
    const e = env();
    const fail = () => Promise.reject(new TypeError("Failed to fetch dynamically imported module"));
    void reloadOnChunkError(fail, e.deps)();
    await Promise.resolve();
    e.deps.now = () => 59_000;
    await expect(reloadOnChunkError(fail, e.deps)()).rejects.toThrow("Failed to fetch");
    expect(e.deps.reload).toHaveBeenCalledTimes(1);
    e.deps.now = () => 61_000;
    expect(await settles(reloadOnChunkError(fail, e.deps)())).toBe("pending");
    expect(e.deps.reload).toHaveBeenCalledTimes(2);
  });

  it("says why by beacon before the page goes", () => {
    const order: string[] = [];
    const t = {
      track: vi.fn((e: { k: string }) => order.push(`track ${e.k}`)),
      flush: vi.fn((beacon?: boolean) => order.push(`flush ${beacon}`)),
    };
    reloadPage("webgl", t, () => order.push("reload"));
    expect(t.track).toHaveBeenCalledWith({ k: "reload", reason: "webgl" });
    expect(order).toEqual(["track reload", "flush true", "reload"]);
  });

  it("shows the error when the tab cannot remember a reload", async () => {
    const e = env();
    e.deps.storage.getItem = () => { throw new Error("SecurityError"); };
    await expect(reloadOnChunkError(() => Promise.reject(new Error("chunk")), e.deps)()).rejects.toThrow("chunk");
    expect(e.deps.reload).not.toHaveBeenCalled();
  });
});
