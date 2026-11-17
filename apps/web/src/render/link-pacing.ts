/**
 * First-visit shader links, finalized in link order, a task's worth at a time.
 *
 * Chrome answers KHR_parallel_shader_compile's COMPLETION_STATUS before its GPU
 * process has compiled, and that process compiles the linked programs one after
 * another in link order (~0.4 s per lit, skinned PBR program on a cold cache).
 * Babylon's first uniform query on a program then waits for every program linked
 * before it, and a warm-up's 27 programs all finalized in one task: one frame
 * frozen for 9-12 s. Every link still goes to the GPU at once, so its queue never
 * runs dry; a program finalizes only after the ones linked before it, and only
 * while the task has spent under `budgetMs`, so a task waits for one program at most.
 *
 * Wraps two Babylon internals (`_preparePipelineContextAsync`,
 * `_isRenderingStateCompiled`); an engine without them is left alone.
 */
import type { Engine } from "@babylonjs/core/Engines/engine";

export interface LinkPacing {
  /** Programs linked and not yet finalized. */
  pending(): number;
  /**
   * While on, every effect created is HELD: its program links, so the GPU process
   * compiles it, but nothing finalizes it and it waits outside the line until
   * `release`. Decided when the effect is created, because Babylon links after an
   * await and polls on a 16 ms timer of its own, outside any render.
   */
  hold(on: boolean): void;
  /** Run `fn` (the menu's own render) with any effect it creates left unheld. */
  exempt<T>(fn: () => T): T;
  /** Programs linked under a hold and not yet released. */
  held(): number;
  /** Back into the line in link order, ahead of anything linked since; ends the hold. */
  release(): void;
}

interface PipelineContext {
  isParallelCompiled?: boolean;
  _isDisposed?: boolean;
  /** The effect's key, stamped by Babylon before the link (`createAndPreparePipelineContext`). */
  _name?: string;
}

type Prepare = (ctx: PipelineContext, ...rest: unknown[]) => void;
type Compiled = (ctx: PipelineContext) => boolean;
type CreateEffect = (...args: unknown[]) => { _key?: string };

interface Hooks {
  _preparePipelineContextAsync?: Prepare;
  _isRenderingStateCompiled?: Compiled;
  createEffect?: CreateEffect;
}

/** How Babylon names a program after its effect's key. */
const programName = (key: string): string => key.replace(/\r/g, "").replace(/\n/g, "|");

export function paceShaderLinks(
  engine: Engine,
  { budgetMs = 30, releaseMs = 2000, now = () => performance.now() }:
    { budgetMs?: number; releaseMs?: number; now?: () => number } = {},
): LinkPacing {
  const hooks = engine as unknown as Hooks;
  const prepare = hooks._preparePipelineContextAsync;
  const compiled = hooks._isRenderingStateCompiled;
  const create = hooks.createEffect;
  if (typeof prepare !== "function" || typeof compiled !== "function" || typeof create !== "function") {
    return { pending: () => 0, hold: () => {}, exempt: (fn) => fn(), held: () => 0, release: () => {} };
  }

  /** Linked and not yet finalized, oldest first. */
  const order: PipelineContext[] = [];
  const inLine = new Set<PipelineContext>();
  /** Link order, so a release can put held programs back where the GPU queued them. */
  const linkSeq = new WeakMap<PipelineContext, number>();
  let nextSeq = 0;
  let holding = false;
  let exempting = false;
  /** Effects seen, so a cache hit is never mistaken for a new effect. */
  const seen = new WeakSet<object>();
  const heldNames = new Set<string>();
  const heldSet = new Set<PipelineContext>();
  /** When the oldest became the oldest: one that is never polled again is let go after `releaseMs`. */
  let frontSince = now();
  /** Time this task spent finalizing; a timer resets it, so it never carries into the next task. */
  let spent = 0;
  let resetPending = false;

  const dropFront = (): void => {
    inLine.delete(order.shift()!);
    frontSince = now();
  };

  hooks.createEffect = (...args) => {
    const effect = create.apply(engine, args);
    if (!seen.has(effect)) {
      seen.add(effect);
      if (holding && !exempting && effect._key !== undefined) heldNames.add(programName(effect._key));
    }
    return effect;
  };
  hooks._preparePipelineContextAsync = (ctx, ...rest) => {
    if (order.length === 0) frontSince = now();
    prepare.call(engine, ctx, ...rest);
    if (!ctx.isParallelCompiled) return;
    linkSeq.set(ctx, nextSeq++);
    if (ctx._name !== undefined && heldNames.has(ctx._name)) heldSet.add(ctx);
    else { order.push(ctx); inLine.add(ctx); }
  };
  hooks._isRenderingStateCompiled = (ctx) => {
    if (heldSet.has(ctx)) return false;
    while (order.length > 0 && order[0] !== ctx && (order[0]!._isDisposed || now() - frontSince >= releaseMs)) dropFront();
    const tracked = inLine.has(ctx);
    if (tracked && (order[0] !== ctx || spent >= budgetMs)) return false;
    const t = now();
    let ok = false;
    let threw = true;
    try {
      ok = compiled.call(engine, ctx);
      threw = false;
    } finally {
      if (tracked) {
        spent += now() - t;
        if (!resetPending) {
          resetPending = true;
          setTimeout(() => { spent = 0; resetPending = false; }, 0);
        }
        // A finalize that throws (a compile error) leaves the line too.
        if (ok || threw) dropFront();
      }
    }
    return ok;
  };

  return {
    pending: () => order.length,
    hold: (on) => { holding = on; },
    exempt: (fn) => {
      const was = exempting;
      exempting = true;
      try { return fn(); } finally { exempting = was; }
    },
    held: () => heldSet.size,
    release: () => {
      holding = false;
      heldNames.clear();
      const back = [...heldSet].filter((c) => !c._isDisposed);
      heldSet.clear();
      for (const c of back) inLine.add(c);
      order.push(...back);
      order.sort((a, b) => linkSeq.get(a)! - linkSeq.get(b)!);
      frontSince = now();
    },
  };
}
