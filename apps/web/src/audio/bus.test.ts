import { describe, it, expect, vi, afterEach } from "vitest";
import { bus, urlVolumeScale, roomImpulse, effectiveWet, type RoomProfile } from "./bus";

describe("the master ceiling", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("puts a hard limiter between the master gain and the speakers", () => {
    const destination = { name: "destination" };
    const edges: Array<[unknown, unknown]> = [];
    const node = (extra: object = {}) => {
      const n: Record<string, unknown> = { ...extra };
      n["connect"] = (to: unknown) => { edges.push([n, to]); return to; };
      return n;
    };
    const p = (value = 0) => ({ value, setTargetAtTime: () => {} });
    const limiters: Array<Record<string, { value: number }>> = [];
    class FakeContext {
      state = "running";
      currentTime = 0;
      sampleRate = 8000;
      destination = destination;
      createGain() { return node({ gain: p(1) }); }
      createConvolver() { return node({ buffer: null }); }
      createBiquadFilter() { return node({ type: "", frequency: p(), gain: p() }); }
      createBuffer(ch: number, len: number) { return { copyToChannel: () => {}, numberOfChannels: ch, length: len }; }
      createDynamicsCompressor() {
        const c = node({ threshold: p(-24), knee: p(30), ratio: p(12), attack: p(0.003), release: p(0.25) });
        limiters.push(c as unknown as Record<string, { value: number }>);
        return c;
      }
    }
    vi.stubGlobal("AudioContext", FakeContext);
    if (typeof window === "undefined") vi.stubGlobal("window", { AudioContext: FakeContext });
    expect(bus()).not.toBeNull();

    expect(limiters).toHaveLength(1);
    const limiter = limiters[0]!;
    expect(limiter["threshold"]!.value).toBe(-6);
    expect(limiter["knee"]!.value).toBe(0);
    expect(limiter["ratio"]!.value).toBe(20);
    expect(limiter["attack"]!.value).toBe(0.003);
    expect(limiter["release"]!.value).toBe(0.25);
    // The only thing that reaches the speakers is the limiter.
    const intoSpeakers = edges.filter(([, to]) => to === destination).map(([from]) => from);
    expect(intoSpeakers).toEqual([limiter]);
  });
});

describe("urlVolumeScale", () => {
  it("reads ?volume= as a percentage, defaults a bot run to 10%, leaves play alone", () => {
    expect(urlVolumeScale("?play&volume=25")).toBe(0.25);
    expect(urlVolumeScale("?play&bot")).toBe(0.1);
    expect(urlVolumeScale("?play&bot&volume=50")).toBe(0.5);
    expect(urlVolumeScale("?play")).toBe(1);
    expect(urlVolumeScale("?volume=900")).toBe(1);
    expect(urlVolumeScale("?volume=abc")).toBe(1);
  });
});

const PROFILE: RoomProfile = {
  amount: 1, seconds: 1, decay: 2, preDelay: 0.02, reflections: 4,
  wetFloor: 0.15, airHz: 6000, airDb: -2,
};

describe("roomImpulse", () => {
  const rate = 8000;
  const ir = roomImpulse(rate, PROFILE);
  const pre = Math.round(PROFILE.preDelay * rate);
  const energy = (d: Float32Array, from: number, to: number): number => {
    let e = 0;
    for (let i = from; i < to; i++) e += d[i]! * d[i]!;
    return e;
  };

  it("is two channels of (preDelay + seconds) long, silent through the pre-delay", () => {
    expect(ir).toHaveLength(2);
    for (const ch of ir) {
      expect(ch).toHaveLength(Math.round((PROFILE.preDelay + PROFILE.seconds) * rate));
      for (let i = 0; i < pre; i++) expect(ch[i]).toBe(0);
    }
  });

  it("decays: the last tenth carries far less than the first tenth after the pre-delay", () => {
    const d = ir[0]!;
    const span = d.length - pre;
    const head = energy(d, pre, pre + Math.floor(span / 10));
    const tail = energy(d, d.length - Math.floor(span / 10), d.length);
    expect(tail).toBeLessThan(head * 0.01);
  });

  it("is deterministic, and the channels differ", () => {
    const again = roomImpulse(rate, PROFILE);
    expect(Array.from(again[0]!)).toEqual(Array.from(ir[0]!));
    expect(Array.from(ir[1]!)).not.toEqual(Array.from(ir[0]!));
  });
});

describe("effectiveWet", () => {
  it("floors world cues, and only world cues", () => {
    for (const c of ["skills", "loot", "environment"] as const) {
      expect(effectiveWet(0.03, c, PROFILE)).toBe(0.15);
    }
    for (const c of ["interface", "music", null] as const) {
      expect(effectiveWet(0.03, c, PROFILE)).toBe(0.03);
    }
  });

  it("multiplies by the room amount and clamps to 1", () => {
    const big = { ...PROFILE, amount: 2 };
    expect(effectiveWet(0.3, "skills", big)).toBeCloseTo(0.6, 10);
    expect(effectiveWet(0.3, "music", big)).toBeCloseTo(0.6, 10);
    expect(effectiveWet(0.9, "loot", big)).toBe(1);
    expect(effectiveWet(0.9, null, big)).toBe(1);
  });
});
