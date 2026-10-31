import { describe, expect, it } from "vitest";
import { MAX_BATCH_BYTES, MAX_EVENTS, parseBatch, type Batch } from "./events";

const sid = "0f8e2b9c-6c1d-4f7a-9e3b-2a5d8c7f1e40";

function batch(events: unknown[], extra: Record<string, unknown> = {}): unknown {
  return { v: 1, sid, build: "0.3.1+abc1234", builtAt: 1_760_000_000_000, seq: 0, events, ...extra };
}

describe("parseBatch", () => {
  it("accepts a start and a beat", () => {
    const r = parseBatch(batch([
      { k: "start", t: 0, screen: "1920x1080", dpr: 1.25, gpu: "ANGLE (NVIDIA)", lang: "de-AT", ref: "reddit.com", pwa: false, cores: 8, memGb: 16, touch: false },
      { k: "beat", t: 30_000, view: "game", active: 30, fps: 58, area: "map", biome: "desert", tier: 2, level: 7, classId: "ironsworn" },
    ]));
    expect(r.ok).toBe(true);
    const b = (r as { ok: true; batch: Batch }).batch;
    expect(b.events).toHaveLength(2);
    expect(b.events[1]).toMatchObject({ k: "beat", fps: 58, tier: 2 });
  });

  it("rejects a wrong version, a bad session id and a non-array", () => {
    expect(parseBatch(batch([], { v: 2 })).ok).toBe(false);
    expect(parseBatch(batch([], { sid: "../../etc" })).ok).toBe(false);
    expect(parseBatch({ v: 1, sid, build: "x", builtAt: 0, seq: 0, events: "no" }).ok).toBe(false);
    expect(parseBatch(null).ok).toBe(false);
  });

  it("drops unknown event kinds and malformed events instead of failing the batch", () => {
    const r = parseBatch(batch([
      { k: "hack", t: 1 },
      { k: "beat", t: "soon" },
      { k: "level", t: 5, level: 3 },
    ]));
    expect(r.ok).toBe(true);
    const b = (r as { ok: true; batch: Batch }).batch;
    expect(b.events).toEqual([{ k: "level", t: 5, level: 3 }]);
    expect(b.dropped).toBe(2);
  });

  it("clips strings so a client cannot store a novel", () => {
    const long = "x".repeat(10_000);
    const r = parseBatch(batch([{ k: "error", t: 1, src: "window", msg: long, stack: long }]));
    const e = (r as { ok: true; batch: Batch }).batch.events[0] as { msg: string; stack: string };
    expect(e.msg.length).toBeLessThanOrEqual(500);
    expect(e.stack.length).toBeLessThanOrEqual(4000);
  });

  it("caps the number of events", () => {
    const many = Array.from({ length: MAX_EVENTS + 20 }, (_, i) => ({ k: "level", t: i, level: 2 }));
    const b = (parseBatch(batch(many)) as { ok: true; batch: Batch }).batch;
    expect(b.events).toHaveLength(MAX_EVENTS);
    expect(b.dropped).toBe(20);
  });

  it("refuses enums outside their set", () => {
    const r = parseBatch(batch([
      { k: "area", t: 1, area: "moon" },
      { k: "loot", t: 2, normal: 3, magic: 1, rare: 0, unique: -4 },
      { k: "charAge", t: 3, classId: "ironsworn", level: 4, ageDays: "7-29" },
    ]));
    const b = (r as { ok: true; batch: Batch }).batch;
    expect(b.events.map((e) => e.k)).toEqual(["charAge"]);
  });

  it("accepts the retention-gap events, each in its enum and nothing more", () => {
    const sent = [
      { k: "device", t: 1, action: "open" },
      { k: "atlas", t: 2, node: "node.the_wrackline", tier: 1, stone: 1 },
      { k: "portal", t: 3, to: "map" },
      { k: "rareSeen", t: 4, tier: 1, biome: "strand" },
      { k: "rareKill", t: 5, tier: 1 },
      { k: "bossSeen", t: 6, tier: 2, biome: "desert" },
      { k: "bossFight", t: 7, tier: 2 },
      { k: "respawn", t: 8, where: "checkpoint" },
      { k: "createFail", t: 9, reason: "charset" },
      { k: "reload", t: 10, reason: "chunk" },
      { k: "loadPhase", t: 11, phase: "shaders", ms: 8970 },
      { k: "end", t: 12, view: "game", area: "map", loading: true },
      { k: "end", t: 13 },
      { k: "roster", t: 14, characters: 1, oldestAge: "2-6", maxLevel: 7 },
      { k: "roster", t: 15, characters: 0 },
      { k: "beat", t: 16, view: "game", active: 30, caches: 2 },
    ];
    const b = (parseBatch(batch(sent)) as { ok: true; batch: Batch }).batch;
    expect(b.dropped).toBe(0);
    expect(b.events).toEqual(sent);
  });

  it("refuses the new events outside their sets, and never carries a name", () => {
    const r = parseBatch(batch([
      { k: "device", t: 1, action: "hack" },
      { k: "portal", t: 2, to: "moon" },
      { k: "respawn", t: 3, where: "anywhere" },
      { k: "createFail", t: 4, reason: "short", name: "Jürgen" },
      { k: "reload", t: 5, reason: "boredom" },
      { k: "loadPhase", t: 6, phase: "vibes", ms: 1 },
      { k: "loadPhase", t: 7, phase: "models", ms: -1 },
      { k: "roster", t: 8, characters: 2, oldestAge: "ancient" },
      { k: "end", t: 9, view: "lobby", loading: "yes" },
    ]));
    const b = (r as { ok: true; batch: Batch }).batch;
    // The create failure survives without the name it was sent with; a bad optional on end is dropped, not fatal.
    expect(b.events).toEqual([
      { k: "createFail", t: 4, reason: "short" },
      { k: "roster", t: 8, characters: 2 },
      { k: "end", t: 9 },
    ]);
  });

  it("states a byte budget the server enforces before parsing", () => {
    expect(MAX_BATCH_BYTES).toBeGreaterThan(1024);
  });
});
