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
}

interface PipelineContext {
  isParallelCompiled?: boolean;
  _isDisposed?: boolean;
}

type Prepare = (ctx: PipelineContext, ...rest: unknown[]) => void;
type Compiled = (ctx: PipelineContext) => boolean;

interface Hooks {
  _preparePipelineContextAsync?: Prepare;
  _isRenderingStateCompiled?: Compiled;
}

export function paceShaderLinks(
  engine: Engine,
  { budgetMs = 30, releaseMs = 2000, now = () => performance.now() }:
    { budgetMs?: number; releaseMs?: number; now?: () => number } = {},
): LinkPacing {
  const hooks = engine as unknown as Hooks;
  const prepare = hooks._preparePipelineContextAsync;
  const compiled = hooks._isRenderingStateCompiled;
  if (typeof prepare !== "function" || typeof compiled !== "function") return { pending: () => 0 };

  /** Linked and not yet finalized, oldest first. */
  const order: PipelineContext[] = [];
  const inLine = new Set<PipelineContext>();
  /** When the oldest became the oldest: one that is never polled again is let go after `releaseMs`. */
  let frontSince = now();
  /** Time this task spent finalizing; a timer resets it, so it never carries into the next task. */
  let spent = 0;
  let resetPending = false;

  const dropFront = (): void => {
    inLine.delete(order.shift()!);
    frontSince = now();
  };

  hooks._preparePipelineContextAsync = (ctx, ...rest) => {
    if (order.length === 0) frontSince = now();
    prepare.call(engine, ctx, ...rest);
    if (ctx.isParallelCompiled) { order.push(ctx); inLine.add(ctx); }
  };
  hooks._isRenderingStateCompiled = (ctx) => {
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

  return { pending: () => order.length };
}
