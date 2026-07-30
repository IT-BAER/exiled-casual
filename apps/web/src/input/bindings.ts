import type { Intent, Snapshot, SpawnKind, ToWorker } from "@exiled/protocol";
import { heldToMoveIntent, keyToIntent, pointerToWorld } from "./intents";
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
 * The column a click on an interactable is really tested against, in world units:
 * a man's width and a man's height, standing at his feet.
 *
 * The disenchanter is a rig on a torus ring (`meshes.ts` `buildVendor`), and both
 * of those have holes in them — a click between his legs passes through the gap AND
 * through the middle of the ring, meets the floor, and reads as bare ground. The
 * ring cannot be widened out of the problem, because the hole is exactly where he
 * stands. So the volume is intersected analytically here rather than built as an
 * invisible proxy mesh: `engine.ts` makes every new mesh a sun shadow caster on
 * sight, and a 2-unit invisible cylinder would throw a 2-unit shadow.
 *
 * A shade wider than his shoulders. Wider than this and it starts eating the
 * movement click that was meant to walk PAST him.
 */
const PICK_RADIUS = 0.55;
const PICK_HEIGHT = 2.0;

/**
 * Which kinds get the forgiving column.
 *
 * Furniture and people, because a stolen click on those costs a panel that closes
 * itself when the player walks away. A portal is excluded: it ends the map and
 * spends one of the six, so it may only be entered on purpose. So is a ground
 * item — a column round every drop would eat the movement clicks in the middle of
 * the fight that made the drops.
 */
const FORGIVING_KINDS: ReadonlySet<string> = new Set(["mapDevice", "stash", "vendor"]);

/**
 * Where a picking ray enters the column at `(cx, cz)`, or null if it misses.
 *
 * Distance along the ray rather than a bare boolean, so two overlapping
 * interactables resolve to the nearer one instead of to whichever the snapshot
 * happened to list first.
 */
export function columnHit(
  ray: { origin: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } },
  cx: number,
  cz: number,
): number | null {
  const ox = ray.origin.x - cx;
  const oz = ray.origin.z - cz;
  const dx = ray.direction.x;
  const dz = ray.direction.z;
  const a = dx * dx + dz * dz;
  const b = 2 * (ox * dx + oz * dz);
  const c = ox * ox + oz * oz - PICK_RADIUS * PICK_RADIUS;
  // Straight down the axis: inside the disc or nowhere near it.
  if (a < 1e-9) return c <= 0 ? -ray.origin.y / ray.direction.y : null;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  // Both roots, near one first: the near one is behind the camera when the cursor
  // is inside the column, and then the far wall of it is the honest hit.
  for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
    if (t < 0) continue;
    const y = ray.origin.y + ray.direction.y * t;
    if (y >= 0 && y <= PICK_HEIGHT) return t;
  }
  return null;
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
  /**
   * Which skill the key row fires, read fresh on every press: the bar is
   * reorderable and this listener is attached once, so a snapshot of the mapping
   * taken at mount would go stale the first time a skill was dragged.
   */
  skillForKey?: (key: string) => string | null,
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

  /**
   * The interactable under a screen pixel, forgiving the holes in a body.
   *
   * The meshes are asked first, so an exact hit on the map device's brass or on the
   * disenchanter's hood answers as it always did; the columns are consulted only
   * when that found nothing. Hover and click both come through here, or the ring at
   * his feet would light up on a pixel the click then refuses.
   */
  function interactAt(sx: number, sy: number): number | null {
    const pick = scene.pick(sx, sy);
    const exact = pick.pickedMesh ? findInteractRoot(pick.pickedMesh) : null;
    if (exact) return exact.entityId;
    if (!latestSnap) return null;
    const ray = scene.createPickingRay(sx, sy, null, null);
    let best: { id: number; t: number } | null = null;
    for (const e of latestSnap.entities) {
      if (!FORGIVING_KINDS.has(e.kind)) continue;
      // Snapshot y is the world's z: the sim is 2D and the floor is its plane.
      const t = columnHit(ray, e.x, e.y);
      if (t !== null && (best === null || t < best.t)) best = { id: e.id, t };
    }
    return best === null ? null : best.id;
  }

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
    // Movement is the sum of everything held, so W+D is the diagonal between
    // them rather than whichever key was struck last.
    if (MOVE_KEYS.has(k)) {
      if (!held.includes(k)) held.push(k);
      post(heldToMoveIntent(held));
      return;
    }
    const intent = keyToIntent(e.key, aimWorld, skillForKey);
    if (intent) post(intent);
  }

  function onKeyUp(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (!MOVE_KEYS.has(k)) return;
    const i = held.indexOf(k);
    if (i !== -1) held.splice(i, 1);
    // Re-sum what is left, so releasing one key of a diagonal walks the player
    // on the other instead of stalling or snapping to the last press.
    post(heldToMoveIntent(held));
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
    // Hover still asks the meshes first — that question really is "what is under
    // the cursor", walls and all — and the columns only after they say nothing.
    setHover(interactAt(e.clientX, e.clientY));
  }

  function onPointerLeave() {
    setHover(null);
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return; // left button drives movement
    const floor = groundPoint(scene, e.clientX, e.clientY);
    if (!floor) return;
    const world = pointerToWorld(floor);
    // PoE-style: clicking directly on a portal or map device auto-walks to it and
    // queues an interact. Do NOT start hold-to-move steering for this case.
    const interactable = interactAt(e.clientX, e.clientY);
    if (interactable !== null) {
      post({ kind: "moveTo", x: world.x, y: world.y });
      pendingInteractId = interactable;
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
