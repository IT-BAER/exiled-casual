import { describe, it, expect, vi } from "vitest";
import { createDevApi } from "./dev-api";
import { fp } from "@exiled/fixed-point";

function harness() {
  const posted: unknown[] = [];
  const deps = {
    post: vi.fn((m: unknown) => { posted.push(m); }),
    stopLoop: vi.fn(),
    startLoop: vi.fn(),
    grab: vi.fn(async () => new Blob(["png"])),
    send: vi.fn(async (_url: string, _body: Blob) => ({ ok: true, status: 200, text: async () => "D:/x/shots/a.png" })),
    snapshot: vi.fn(() => ({ player: { x: 2, y: 3, heading: { x: 1, y: 0 } } }) as never),
    frames: vi.fn(async (n: number, _w: number, _q: number, _first: () => void) => Array.from({ length: n }, () => new Blob(["jpg"]))),
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

  it("stands dummies, refills, and casts at the dummy arc by default", () => {
    const { api, posted } = harness();
    api.dummies();
    api.dummies(3);
    api.spawn("pack");
    api.spawn("dummy", 2);
    api.clear();
    api.refill();
    api.cooldowns();
    api.home();
    api.cast("skill.ice_shot.v1");
    api.cast("skill.ice_shot.v1", -1, 4.5);
    expect(posted).toEqual([
      { type: "spawn", what: "dummy", count: 7 },
      { type: "spawn", what: "dummy", count: 3 },
      { type: "spawn", what: "pack" },
      { type: "spawn", what: "dummy", count: 2 },
      { type: "spawn", what: "clear" },
      { type: "dev", op: { op: "refill" } },
      { type: "dev", op: { op: "refill" } },
      { type: "dev", op: { op: "home" } },
      { type: "intent", intent: { kind: "useSkill", skillId: "skill.ice_shot.v1", tx: fp(8), ty: fp(3) } },
      { type: "intent", intent: { kind: "useSkill", skillId: "skill.ice_shot.v1", tx: fp(-1), ty: fp(4.5) } },
    ]);
  });

  it("records consecutive frames into review/skills/<label>/ and resolves with the count", async () => {
    const { api, deps, posted } = harness();
    await expect(api.record(3, "ice shot", { cast: { skillId: "skill.ice_shot.v1" } })).resolves.toBe(3);
    expect(deps.frames).toHaveBeenCalledWith(3, 960, 0.8, expect.any(Function));
    // The cast goes out on the first recorded frame.
    deps.frames.mock.calls[0]![3]();
    expect(posted.at(-1)).toMatchObject({ type: "intent", intent: { kind: "useSkill", skillId: "skill.ice_shot.v1" } });
    expect(deps.send.mock.calls.map((c) => c[0])).toEqual([
      "/__capture?dir=skills&label=ice%20shot&name=000",
      "/__capture?dir=skills&label=ice%20shot&name=001",
      "/__capture?dir=skills&label=ice%20shot&name=002",
    ]);
  });
});
