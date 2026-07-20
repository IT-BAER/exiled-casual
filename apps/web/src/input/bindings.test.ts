// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { attachBindings } from "./bindings";
import type { Scene } from "@babylonjs/core";

// Minimal fake scene: every pick hits the ground at a fixed world point.
function fakeScene(): Scene {
  return { pick: () => ({ hit: true, pickedPoint: { x: 1, z: 2 } }) } as unknown as Scene;
}

function moveToCount(post: ReturnType<typeof vi.fn>): number {
  return post.mock.calls.filter(
    (c) => c[0]?.type === "intent" && c[0]?.intent?.kind === "moveTo",
  ).length;
}

describe("attachBindings hold-to-move", () => {
  let canvas: HTMLCanvasElement;
  let worker: { postMessage: ReturnType<typeof vi.fn> };
  let detach: () => void;

  beforeEach(() => {
    canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    worker = { postMessage: vi.fn() };
    detach = attachBindings(canvas, worker as unknown as Worker, fakeScene());
  });

  afterEach(() => {
    detach();
    canvas.remove();
  });

  function pointer(type: string, button = 0, target: EventTarget = canvas) {
    target.dispatchEvent(
      new MouseEvent(type, { button, clientX: 50, clientY: 50, bubbles: true }),
    );
  }

  it("moves to the cursor on left pointer down", () => {
    pointer("pointerdown");
    expect(moveToCount(worker.postMessage)).toBe(1);
  });

  it("keeps re-targeting while the button is held and the cursor moves", () => {
    pointer("pointerdown");
    pointer("pointermove");
    pointer("pointermove");
    expect(moveToCount(worker.postMessage)).toBe(3); // down + 2 held moves
  });

  it("does not move on pointermove when the button is not held", () => {
    pointer("pointermove");
    pointer("pointermove");
    expect(moveToCount(worker.postMessage)).toBe(0);
  });

  it("stops re-targeting after the button is released", () => {
    pointer("pointerdown");
    pointer("pointerup", 0, window); // release may land outside the canvas
    pointer("pointermove");
    expect(moveToCount(worker.postMessage)).toBe(1); // only the initial down
  });

  it("ignores non-left buttons", () => {
    pointer("pointerdown", 2);
    pointer("pointermove");
    expect(moveToCount(worker.postMessage)).toBe(0);
  });

  it("r key posts a reset message", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "reset" });
  });
});
