import type { Intent, Snapshot, SpawnKind, ToWorker } from "@pact/protocol";
import { keyToIntent, pointerToWorld } from "./intents";
import type { Node, Scene } from "@babylonjs/core";

// ponytail: thin DOM glue — all key→intent mapping lives in intents.ts

/**
 * Lab spawn keys. Keyed on `event.code`, not `event.key`: the numpad digits
 * report the same `key` as the skill row, so only the code tells them apart.
 */
const SPAWN_KEYS: Record<string, SpawnKind> = {
  Numpad1: "imp",
  Numpad2: "pack",
  Numpad3: "rare",
  Numpad4: "boss",
  Numpad5: "hurtboss",
  Numpad0: "clear",
};

/**
 * Current aim in RAW world floats (sim x, sim y=Babylon z), updated on pointermove
 * via ground-plane raycast. Raw (not fixed-point) because keyToIntent applies fp()
 * itself — pre-converting here would double-scale the skill target ~1000×.
 */
let aimWorld = { x: 0, y: 0 };

const MOVE_KEYS = new Set(["w", "a", "s", "d"]);

/**
 * Walk the parent chain of a picked node to find an interactable root.
 * Portal and mapDevice roots carry `metadata.interactKind` set by their builders;
 * child geometry meshes do not, so the walk always terminates at the root or null.
 */
function findInteractRoot(node: Node | null): { entityId: number } | null {
  let n = node;
  while (n) {
    const meta = n.metadata as { interactKind?: string } | null;
    if (meta?.interactKind) {
      const match = n.name.match(/^entity-(\d+)$/);
      if (match) return { entityId: parseInt(match[1]!, 10) };
    }
    n = n.parent as Node | null;
  }
  return null;
}

/**
 * Attach keyboard + pointer listeners to the canvas.
 * Requires an initialised Babylon scene for ground-plane raycasting.
 *
 * `onHoverInteractable` fires when the hovered portal/mapDevice entity id changes
 * (including to null when leaving). Called at most once per distinct id change so
 * React does not re-render on every pixel of mouse movement.
 *
 * Returns `detach` (removes all listeners) and `onSnapshot` (feed each incoming
 * snapshot to check whether the queued interact target is now in range, and to
 * clear hover state for entities that have disappeared).
 */
