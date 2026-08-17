import type { Intent, Snapshot, SpawnKind, ToWorker } from "@exiled/protocol";
import { heldToMoveIntent, keyToIntent, pointerToWorld } from "./intents";
import type { Node, Scene } from "@babylonjs/core";
import { DEFAULT_KEYBINDS, MOVE_SOCKET, type Keybinds } from "../settings";
import { SKILLS } from "@exiled/content-runtime";
import { Y_LIFT } from "../render/meshes";
import { dlog } from "../debug";

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

const MOVE_ACTIONS = ["moveUp", "moveDown", "moveLeft", "moveRight"] as const;

/**
 * The height a skill is aimed at: the plane a projectile FLIES in, not the floor
 * (`Y_LIFT.projectile`, meshes.ts).
 *
 * A bolt is drawn at chest height, so on screen its path runs a long way above
 * the floor line it follows — aiming at the floor under the cursor sent every
 * bolt visibly over the top of whatever the cursor was on, and pointing at a
 * monster's body, which is drawn above its own feet, targeted the floor BEYOND
 * it. Meeting the picking ray at the height the bolt travels at makes the cursor
 * and the bolt's path the same line on screen.
 *
 * Ground-targeted skills keep the floor: their cinders are painted on it.
 */
export const AIM_HEIGHT = Y_LIFT.projectile;

/**
 * The point where the pixel's ray meets the horizontal plane at `height`.
 *
 * `scene.pick` returns the first mesh the ray meets, and a wall's top face stands
 * 3.5 units up, so a click on a wall resolved to that top corner: the player
 * walked to a spot well short of the cursor, and the further the wall, the bigger
 * the lie. The floor is one flat plane at y=0 (`engine.ts`), so meet it
 * analytically instead — cheaper than a second pick, and it cannot miss the way a
 * mesh pick can.
 */
function planePoint(
  scene: Scene,
  sx: number,
  sy: number,
  height = 0,
): { x: number; z: number } | null {
  const ray = scene.createPickingRay(sx, sy, null, null);
  // Looking up or along the plane: there is no ground under that pixel.
  if (ray.direction.y >= -1e-6) return null;
  const t = (height - ray.origin.y) / ray.direction.y;
  if (t < 0) return null; // the plane is behind the camera
  return {
    x: ray.origin.x + ray.direction.x * t,
    z: ray.origin.z + ray.direction.z * t,
  };
}

/**
 * Effects aimed at a BODY, which is drawn standing above its own feet. Everything
 * else — scorched ground, a blink's destination — is aimed at the floor, because
 * the floor is where the player is looking when he picks the spot.
 */
const AIMED_AT_BODIES: ReadonlySet<string> = new Set(["spawnProjectile", "meleeStrike"]);

/**
 * Which plane a given skill is aimed at. Read off the effects rather than a list
 * of ids, so a new skill lands on the right plane the day it is authored.
 */
