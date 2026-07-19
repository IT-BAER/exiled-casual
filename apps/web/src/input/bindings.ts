import type { Intent, ToWorker } from "@pact/protocol";
import { keyToIntent, pointerToWorld } from "./intents";
import type { Scene } from "@babylonjs/core";

// ponytail: thin DOM glue — all key→intent mapping lives in intents.ts

/**
 * Current aim in RAW world floats (sim x, sim y=Babylon z), updated on pointermove
 * via ground-plane raycast. Raw (not fixed-point) because keyToIntent applies fp()
 * itself — pre-converting here would double-scale the skill target ~1000×.
 */
let aimWorld = { x: 0, y: 0 };

const MOVE_KEYS = new Set(["w", "a", "s", "d"]);

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
  // Movement keys currently held, oldest→newest. Needed so releasing one key
  // resumes another still-held direction, and releasing the last sends "stop".
  const held: string[] = [];

  function post(intent: Intent) {
    const msg: ToWorker = { type: "intent", intent };
    worker.postMessage(msg);
  }

  function onKeyDown(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (MOVE_KEYS.has(k) && !held.includes(k)) held.push(k);
    const intent = keyToIntent(e.key, aimWorld);
    if (intent) post(intent);
  }

  function onKeyUp(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (!MOVE_KEYS.has(k)) return;
    const i = held.indexOf(k);
    if (i !== -1) held.splice(i, 1);
    const last = held[held.length - 1];
    if (last) {
      // Resume the most-recent still-held direction so multi-key movement
      // doesn't stall when one key is released.
      const resume = keyToIntent(last, aimWorld);
      if (resume) post(resume);
    } else {
      post({ kind: "stop" });
    }
  }

  function onPointerMove(e: PointerEvent) {
    const pick = scene.pick(e.clientX, e.clientY);
    if (pick.hit && pick.pickedPoint) {
      // Raw world floats; keyToIntent applies fp() when building the skill target.
      aimWorld = { x: pick.pickedPoint.x, y: pick.pickedPoint.z };
    }
  }

  function onClick(e: MouseEvent) {
    const pick = scene.pick(e.clientX, e.clientY);
    if (pick.hit && pick.pickedPoint) {
      const world = pointerToWorld({
        x: pick.pickedPoint.x,
        z: pick.pickedPoint.z,
      });
      post({ kind: "moveTo", x: world.x, y: world.y });
    }
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("click", onClick);

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("click", onClick);
  };
}
