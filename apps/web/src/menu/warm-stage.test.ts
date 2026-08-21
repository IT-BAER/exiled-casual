import { describe, it, expect, vi, beforeEach } from "vitest";
import { warmMenuStage, MENU_STAGE_MODELS, resetMenuStageWarm } from "./warm-stage";

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