function aimHeightFor(skillId: string): number {
  const def = SKILLS.get(skillId);
  return def?.effects.some((e) => AIMED_AT_BODIES.has(e.type)) ? AIM_HEIGHT : 0;
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
const FORGIVING_KINDS: ReadonlySet<string> = new Set(["mapDevice", "stash", "vendor", "container"]);

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
  /** What the mouse buttons fire. Index is bar index (MOUSE_SLOT_BASE + button). */
  skillForMouse?: (button: number) => string | null,
  /** The rebindable keys, read fresh on every press like the skill bar above. */
  keybinds?: () => Keybinds,
): {
  detach: () => void;
  onSnapshot: (snap: Snapshot) => void;
  approach: (entityId: number, x: number, y: number) => void;
  /** Where the cursor points right now, for the arm that tracks it. */
  getAim: () => { x: number; y: number };
} {
  // Movement keys currently held, oldest→newest. Needed so releasing one key
  // resumes another still-held direction, and releasing the last sends "stop".
  const held: string[] = [];
  // True while the left mouse button is down: hold-to-move keeps steering the
  // player toward the cursor, instead of a single click-to-point.
  let pointerHeld = false;
  // Mouse buttons held down that are bound to a skill. Re-fired every snapshot so
  // holding a button keeps casting, the way the numbered keys do through the
  // browser's own key auto-repeat. The sim drops casts still on cooldown.
  const skillButtonsHeld = new Set<number>();
  // Skill KEYS held, re-fired the same way. The browser's own auto-repeat used
  // to stand in for this, but its half-second initial delay left a gap where
  // the sim saw no command and the walk burst back to a run mid-hold.
  const skillKeysHeld = new Set<string>();
  // Last cursor screen position, so held-move can re-pick the world point every
  // snapshot. The camera follows the player, so a stationary cursor sits over a
  // DIFFERENT world point each frame — re-picking is what keeps the player moving
  // when the button is held without the mouse moving.
  let lastScreen: { x: number; y: number } | null = null;

  // Last aim that resolved, kept so a frame where the cursor is off the plane
  // (over the sky past the map's edge) casts where the player last pointed
  // rather than at the world origin.
  let lastAim = { x: 0, y: 0 };

  const binds = () => keybinds?.() ?? DEFAULT_KEYBINDS;
  const isMoveKey = (k: string) => MOVE_ACTIONS.some((a) => binds()[a] === k && k !== "");

  /**
   * Where the cursor points, in RAW world floats (sim x, sim y = Babylon z).
   * Raw, not fixed-point, because `keyToIntent` applies `fp()` itself —
   * pre-converting here would double-scale the target ~1000x.
   *
   * Re-picked on every call rather than cached at pointermove: the camera follows
   * the player, so a cursor that has not moved a pixel sits over a different world
   * point each frame, and a cast taken from the last MOVE aimed where the player
   * used to be.
   */
  function aimAt(height: number): { x: number; y: number } {
    const p = lastScreen && planePoint(scene, lastScreen.x, lastScreen.y, height);
    if (p) lastAim = { x: p.x, y: p.z };
    return lastAim;
  }

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
    // Every intent the pointer and the keys produce goes through here; the panels
    // have their own funnel in GameView. See debug.ts.
    dlog("intent", intent.kind, intent);
    worker.postMessage(msg);
  }

  function onKeyDown(e: KeyboardEvent) {
    // Checked before the skill row, which shares these keys' `key` values.
    const spawn = SPAWN_KEYS[e.code];
    if (spawn) {
      dlog("intent", "spawn", spawn);
      worker.postMessage({ type: "spawn", what: spawn } satisfies ToWorker);
      return;
    }
    const k = e.key.toLowerCase();
    // NO `r` HERE. It used to be "lab respawn", from when this was a greybox
    // arena with nothing durable in it. `reset` rebuilds the worker's core as
    // `new WorkerCore(42)` — no characterId, no hydrate — so it does not respawn
    // the player, it REPLACES him with an empty seed-42 lab character, and the
    // next durable change persists that. A stray keypress emptied a real
    // character's inventory and equipment. The message still exists for the
    // worker; nothing in the game may bind a key to it.
    // Pickup: the nearest in-range ground item (sim re-checks range).
    if (k === binds().pickup && k !== "" && latestSnap) {
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
    if (isMoveKey(k)) {
      if (!held.includes(k)) held.push(k);
      post(heldToMoveIntent(held, binds()));
      return;
    }
    // The skill is resolved first only to know WHICH plane to aim at; keyToIntent
    // resolves it again for the intent itself (a bar lookup, not work worth saving).
    const keySkill = skillForKey?.(e.key);
    const intent = keyToIntent(e.key, aimAt(keySkill ? aimHeightFor(keySkill) : AIM_HEIGHT), skillForKey, binds());
    if (intent) {
      post(intent);
      if (intent.kind === "useSkill") skillKeysHeld.add(e.key);
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    skillKeysHeld.delete(e.key);
    const k = e.key.toLowerCase();
    // Membership is the held list itself, not the current binds: a key rebound
    // mid-hold must still release the movement it started.
    const i = held.indexOf(k);
    if (i === -1) return;
    held.splice(i, 1);
    // Re-sum what is left, so releasing one key of a diagonal walks the player
    // on the other instead of stalling or snapping to the last press.
    post(heldToMoveIntent(held, binds()));
  }

  function onPointerMove(e: PointerEvent) {
    // A chorded press or release arrives here, not on pointerdown/up. See syncButtons.
    syncButtons(e, e.buttons);
    lastScreen = { x: e.clientX, y: e.clientY };
    // Hold-to-move: while the button is held, re-target toward the cursor so
    // dragging steers the player continuously. Walking is on the floor, always.
    const floor = planePoint(scene, e.clientX, e.clientY);
    if (floor && pointerHeld) {
      const world = pointerToWorld(floor);
      post({ kind: "moveTo", x: world.x, y: world.y });
    }
    // Hover still asks the meshes first — that question really is "what is under
    // the cursor", walls and all — and the columns only after they say nothing.
    setHover(interactAt(e.clientX, e.clientY));
  }

  function onPointerLeave() {
    setHover(null);
  }

  /** Fire the skill bound to `button` at the given screen point. False when nothing is bound. */
  function castFromMouse(button: number, sx: number, sy: number): boolean {
    const skillId = skillForMouse?.(button);
    if (!skillId || skillId === MOVE_SOCKET) return false;
    const at = planePoint(scene, sx, sy, aimHeightFor(skillId));
    if (!at) return true; // bound, just no ground under the cursor this frame
    const aim = pointerToWorld(at);
    post({ kind: "useSkill", skillId, tx: aim.x, ty: aim.y });
    return true;
  }

  /**
   * Pointer Events fire `pointerdown` only for the FIRST button pressed: a second
   * button pressed while another is held arrives as a `pointermove` carrying an
   * updated `buttons` bitmask, and `pointerup` likewise waits for the LAST button
   * to come up. So chorded presses (LMB to walk, RMB to cast) have to be read off
   * the bitmask rather than off the event's own `button`. Bit per button index.
   */
  const BUTTON_BIT = [1, 4, 2];
  let buttonsMask = 0;

  function syncButtons(e: PointerEvent, now: number) {
    for (let button = 0; button < BUTTON_BIT.length; button++) {
      const bit = BUTTON_BIT[button]!;
      const was = (buttonsMask & bit) !== 0;
      const is = (now & bit) !== 0;
      if (is && !was) onButtonDown(button, e);
      else if (!is && was) onButtonUp(button);
    }
    buttonsMask = now;
  }

  function onButtonDown(button: number, e: PointerEvent) {
    // Middle or right: cast the assigned skill if any. The context menu and
    // autoscroll are suppressed by their own listeners, since the press that
    // starts a chord reaches us as a pointermove that must not be cancelled.
    if (button === 1 || button === 2) {
      lastScreen = { x: e.clientX, y: e.clientY };
      if (castFromMouse(button, e.clientX, e.clientY)) skillButtonsHeld.add(button);
      return;
    }
    // Left button: three states. MOVE_SOCKET = walk (fall through below).
    // A skill id = cast. null (cleared) = do nothing.
    const leftAction = skillForMouse ? skillForMouse(0) : MOVE_SOCKET;
    if (leftAction !== null && leftAction !== MOVE_SOCKET) {
      lastScreen = { x: e.clientX, y: e.clientY };
      castFromMouse(0, e.clientX, e.clientY);
      skillButtonsHeld.add(0);
      return;
    }
    if (leftAction === null) return; // cleared: left button is dead
    // A piece is riding the cursor with no button held, so this press is the one
    // that puts it down. The inventory's drop-to-ground path reads the RELEASE,
    // which means without this the same click both drops the item and sets the
    // player walking to where it landed. Read off the ghost element rather than
    // plumbed through three components: the ghost IS the carried piece, and this
    // is a one-way signal from the panel to the world, not shared state.
    if (document.querySelector("[data-carrying]")) return;
    const floor = planePoint(scene, e.clientX, e.clientY);
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

  function onButtonUp(button: number) {
    if (button === 0) pointerHeld = false;
    skillButtonsHeld.delete(button);
  }

  // The first press and the last release still arrive as real pointerdown/up.
  // OR/AND the event's own button in, because a synthetic event may carry a
  // `buttons` that has not caught up with the button it reports.
  function onPointerDown(e: PointerEvent) {
    if (e.button === 1 || e.button === 2) e.preventDefault();
    syncButtons(e, e.buttons | (BUTTON_BIT[e.button] ?? 0));
  }

  function onPointerUp(e: PointerEvent) {
    syncButtons(e, e.buttons & ~(BUTTON_BIT[e.button] ?? 0));
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
    if (skillButtonsHeld.size > 0 && lastScreen && !snap.player.casting) {
      for (const button of skillButtonsHeld) castFromMouse(button, lastScreen.x, lastScreen.y);
    }
    // Held skill keys re-fire exactly as the mouse buttons above do, which both
    // keeps the cast chain going and keeps the sim's skillHold window fed.
    if (skillKeysHeld.size > 0 && !snap.player.casting) {
      for (const key of skillKeysHeld) {
        const skill = skillForKey?.(key);
        const intent = keyToIntent(key, aimAt(skill ? aimHeightFor(skill) : AIM_HEIGHT), skillForKey, binds());
        if (intent?.kind === "useSkill") post(intent);
      }
    }
    if (pointerHeld && lastScreen) {
      const floor = planePoint(scene, lastScreen.x, lastScreen.y);
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

  // Suppress the browser context menu on the canvas so right-click casts.
  const onContextMenu = (e: Event) => e.preventDefault();
  canvas.addEventListener("contextmenu", onContextMenu);
  // Suppress middle-click autoscroll.
  const onAuxClick = (e: Event) => e.preventDefault();
  canvas.addEventListener("auxclick", onAuxClick);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("pointerdown", onPointerDown);
  // Listen on window so releasing outside the canvas still ends hold-to-move.
  window.addEventListener("pointerup", onPointerUp);

  function detach() {
    canvas.removeEventListener("contextmenu", onContextMenu);
    canvas.removeEventListener("auxclick", onAuxClick);
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
    // Callers hand in snapshot floats; the intent wants fixed-point. Raw floats
    // quantise to ~0, which walked every distant approach to the map origin.
    post({ kind: "moveTo", ...pointerToWorld({ x, z: y }) });
  }

  return { detach, onSnapshot, approach, getAim: () => aimAt(AIM_HEIGHT) };
}
