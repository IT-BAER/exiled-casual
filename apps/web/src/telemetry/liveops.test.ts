import { describe, it, expect } from "vitest";
import { DEFAULT_LIVE_CONFIG } from "@exiled/telemetry";
import { parseLiveConfig, flag, _setLiveConfig } from "./liveops";

describe("parseLiveConfig", () => {
  it("turns garbage into the defaults", () => {
    for (const g of [null, undefined, 5, "x", [], { motd: 3, maintenance: [], flags: 7, telemetry: "no", minBuiltAt: "z" }]) {
      expect(parseLiveConfig(g)).toEqual(DEFAULT_LIVE_CONFIG);
    }
  });

  it("keeps what fits and drops what does not", () => {
    const c = parseLiveConfig({
      motd: { id: "m1", text: "hi", level: "loud" },
      maintenance: { text: "back soon" },
      minBuiltAt: 1700,
      flags: { a: true, b: 2, c: "s", d: null, e: {} },
      telemetry: false,
    });
    expect(c).toEqual({
      motd: { id: "m1", text: "hi", level: "info" },
      maintenance: { text: "back soon" },
      minBuiltAt: 1700,
      flags: { a: true, b: 2, c: "s" },
      telemetry: false,
    });
  });

  it("flag falls back on absence and on a type mismatch", () => {
    _setLiveConfig(parseLiveConfig({ flags: { n: 3, s: "x" } }));
    expect(flag("n", 1)).toBe(3);
    expect(flag("missing", true)).toBe(true);
    expect(flag("s", 5)).toBe(5);
    _setLiveConfig(DEFAULT_LIVE_CONFIG);
  });
});
