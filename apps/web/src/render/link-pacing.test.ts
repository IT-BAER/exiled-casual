import { describe, it, expect, vi, afterEach } from "vitest";
import { Observable } from "@babylonjs/core/Misc/observable";
import type { Engine } from "@babylonjs/core/Engines/engine";
import { paceShaderLinks } from "./link-pacing";

interface Ctx { name: string; isParallelCompiled: boolean; _isDisposed: boolean }

/**
 * The two Babylon engine hooks the pacing wraps, faked: a "link" is recorded,
 * and a program reports compiled once the test says so, costing `finalizeMs`
 * on the fake clock the way Chrome's first uniform query blocks.
 */
function fakeEngine(finalizeMs = 0) {
  let clock = 0;
  const linked: string[] = [];
  const finalized: string[] = [];
  const done = new Set<string>();
  const engine = {
    onBeginFrameObservable: new Observable<unknown>(),
    _preparePipelineContextAsync(ctx: Ctx) { linked.push(ctx.name); },
    _isRenderingStateCompiled(ctx: Ctx) {
      if (!done.has(ctx.name)) return false;
      clock += finalizeMs;
      finalized.push(ctx.name);
      return true;
    },
  };
  const ctx = (name: string, parallel = true): Ctx => ({ name, isParallelCompiled: parallel, _isDisposed: false });
  return {
    engine, linked, finalized, done, ctx,
    now: () => clock,
    tick: (ms: number) => { clock += ms; },
    prepare: (c: Ctx) => engine._preparePipelineContextAsync(c),
    compiled: (c: Ctx) => engine._isRenderingStateCompiled(c),
  };
}

afterEach(() => { vi.useRealTimers(); });

describe("paceShaderLinks", () => {
  it("hands every link to the GPU at once, so its queue never runs dry", () => {
    const f = fakeEngine();
    const pacing = paceShaderLinks(f.engine as unknown as Engine, { now: f.now });
    for (const n of ["a", "b", "c"]) f.prepare(f.ctx(n));
    expect(f.linked).toEqual(["a", "b", "c"]);
    expect(pacing.pending()).toBe(3);
  });

  it("finalizes in link order: a program never waits behind ones linked before it", () => {
    const f = fakeEngine();
    const pacing = paceShaderLinks(f.engine as unknown as Engine, { now: f.now });
    const [a, b] = [f.ctx("a"), f.ctx("b")];
    f.prepare(a);
    f.prepare(b);
    f.done.add("a");
    f.done.add("b");
    expect(f.compiled(b)).toBe(false);
    expect(f.compiled(a)).toBe(true);
    expect(f.compiled(b)).toBe(true);
    expect(f.finalized).toEqual(["a", "b"]);
    expect(pacing.pending()).toBe(0);
  });

  it("after a slow finalize spends the task's budget, the next one waits for a later task", () => {
    vi.useFakeTimers();
    const f = fakeEngine(400);
    paceShaderLinks(f.engine as unknown as Engine, { now: f.now, budgetMs: 30 });
    const [a, b] = [f.ctx("a"), f.ctx("b")];
    f.prepare(a);
    f.prepare(b);
    f.done.add("a");
    f.done.add("b");
    expect(f.compiled(a)).toBe(true);
    expect(f.compiled(b)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(f.compiled(b)).toBe(true);
  });

  it("cheap finalizes go several per task", () => {
    const f = fakeEngine(1);
    paceShaderLinks(f.engine as unknown as Engine, { now: f.now, budgetMs: 30 });
    const cs = ["a", "b", "c", "d"].map((n) => f.ctx(n));
    for (const c of cs) { f.prepare(c); f.done.add(c.name); }
    for (const c of cs) expect(f.compiled(c)).toBe(true);
  });

  it("a disposed program ahead in line never stalls the ones behind it", () => {
    const f = fakeEngine();
    const pacing = paceShaderLinks(f.engine as unknown as Engine, { now: f.now });
    const [a, b] = [f.ctx("a"), f.ctx("b")];
    f.prepare(a);
    f.prepare(b);
    a._isDisposed = true;
    f.done.add("b");
    expect(f.compiled(b)).toBe(true);
    expect(pacing.pending()).toBe(0);
  });

  it("lets a program ahead in line go once it has waited releaseMs at the front", () => {
    const f = fakeEngine();
    paceShaderLinks(f.engine as unknown as Engine, { now: f.now, releaseMs: 2000 });
    const [a, b] = [f.ctx("a"), f.ctx("b")];
    f.prepare(a);
    f.prepare(b);
    f.done.add("b");
    expect(f.compiled(b)).toBe(false);
    f.tick(1999);
    expect(f.compiled(b)).toBe(false);
    f.tick(2);
    expect(f.compiled(b)).toBe(true);
  });

  it("does not track a program that compiles synchronously", () => {
    const f = fakeEngine();
    const pacing = paceShaderLinks(f.engine as unknown as Engine, { now: f.now });
    f.prepare(f.ctx("a", false));
    expect(pacing.pending()).toBe(0);
  });

  it("leaves an engine without the hooks untouched", () => {
    const engine = { onBeginFrameObservable: new Observable<unknown>() };
    const pacing = paceShaderLinks(engine as unknown as Engine);
    expect(Object.keys(engine)).toEqual(["onBeginFrameObservable"]);
    expect(pacing.pending()).toBe(0);
  });
});
