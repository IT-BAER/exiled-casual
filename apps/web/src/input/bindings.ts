import type { Intent, Snapshot, SpawnKind, ToWorker } from "@exiled/protocol";
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
  Numpad6: "item",
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
 * The point on the FLOOR under a screen pixel. `scene.pick` returns the first
 * mesh the ray meets, and a wall's top face stands 3.5 units up, so a click on
 * a wall resolved to that top corner: the player walked to a spot well short of
 * the cursor, and the further the wall, the bigger the lie. The floor is one
 * flat plane at y=0 (`engine.ts`), so meet it analytically instead — cheaper
 * than a second pick, and it cannot miss the way a mesh pick can.
 */
function groundPoint(
  scene: Scene,
  sx: number,
  sy: number,
): { x: number; z: number } | null {
  const ray = scene.createPickingRay(sx, sy, null, null);
  // Looking up or along the plane: there is no ground under that pixel.
  if (ray.direction.y >= -1e-6) return null;
  const t = -ray.origin.y / ray.direction.y;
  return {
    x: ray.origin.x + ray.direction.x * t,
    z: ray.origin.z + ray.direction.z * t,
  };
}

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
  onOpenPanel?: (open: boolean) => void,
  onOpenStash?: (open: boolean) => void,
  onOpenVendor?: (open: boolean) => void,
): {
  detach: () => void;
  onSnapshot: (snap: Snapshot) => void;
  approach: (entityId: number, x: number, y: number) => void;
} {
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
  // Kinds of furniture whose panel is open because the player walked up to it,
  // so the walk away can close it again.
  const openedNear = new Set<"mapDevice" | "stash" | "vendor">();

  // Currently hovered interactable entity id; null when the cursor is over ground.
  // Tracked here so we only fire the callback on actual changes.
  let hoveredEntityId: number | null = null;

  // Latest snapshot from the worker, so the `g` pickup keybind can find the
  // nearest in-range ground item without waiting on a dedicated intent round-trip.
  let latestSnap: Snapshot | null = null;

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
    // g = pick up the nearest in-range ground item (sim re-checks range).
    if (k === "g" && latestSnap) {
      const items = latestSnap.entities.filter((e) => e.kind === "groundItem" && e.inRange);
      if (items.length > 0) {
        const px = latestSnap.player.x, py = latestSnap.player.y;
        const nearest = items.reduce((a, b) =>
          (a.x - px) ** 2 + (a.y - py) ** 2 <= (b.x - px) ** 2 + (b.y - py) ** 2 ? a : b);
        post({ kind: "pickupItem", entityId: nearest.id });
      }
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
    const floor = groundPoint(scene, e.clientX, e.clientY);
    if (floor) {
      // Raw world floats; keyToIntent applies fp() when building the skill target.
      aimWorld = { x: floor.x, y: floor.z };
      // Hold-to-move: while the button is held, re-target toward the cursor so
      // dragging steers the player continuously.
      if (pointerHeld) {
        const world = pointerToWorld(floor);
        post({ kind: "moveTo", x: world.x, y: world.y });
      }
    }
    // Hover still asks the meshes — that question really is "what is under the
    // cursor", walls and all.
    const pick = scene.pick(e.clientX, e.clientY);
    const interactable = pick.pickedMesh ? findInteractRoot(pick.pickedMesh) : null;
    setHover(interactable ? interactable.entityId : null);
  }

  function onPointerLeave() {
    setHover(null);
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return; // left button drives movement
    const floor = groundPoint(scene, e.clientX, e.clientY);
    if (!floor) return;
    const world = pointerToWorld(floor);
    const pick = scene.pick(e.clientX, e.clientY);
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
    latestSnap = snap;
    // Hold-to-move: while the button is held, re-pick the world point under the
    // cursor and steer there every snapshot. Because the camera tracks the player,
    // that point drifts as the player advances, so the player keeps moving in the
    // cursor's direction even when the mouse is perfectly still.
    if (pointerHeld && lastScreen) {
      const floor = groundPoint(scene, lastScreen.x, lastScreen.y);
      if (floor) {
        const world = pointerToWorld(floor);
        post({ kind: "moveTo", x: world.x, y: world.y });
      }
    }

    if (pendingInteractId !== null) {
      const entity = snap.entities.find((e) => e.id === pendingInteractId);
      if (!entity) {
        pendingInteractId = null; // entity vanished — cancel silently
      } else if (entity.inRange) {
        // The map device opens the preparation panel (activation is a separate
        // activateMap intent sent from the panel); everything else interacts.
        if (entity.kind === "mapDevice") {
          onOpenPanel?.(true);
          openedNear.add("mapDevice");
        } else if (entity.kind === "stash") {
          onOpenStash?.(true);
          openedNear.add("stash");
        } else if (entity.kind === "vendor") {
          onOpenVendor?.(true);
          openedNear.add("vendor");
        } else if (entity.kind === "groundItem") {
          post({ kind: "pickupItem", entityId: pendingInteractId });
        } else {
          post({ kind: "interact", targetId: pendingInteractId });
        }
        // Halt at interaction range. The moveTo that started the approach aims at
        // the entity itself, so without this the player keeps walking and ends up
        // standing inside the map device.
        post({ kind: "stop" });
        pendingInteractId = null;
      }
    }

    // The furniture holds the panel open. Walk off and it shuts behind you, the
    // way PoE closes the stash, the vendor and the map device the moment the
    // character steps out of range: a panel left hanging covers the screen the
    // player just walked back into. Only what proximity opened is closed this
    // way, and only on the crossing, so shutting the stash with its X while
    // still standing at it stays shut instead of springing back open.
    for (const kind of openedNear) {
      if (snap.entities.some((e) => e.kind === kind && e.inRange)) continue;
      openedNear.delete(kind);
      if (kind === "mapDevice") onOpenPanel?.(false);
      else if (kind === "stash") onOpenStash?.(false);
      else onOpenVendor?.(false);
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

  /** Walk to an entity and act on it once the sim reports it inRange. Used by the
   *  DOM loot plates, which sit above the canvas and never reach its picker. */
  function approach(entityId: number, x: number, y: number) {
    pendingInteractId = entityId;
    post({ kind: "moveTo", x, y });
  }

  return { detach, onSnapshot, approach };
}