export function attachBindings(
  canvas: HTMLCanvasElement,
  worker: Worker,
  scene: Scene,
  onCycleOutfit?: () => void,
  onHoverInteractable?: (entityId: number | null) => void,
): { detach: () => void; onSnapshot: (snap: Snapshot) => void } {
  // Movement keys currently held, oldest→newest. Needed so releasing one key
  // resumes another still-held direction, and releasing the last sends "stop".
  const held: string[] = [];
  // True while the left mouse button is down: hold-to-move keeps steering the
  // player toward the cursor, instead of a single click-to-point.
  let pointerHeld = false;
  // Last cursor screen position, so held-move can re-pick the world point every
  // snapshot. The camera follows the player, so a stationary cursor sits over a
  // DIFFERENT world point each frame — re-picking is what keeps the player moving
  // when the button is held without the mouse moving.
  let lastScreen: { x: number; y: number } | null = null;

  // Entity id of the portal or map device the player last clicked; null when
  // nothing is pending. Cleared on interact fire, entity disappearance, or a
  // subsequent non-interactable click (so clicking away cancels the approach).
  let pendingInteractId: number | null = null;

  // Currently hovered interactable entity id; null when the cursor is over ground.
  // Tracked here so we only fire the callback on actual changes.
  let hoveredEntityId: number | null = null;

  function setHover(id: number | null) {
    if (id === hoveredEntityId) return; // no change — avoid spurious re-renders
    hoveredEntityId = id;
    onHoverInteractable?.(id);
  }

  function post(intent: Intent) {
    const msg: ToWorker = { type: "intent", intent };
    worker.postMessage(msg);
  }

  function onKeyDown(e: KeyboardEvent) {
    // Checked before the skill row, which shares these keys' `key` values.
    const spawn = SPAWN_KEYS[e.code];
    if (spawn) {
      worker.postMessage({ type: "spawn", what: spawn } satisfies ToWorker);
      return;
    }
    const k = e.key.toLowerCase();
    // r = lab respawn: fresh player + monsters back at their spawn ring
    if (k === "r") {
      worker.postMessage({ type: "reset" } satisfies ToWorker);
      return;
    }
    // o = try on the next outfit. Render-only, the sim never hears about it.
    if (k === "o") {
      onCycleOutfit?.();
      return;
    }
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
    lastScreen = { x: e.clientX, y: e.clientY };
    // Single pick drives both the aim vector AND hover detection — no second raycast.
    const pick = scene.pick(e.clientX, e.clientY);
    if (pick.hit && pick.pickedPoint) {
      // Raw world floats; keyToIntent applies fp() when building the skill target.
      aimWorld = { x: pick.pickedPoint.x, y: pick.pickedPoint.z };
      // Hold-to-move: while the button is held, re-target toward the cursor so
      // dragging steers the player continuously (reuse this pick's world point).
      if (pointerHeld) {
        const world = pointerToWorld({ x: pick.pickedPoint.x, z: pick.pickedPoint.z });
        post({ kind: "moveTo", x: world.x, y: world.y });
      }
    }
    // Resolve hovered interactable from the same pick result.
    const interactable = pick.pickedMesh ? findInteractRoot(pick.pickedMesh) : null;
    setHover(interactable ? interactable.entityId : null);
  }

  function onPointerLeave() {
    setHover(null);
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return; // left button drives movement
    // Single pick per pointerdown — shared between the interactable and ground paths.
    const pick = scene.pick(e.clientX, e.clientY);
    if (!pick.hit || !pick.pickedPoint) return;
    const world = pointerToWorld({ x: pick.pickedPoint.x, z: pick.pickedPoint.z });
    // PoE-style: clicking directly on a portal or map device auto-walks to it and
    // queues an interact. Do NOT start hold-to-move steering for this case.
    const interactable = pick.pickedMesh ? findInteractRoot(pick.pickedMesh) : null;
    if (interactable) {
      post({ kind: "moveTo", x: world.x, y: world.y });
      pendingInteractId = interactable.entityId;
      return;
    }
    // Ground or other non-interactable click: normal move + cancel any queued interact.
    post({ kind: "moveTo", x: world.x, y: world.y });
    pendingInteractId = null;
    lastScreen = { x: e.clientX, y: e.clientY };
    pointerHeld = true;
  }

  function onPointerUp(e: PointerEvent) {
    if (e.button === 0) pointerHeld = false;
  }

  /**
   * Feed each incoming snapshot from the worker to this function.
   * When `pendingInteractId` is set and that entity reports `inRange`, fires
   * `{ kind: "interact", targetId }` exactly once and clears the pending state.
   * Also clears pending and hover state if the entity disappears from the snapshot.
   */
  function onSnapshot(snap: Snapshot): void {
    // Hold-to-move: while the button is held, re-pick the world point under the
    // cursor and steer there every snapshot. Because the camera tracks the player,
    // that point drifts as the player advances, so the player keeps moving in the
    // cursor's direction even when the mouse is perfectly still.
    if (pointerHeld && lastScreen) {
      const pick = scene.pick(lastScreen.x, lastScreen.y);
      if (pick.hit && pick.pickedPoint) {
        const world = pointerToWorld({ x: pick.pickedPoint.x, z: pick.pickedPoint.z });
        post({ kind: "moveTo", x: world.x, y: world.y });
      }
    }

    if (pendingInteractId !== null) {
      const entity = snap.entities.find((e) => e.id === pendingInteractId);
      if (!entity) {
        pendingInteractId = null; // entity vanished — cancel silently
      } else if (entity.inRange) {
        post({ kind: "interact", targetId: pendingInteractId });
        // Halt at interaction range. The moveTo that started the approach aims at
        // the entity itself, so without this the player keeps walking and ends up
        // standing inside the map device.
        post({ kind: "stop" });
        pendingInteractId = null;
      }
    }
    // Clear hover if the hovered entity left the snapshot.
    if (hoveredEntityId !== null) {
      const stillExists = snap.entities.some((e) => e.id === hoveredEntityId);
      if (!stillExists) setHover(null);
    }
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("pointerdown", onPointerDown);
  // Listen on window so releasing outside the canvas still ends hold-to-move.
  window.addEventListener("pointerup", onPointerUp);

  function detach() {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    canvas.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointerup", onPointerUp);
  }

  return { detach, onSnapshot };
}
