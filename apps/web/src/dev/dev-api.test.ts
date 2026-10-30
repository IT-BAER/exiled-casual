import { describe, it, expect, vi } from "vitest";
import { createDevApi } from "./dev-api";

function harness() {
  const posted: unknown[] = [];
  const deps = {
    post: vi.fn((m: unknown) => { posted.push(m); }),
    stopLoop: vi.fn(),
    startLoop: vi.fn(),
    grab: vi.fn(async () => new Blob(["png"])),
    send: vi.fn(async () => ({ ok: true, status: 200, text: async () => "D:/x/shots/a.png" })),
  };
  return { posted, deps, ...createDevApi(deps) };
}

describe("__dev", () => {
  it("sends each cheat as one dev op", () => {
    const { api, posted } = harness();
    api.level(12);
    api.teleport("gallowsmoor", 7);
    api.currency("currency.alchemy", 4);
    api.boss(3);
    api.boss();
    expect(posted).toEqual([
      { type: "dev", op: { op: "setLevel", level: 12 } },
      { type: "dev", op: { op: "teleport", atlasNodeId: "node.gallowsmoor", tier: 7 } },
      { type: "dev", op: { op: "grantCurrency", baseId: "currency.alchemy", count: 4 } },
      { type: "dev", op: { op: "boss", phase: 3 } },
      { type: "dev", op: { op: "boss", phase: 1 } },
    ]);
  });

  it("resolves a dump with the worker's answer", async () => {
    const { api, onDump } = harness();
    const p = api.dump();
    onDump({ tick: 5 });
    await expect(p).resolves.toEqual({ tick: 5 });
  });

  it("freezes the sim and the render loop together, once", () => {
    const { api, deps, posted } = harness();
    api.freeze();
    api.freeze();
    expect(api.frozen).toBe(true);
    expect(deps.stopLoop).toHaveBeenCalledTimes(1);
    expect(posted).toEqual([{ type: "pause", paused: true }]);
    api.unfreeze();
    expect(deps.startLoop).toHaveBeenCalledTimes(1);
    expect(posted.at(-1)).toEqual({ type: "pause", paused: false });
  });

  it("posts the grabbed frame to the capture route and returns the path", async () => {
    const { api, deps } = harness();
    await expect(api.capture("hideout portal", "baselines")).resolves.toBe("D:/x/shots/a.png");
    expect(deps.send).toHaveBeenCalledWith("/__capture?dir=baselines&name=hideout%20portal", expect.any(Blob));
  });

  it("throws when the dev server refuses the capture", async () => {
    const { api, deps } = harness();
    deps.send.mockResolvedValueOnce({ ok: false, status: 405, text: async () => "" });
    await expect(api.capture("x")).rejects.toThrow("HTTP 405");
  });
});
