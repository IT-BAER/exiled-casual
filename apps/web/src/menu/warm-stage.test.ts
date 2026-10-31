import { describe, it, expect, vi, beforeEach } from "vitest";
import { warmMenuStage, MENU_STAGE_MODELS, resetMenuStageWarm, warmGame, GAME_MODELS } from "./warm-stage";
import { beginLoad, loadProgress, resetLoadProgress } from "../load-progress";

describe("warming the character stage", () => {
  beforeEach(() => resetMenuStageWarm());

  it("pulls the stage chunk and every model it will ask for", async () => {
    const fetched: string[] = [];
    const chunk = vi.fn(async () => undefined);
    await warmMenuStage({
      chunk,
      fetch: async (url: string) => { fetched.push(url); return undefined; },
    });
    expect(chunk).toHaveBeenCalledTimes(1);
    expect(fetched).toEqual([...MENU_STAGE_MODELS]);
  });

  it("warms once, however many screens ask", async () => {
    const chunk = vi.fn(async () => undefined);
    const fetch = vi.fn(async () => undefined);
    await warmMenuStage({ chunk, fetch });
    await warmMenuStage({ chunk, fetch });
    expect(chunk).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(MENU_STAGE_MODELS.length);
  });

  it("resolves even when nothing can be fetched", async () => {
    await expect(warmMenuStage({
      chunk: async () => { throw new Error("offline"); },
      fetch: async () => { throw new Error("offline"); },
    })).resolves.toBeUndefined();
  });
});

describe("warming the game from the roster", () => {
  beforeEach(() => { resetMenuStageWarm(); resetLoadProgress(); });

  it("pulls the game chunk, the worker and every model the first frame waits on, once", async () => {
    const fetched: string[] = [];
    const chunk = vi.fn(async () => undefined);
    const w = { chunk, worker: "/assets/sim-worker.js", fetch: async (url: string) => { fetched.push(url); } };
    await warmGame(w);
    await warmGame(w);
    expect(chunk).toHaveBeenCalledTimes(1);
    expect(fetched).toEqual(["/assets/sim-worker.js", ...GAME_MODELS]);
  });

  it("reports the bytes received as the download share of the load", async () => {
    beginLoad("entry");
    const sizes: Record<string, number> = { "/w.js": 0, [GAME_MODELS[0]]: 600, [GAME_MODELS[1]]: 100, [GAME_MODELS[2]]: 300 };
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const run = warmGame({
      chunk: async () => undefined,
      worker: "/w.js",
      fetch: async (url, onBytes) => {
        const total = sizes[url]!;
        onBytes(0, total);
        if (url === GAME_MODELS[2]) await gate;
        onBytes(total, total);
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    // 700 of 1000 bytes: 70% of the download half of an entry.
    expect(loadProgress()).toBe(35);
    release();
    await run;
    expect(loadProgress()).toBe(50);
  });

  it("resolves even when nothing can be fetched", async () => {
    await expect(warmGame({
      chunk: async () => { throw new Error("stale deploy"); },
      worker: "/w.js",
      fetch: async () => { throw new Error("offline"); },
    })).resolves.toBeUndefined();
  });
});
