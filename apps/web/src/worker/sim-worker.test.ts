import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The worker's message boundary. `WorkerCore` is stubbed so `hydrate` can be
 * held open: the point under test is what the 30 Hz interval is allowed to
 * post while a saved run is still being read, not what the sim computes.
 */
let resolveHydrate: (loaded: boolean) => void;
const advance = vi.fn(() => [{ tick: 1 }]);

vi.mock("./worker-core", () => ({
  WorkerCore: class {
    hydrate() { return new Promise<boolean>((res) => { resolveHydrate = res; }); }
    advance = advance;
    consumeAreaChange() { return false; }
    getArea() { return "hideout"; }
    getAreaLayout() { return null; }
    getMapBaseId() { return ""; }
  },
}));

interface WorkerSelf {
  onmessage: ((e: { data: unknown }) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
}
let workerSelf: WorkerSelf;

function posted(): string[] {
  return workerSelf.postMessage.mock.calls.map((c) => (c[0] as { type: string }).type);
}

describe("sim-worker init", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    workerSelf = { onmessage: null, postMessage: vi.fn() };
    vi.stubGlobal("self", workerSelf);
    advance.mockClear();
    await import("./sim-worker");
    workerSelf.onmessage!({ data: { type: "init", seed: 7, characterId: "c1" } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("does not tick a world whose saved run is still loading", () => {
    vi.advanceTimersByTime(1000);
    expect(advance).not.toHaveBeenCalled();
    expect(posted()).toEqual([]);
  });

  it("ticks once the restore has landed, and the layout goes out first", async () => {
    resolveHydrate(true);
    await Promise.resolve();
    expect(posted()).toEqual(["area", "ready"]);

    vi.advanceTimersByTime(1000 / 30);
    expect(advance).toHaveBeenCalled();
    expect(posted()).toEqual(["area", "ready", "snapshot"]);
  });

  it("never ticks, and says so, when the save could not be loaded", async () => {
    // A refused save running as a default world would autosave over the real one.
    resolveHydrate(false);
    await Promise.resolve();
    vi.advanceTimersByTime(1000);
    expect(advance).not.toHaveBeenCalled();
    expect(posted()).toEqual(["loadFailed"]);
  });
});
