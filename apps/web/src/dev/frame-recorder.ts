// DEV: consecutive rendered frames of the game canvas, read the only way a WebGL
// canvas without preserveDrawingBuffer can be read: inside the requestAnimationFrame
// callback that drew it (CLAUDE.md, Devlog). From a timeout the frame is black.

export interface FrameSource {
  /** The window whose requestAnimationFrame the engine queues its frames on. */
  win: { requestAnimationFrame(cb: FrameRequestCallback): number };
  canvas: HTMLCanvasElement;
  /** Subscribes to the engine's end of frame; returns the unsubscribe. */
  onFrameEnd(cb: () => void): () => void;
  /** A blank canvas to downscale into (tests pass a stub). */
  makeCanvas?(): HTMLCanvasElement;
}

/**
 * The next `count` frames the engine draws, each downscaled to `width` px wide and
 * encoded as JPEG at `quality`. requestAnimationFrame is wrapped for the duration:
 * after any callback in which the engine finished a frame, that frame is copied
 * before the callback returns. `onFirst` runs before the first frame is drawn.
 */
export function recordFrames(src: FrameSource, count: number, width: number, quality: number, onFirst?: () => void): Promise<Blob[]> {
  const { win, canvas } = src;
  const original = win.requestAnimationFrame;
  const blobs: Promise<Blob>[] = [];
  let drawn = false;
  const make = src.makeCanvas ?? (() => document.createElement("canvas"));
  return new Promise<Blob[]>((resolve, reject) => {
    if (count <= 0) { resolve([]); return; }
    const stopListening = src.onFrameEnd(() => { drawn = true; });
    const finish = () => {
      win.requestAnimationFrame = original;
      stopListening();
      Promise.all(blobs).then(resolve, reject);
    };
    const grab = () => {
      const out = make();
      out.width = Math.round(width);
      out.height = Math.max(1, Math.round((canvas.height * width) / Math.max(1, canvas.width)));
      out.getContext("2d")!.drawImage(canvas, 0, 0, out.width, out.height);
      blobs.push(new Promise<Blob>((ok, fail) => out.toBlob((b) => (b ? ok(b) : fail(new Error("toBlob"))), "image/jpeg", quality)));
    };
    onFirst?.();
    win.requestAnimationFrame = (cb: FrameRequestCallback) => original.call(win, (t: number) => {
      cb(t);
      if (!drawn || blobs.length >= count) return;
      drawn = false;
      grab();
      if (blobs.length >= count) finish();
    });
  });
}
