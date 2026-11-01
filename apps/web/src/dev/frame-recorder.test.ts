import { describe, it, expect, vi } from "vitest";
import { recordFrames } from "./frame-recorder";

/** A fake page: queued rAF callbacks run on `tick()`, the engine's among them. */
function page() {
  let queue: FrameRequestCallback[] = [];
  const win = { requestAnimationFrame(cb: FrameRequestCallback) { queue.push(cb); return queue.length; } };
  const raf = win.requestAnimationFrame;
  let end: (() => void) | null = null;
  const drawn: number[] = [];
  let frame = 0;
  const engine = (): void => { win.requestAnimationFrame(() => { frame++; end?.(); engine(); }); };
  const other = (): void => { win.requestAnimationFrame(() => other()); };
  const tick = () => { const q = queue; queue = []; for (const cb of q) cb(frame * 16); };
  const canvas = { width: 1920, height: 1080 } as HTMLCanvasElement;
  const makeCanvas = () => {
    const c = {
      width: 0, height: 0,
      getContext: () => ({ drawImage: vi.fn(() => drawn.push(frame)) }),
      toBlob: (cb: (b: Blob | null) => void, type: string, q: number) => cb(new Blob([`${type}:${q}:${c.width}x${c.height}`])),
    };
    return c as unknown as HTMLCanvasElement;
  };
  return { win, raf, canvas, makeCanvas, tick, engine, other, drawn, onFrameEnd: (cb: () => void) => { end = cb; return () => { end = null; }; } };
}

describe("recordFrames", () => {
  it("copies each engine frame once, inside the callback that drew it, then lets go of rAF", async () => {
    const p = page();
    p.engine();
    p.other();
    const first = vi.fn();
    const done = recordFrames({ win: p.win, canvas: p.canvas, onFrameEnd: p.onFrameEnd, makeCanvas: p.makeCanvas }, 3, 960, 0.8, first);
    expect(first).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 6; i++) p.tick();
    const blobs = await done;
    expect(blobs).toHaveLength(3);
    expect(await blobs[0]!.text()).toBe("image/jpeg:0.8:960x540");
    // Three consecutive engine frames, one copy each.
    expect(p.drawn).toEqual([2, 3, 4]);
    expect(p.win.requestAnimationFrame).toBe(p.raf);
  });
});
