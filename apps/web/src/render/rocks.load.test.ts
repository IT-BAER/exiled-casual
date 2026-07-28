import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "@babylonjs/core";

/** Resolvers for every load started so far, so a test can finish them out of order. */
const pendingLoads: Array<(container: unknown) => void> = [];

vi.mock("@babylonjs/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@babylonjs/core")>()),
  LoadAssetContainerAsync: () =>
    new Promise((resolve) => {
      pendingLoads.push(resolve);
    }),
}));

const { isRocksReady, loadRocks, resetRocks } = await import("./rocks");

const container = () => ({ meshes: [], dispose: vi.fn() });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("loadRocks", () => {
  beforeEach(() => {
    pendingLoads.length = 0;
    resetRocks();
  });

  it("ignores a load that finishes after its scene was torn down", async () => {
    // React's StrictMode mounts the effect, tears it down and mounts it again,
    // so in dev there are two loads in flight and the first one resolves last
    // about half the time. Letting it land wrote a dead scene into the cache,
    // isRocksReady went false against the live scene, and the map fell back to
    // the box walls with nothing logged.
    const dead = {} as Scene;
    const live = {} as Scene;

    void loadRocks(dead);
    resetRocks();
    void loadRocks(live);

    pendingLoads[1]?.(container()); // the live scene's load finishes first...
    pendingLoads[0]?.(container()); // ...and the dead scene's lands after it
    await flush();

    expect(isRocksReady(live)).toBe(true);
    expect(isRocksReady(dead)).toBe(false);
  });

  it("does not hand a second scene the first scene's in-flight load", async () => {
    const first = {} as Scene;
    const second = {} as Scene;

    void loadRocks(first);
    void loadRocks(second);
    expect(pendingLoads).toHaveLength(2);

    pendingLoads[1]?.(container());
    await flush();
    expect(isRocksReady(second)).toBe(true);
  });
});
