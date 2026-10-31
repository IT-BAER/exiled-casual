// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { deviceNotices, probeDevice } from "./device-notice";

const RTX = "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)";

describe("deviceNotices", () => {
  it("says nothing on a desktop with a mouse and a GPU", () => {
    expect(deviceNotices({ renderer: RTX, finePointer: true })).toEqual([]);
  });

  it("says nothing when the GPU is unknown", () => {
    expect(deviceNotices({ renderer: "", finePointer: true })).toEqual([]);
  });

  it("names a software renderer and says hardware acceleration is off", () => {
    for (const renderer of [
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
      "llvmpipe (LLVM 15.0.7, 256 bits)",
      "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)",
    ]) {
      const notices = deviceNotices({ renderer, finePointer: true });
      expect(notices.map((n) => n.id), renderer).toEqual(["software"]);
      expect(notices[0]!.text).toMatch(/hardware acceleration/i);
    }
  });

  it("tells a touch-only device that the game needs a keyboard and mouse", () => {
    const notices = deviceNotices({ renderer: "Adreno (TM) 740", finePointer: false });
    expect(notices.map((n) => n.id)).toEqual(["touch"]);
    expect(notices[0]!.text).toMatch(/keyboard and mouse/i);
  });

  it("says both on a phone that draws in software", () => {
    expect(deviceNotices({ renderer: "SwiftShader", finePointer: false }).map((n) => n.id)).toEqual(["touch", "software"]);
  });
});

describe("probeDevice", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads a touch-only device off any-pointer", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q !== "(any-pointer: fine)" }));
    expect(probeDevice("x").finePointer).toBe(false);
  });

  it("a laptop with a touch screen still has a fine pointer", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    expect(probeDevice("x").finePointer).toBe(true);
  });

  it("assumes a mouse where media queries cannot be asked", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(probeDevice("x")).toEqual({ renderer: "x", finePointer: true });
  });
});
