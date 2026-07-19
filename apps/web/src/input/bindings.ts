import type { ToWorker } from "@pact/protocol";
import { keyToIntent, pointerToWorld } from "./intents";
import type { Scene } from "@babylonjs/core";

// ponytail: thin DOM glue — no logic here; all mapping is in intents.ts

/** Current world-space aim (updated on pointermove via ground-plane raycast). */
let aimWorld = { x: 0, y: 0 };

/**
 * Attach keyboard + pointer listeners to the canvas.
 * Requires an initialised Babylon scene for ground-plane raycasting.
 * Returns a cleanup function.
 */
export function attachBindings(
  canvas: HTMLCanvasElement,
  worker: Worker,
  scene: Scene,
): () => void {
  function onKeyDown(e: KeyboardEvent) {
    const intent = keyToIntent(e.key, aimWorld);
    if (!intent) return;
    const msg: ToWorker = { type: "intent", intent };
    worker.postMessage(msg);
  }

  function onPointerMove(e: PointerEvent) {
    const pick = scene.pick(e.clientX, e.clientY);
    if (pick.hit && pick.pickedPoint) {
      aimWorld = pointerToWorld({
        x: pick.pickedPoint.x,
        z: pick.pickedPoint.z,
      });
    }
  }

  function onClick(e: MouseEvent) {
    const pick = scene.pick(e.clientX, e.clientY);
    if (pick.hit && pick.pickedPoint) {
      const world = pointerToWorld({
        x: pick.pickedPoint.x,
        z: pick.pickedPoint.z,
      });
      const msg: ToWorker = {
        type: "intent",
        intent: { kind: "moveTo", x: world.x, y: world.y },
      };
      worker.postMessage(msg);
    }
  }

  window.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("click", onClick);

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("click", onClick);
  };
}
