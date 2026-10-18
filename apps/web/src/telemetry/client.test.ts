// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { MAX_EVENTS, parseBatch, type Batch } from "@exiled/telemetry";
import { createTelemetry, type Transport } from "./client";
import { createErrorReporter } from "./errors";

function rig(over: { visible?: () => boolean; enabled?: boolean } = {}) {
  let clock = 0;
  let vis = true;
  const sent: { via: "beacon" | "send"; batch: Batch }[] = [];
  const transport: Transport = {
    beacon: (_u, body) => { sent.push({ via: "beacon", batch: JSON.parse(body) }); return true; },
    send: (_u, body) => { sent.push({ via: "send", batch: JSON.parse(body) }); },
  };
  const t = createTelemetry({
    build: "0.3.1+abc", builtAt: 123, transport, now: () => clock,
    visible: over.visible ?? (() => vis), enabled: over.enabled,
  });
  return { t, sent, advance: (ms: number) => { clock += ms; }, hide: () => { vis = false; t._onVisibility(); }, show: () => { vis = true; t._onVisibility(); } };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (navigator as unknown as Record<string, unknown>).globalPrivacyControl;
  Object.defineProperty(navigator, "doNotTrack", { value: null, configurable: true });
});

describe("telemetry client", () => {
  it("stamps t, sequences batches and sends a header the server parses", () => {
    const { t, sent, advance } = rig();
    advance(1500);
    t.track({ k: "view", view: "menu" });
    t.flush();
    t.track({ k: "view", view: "game" });
    t.flush();
    expect(sent.map((s) => s.batch.seq)).toEqual([0, 1]);
    expect(sent[0]!.batch.events[0]).toMatchObject({ k: "view", t: 1500 });
    const parsed = parseBatch(JSON.parse(JSON.stringify(sent[0]!.batch)));
    expect(parsed.ok).toBe(true);
    expect(sent[0]!.batch).toMatchObject({ v: 1, build: "0.3.1+abc", builtAt: 123 });
    expect(sent[0]!.via).toBe("send");
  });

  it("splits at MAX_EVENTS and keeps only the newest 500", () => {
    const { t, sent } = rig();
    for (let i = 0; i < 520; i++) t.track({ k: "level", level: i });
    t.flush();
    const all = sent.flatMap((s) => s.batch.events);
    expect(all.length).toBe(500);
    expect(all[0]).toMatchObject({ level: 20 });
    expect(sent.every((s) => s.batch.events.length <= MAX_EVENTS)).toBe(true);
  });

  it("a beat counts visible seconds only and carries fps and context", () => {
    const { t, sent, advance, hide, show } = rig();
    t.setContext(() => ({ area: "map", biome: "strand", tier: 3, level: 12, classId: "class.ember" }));
    for (const f of [60, 60, 60, 30, 60]) t.fps(f);
    advance(10_000);
    hide();
    advance(100_000);
    show();
    advance(5_000);
    t._onPageHide();
    const beats = sent.flatMap((s) => s.batch.events).filter((e) => e.k === "beat");
    expect(beats[0]).toMatchObject({ active: 10, fps: 60, fpsLow: 30, area: "map", biome: "strand", tier: 3, level: 12, classId: "class.ember" });
    expect(beats[1]).toMatchObject({ active: 5 });
  });

  it("hidden flush goes by beacon and pagehide adds end", () => {
    const { t, sent, advance, hide } = rig();
    advance(1000);
    hide();
    expect(sent[0]!.via).toBe("beacon");
    t._onPageHide();
    const last = sent[sent.length - 1]!.batch.events;
    expect(last[last.length - 1]!.k).toBe("end");
  });

  it("beat hooks run before the beat so loot lands in the same batch", () => {
    const { t, sent } = rig();
    t.addBeatHook(() => t.track({ k: "loot", normal: 1, magic: 0, rare: 0, unique: 0 }));
    t._onPageHide();
    expect(sent[0]!.batch.events.map((e) => e.k)).toEqual(["loot", "beat", "end"]);
  });

  it("stays silent under Global Privacy Control and Do Not Track", () => {
    (navigator as unknown as Record<string, unknown>).globalPrivacyControl = true;
    const a = rig();
    a.t.track({ k: "end" });
    a.t.flush();
    expect(a.sent).toEqual([]);
    delete (navigator as unknown as Record<string, unknown>).globalPrivacyControl;
    Object.defineProperty(navigator, "doNotTrack", { value: "1", configurable: true });
    const b = rig();
    b.t.track({ k: "end" });
    b.t.flush();
    expect(b.sent).toEqual([]);
  });

  it("the config kill switch drops the queue and stops sending", () => {
    const { t, sent } = rig();
    t.track({ k: "end" });
    t.setEnabled(false);
    t.track({ k: "end" });
    t.flush();
    expect(sent).toEqual([]);
  });

  it("never throws when the transport does", () => {
    const t = createTelemetry({
      build: "b", builtAt: 1, now: () => 0,
      transport: { beacon: () => { throw new Error("x"); }, send: () => { throw new Error("y"); } },
    });
    t.track({ k: "end" });
    expect(() => t.flush(true)).not.toThrow();
  });
});

describe("error reporter", () => {
  it("counts the same message and stack once per 60 s", () => {
    const track = vi.fn();
    let now = 0;
    const report = createErrorReporter({ track } as never, () => now);
    report("window", "boom", "at x");
    report("window", "boom", "at x");
    report("window", "other", "at x");
    now = 61_000;
    report("window", "boom", "at x");
    expect(track).toHaveBeenCalledTimes(3);
    expect(track.mock.calls[0]![0]).toMatchObject({ k: "error", src: "window", msg: "boom", stack: "at x" });
  });
});
