// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { attachBindings } from "./bindings";
import type { Scene } from "@babylonjs/core";
import type { Snapshot } from "@exiled/protocol";
import { testPlayer } from "../test-fixtures";
import { fp } from "@exiled/fixed-point";
import { MOVE_SOCKET } from "../settings";

/**
 * The skill row's mapping, which the bar owns now: `1` fires whatever sits in the
 * first socket. Passed in here so a cast test is exercising the real path.
 */
const DEFAULT_BAR = [
  "skill.ember_bolt.v1", "skill.cinder_ground.v1", "skill.blink.v1", null, null,
  MOVE_SOCKET, null, null,
];
const defaultSkillForKey = (key: string): string | null =>
  DEFAULT_BAR[Number(key) - 1] ?? null;

/**
 * A ray straight down from above `(x, z)`, so the floor intersection at y=0 is
 * exactly that point. Movement reads the floor plane, never the picked mesh.
 */
function downRay(x: number, z: number) {
  return { origin: { x, y: 10, z }, direction: { x: 0, y: -1, z: 0 } };
}

// Minimal fake scene: the floor under the cursor is a fixed world point.
function fakeScene(): Scene {
  return {
    createPickingRay: () => downRay(1, 2),
    pick: () => ({ hit: true, pickedPoint: { x: 1, z: 2 }, pickedMesh: null }),
  } as unknown as Scene;
}

// Fake scene where every pick hits a portal child mesh (entity-42).
function fakeInteractScene(entityId = 42): Scene {
  // The root carries interactKind; the child (what the pick returns) does not.
  const root = { name: `entity-${entityId}`, metadata: { interactKind: "portal" }, parent: null };
  const childMesh = { name: `entity-${entityId}-pi`, metadata: null, parent: root };
  return {
    createPickingRay: () => downRay(5, 7),
    pick: () => ({ hit: true, pickedPoint: { x: 5, z: 7 }, pickedMesh: childMesh }),
  } as unknown as Scene;
}

function makeSnap(entityOverrides: Partial<Snapshot["entities"][number]>[] = []): Snapshot {
  return {
    tick: 1,
    area: "hideout",
    portalsLeft: 0,
    mapOpen: false,
    areaTier: 0,
    atlasSeed: 0,
    completedNodes: [],
    player: testPlayer(),
    entities: entityOverrides as Snapshot["entities"],
    inventory: { cols: 12, rows: 5, items: [] },
    stash: { cols: 12, rows: 12, items: [] },
    vendor: { cols: 12, rows: 12, items: [] },
    shards: {},
    equipment: {},
  };
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
    ({ detach } = attachBindings(
      canvas, worker as unknown as Worker, fakeScene(),
      undefined, undefined, undefined, undefined, undefined, defaultSkillForKey,
    ));
  });

  afterEach(() => {
    detach();
    canvas.remove();
  });

  // `buttons` is the bitmask of what is CURRENTLY down, which is what the
  // bindings read for chorded presses; jsdom will not derive it from `button`.
  function pointer(type: string, button = 0, target: EventTarget = canvas, buttons?: number) {
    const bit = [1, 4, 2][button] ?? 0;
    const mask = buttons ?? (type === "pointerup" ? 0 : bit);
    target.dispatchEvent(
      new MouseEvent(type, { button, buttons: mask, clientX: 50, clientY: 50, bubbles: true }),
    );
  }

  it("moves to the cursor on left pointer down", () => {
    pointer("pointerdown");
    expect(moveToCount(worker.postMessage)).toBe(1);
  });

  it("does not walk when a piece is riding the cursor: that click is placing it", () => {
    // The inventory carries a piece with no button held, so the click that puts it
    // down lands on the canvas rather than on the panel. Without this the player
    // both drops the item and sets off walking to where it fell.
    const ghost = document.createElement("div");
    ghost.setAttribute("data-carrying", "");
    document.body.appendChild(ghost);

    pointer("pointerdown");
    expect(moveToCount(worker.postMessage)).toBe(0);

    ghost.remove();
    pointer("pointerup", 0, window); // a real second press needs a release first
    pointer("pointerdown");
    expect(moveToCount(worker.postMessage)).toBe(1);
  });

  it("walks to the floor under the cursor, not to the wall top the ray hit first", () => {
    // A wall's top face stands 3.5 units up, and `scene.pick` reports THAT
    // surface, whose x/z is nowhere near the floor the player can stand on.
    const c = document.createElement("canvas");
    document.body.appendChild(c);
    const w = { postMessage: vi.fn() };
    const wallScene = {
      createPickingRay: () => downRay(9, 9),
      pick: () => ({ hit: true, pickedPoint: { x: 3, y: 3.5, z: 3 }, pickedMesh: null }),
    } as unknown as Scene;
    const { detach } = attachBindings(c, w as unknown as Worker, wallScene);
    c.dispatchEvent(new MouseEvent("pointerdown", { button: 0, clientX: 50, clientY: 50, bubbles: true }));
    expect(w.postMessage).toHaveBeenCalledWith({
      type: "intent",
      intent: { kind: "moveTo", x: fp(9), y: fp(9) },
    });
    detach();
    c.remove();
  });

  it("casts with the right button while the left is held walking", () => {
    // Pointer Events fire pointerdown only for the FIRST button: pressing right
    // while left is down arrives as a pointermove carrying buttons = 1|2, and
    // releasing right arrives the same way. Reading `button` alone missed both,
    // so right-click did nothing at all while walking.
    const w = { postMessage: vi.fn() };
    const c = document.createElement("canvas");
    document.body.appendChild(c);
    const { detach: d, onSnapshot } = attachBindings(
      c, w as unknown as Worker, fakeScene(),
      undefined, undefined, undefined, undefined, undefined, undefined,
      (button) => (button === 2 ? "skill.ember_bolt.v1" : "builtin.move"),
    );
    const move = (buttons: number) =>
      c.dispatchEvent(new MouseEvent("pointermove", { button: 0, buttons, clientX: 50, clientY: 50, bubbles: true }));

    c.dispatchEvent(new MouseEvent("pointerdown", { button: 0, buttons: 1, clientX: 50, clientY: 50, bubbles: true }));
    expect(moveToCount(w.postMessage)).toBe(1);
    move(1 | 2); // right pressed while left stays down
    expect(intentCount(w.postMessage, "useSkill")).toBe(1);
    // Both keep going: walking is not interrupted and the cast repeats.
    onSnapshot(makeSnap());
    expect(intentCount(w.postMessage, "useSkill")).toBe(2);
    expect(moveToCount(w.postMessage)).toBe(3); // down + the move + the snapshot
    move(1); // right released, left still down
    onSnapshot(makeSnap());
    expect(intentCount(w.postMessage, "useSkill")).toBe(2);
    d();
    c.remove();
  });

  it("repeats a held skill only after the previous cast has completed", () => {
    const w = { postMessage: vi.fn() };
    const c = document.createElement("canvas");
    document.body.appendChild(c);
    const { detach: d, onSnapshot } = attachBindings(
      c, w as unknown as Worker, fakeScene(),
      undefined, undefined, undefined, undefined, undefined, undefined,
      (button) => (button === 2 ? "skill.ember_bolt.v1" : null),
    );
    c.dispatchEvent(new MouseEvent("pointerdown", { button: 2, clientX: 50, clientY: 50, bubbles: true }));
    expect(intentCount(w.postMessage, "useSkill")).toBe(1);
    const casting = makeSnap();
    casting.player.casting = true;
    onSnapshot(casting);
    onSnapshot(casting);
    expect(intentCount(w.postMessage, "useSkill")).toBe(1);
    onSnapshot(makeSnap());
    expect(intentCount(w.postMessage, "useSkill")).toBe(2);
    window.dispatchEvent(new MouseEvent("pointerup", { button: 2, bubbles: true }));
    onSnapshot(makeSnap());
    expect(intentCount(w.postMessage, "useSkill")).toBe(2);
    d();
    c.remove();
  });

  it("keeps re-targeting while the button is held and the cursor moves", () => {
    pointer("pointerdown");
    pointer("pointermove");
    pointer("pointermove");
    expect(moveToCount(worker.postMessage)).toBe(3); // down + 2 held moves
  });

  it("keeps moving toward the cursor while held even without mouse movement", () => {
    const w = { postMessage: vi.fn() };
    const c = document.createElement("canvas");
    document.body.appendChild(c);
    const { detach: d, onSnapshot } = attachBindings(c, w as unknown as Worker, fakeScene());
    c.dispatchEvent(new MouseEvent("pointerdown", { button: 0, clientX: 50, clientY: 50, bubbles: true }));
    expect(moveToCount(w.postMessage)).toBe(1); // initial click
    // Each snapshot re-picks the cursor's (drifting) world point and re-steers.
    onSnapshot(makeSnap());
    onSnapshot(makeSnap());
    expect(moveToCount(w.postMessage)).toBe(3);
    d();
    c.remove();
  });

  it("stops steering from snapshots once the button is released", () => {
    const w = { postMessage: vi.fn() };
    const c = document.createElement("canvas");
    document.body.appendChild(c);
    const { detach: d, onSnapshot } = attachBindings(c, w as unknown as Worker, fakeScene());
    c.dispatchEvent(new MouseEvent("pointerdown", { button: 0, clientX: 50, clientY: 50, bubbles: true }));
    window.dispatchEvent(new MouseEvent("pointerup", { button: 0, bubbles: true }));
    onSnapshot(makeSnap());
    onSnapshot(makeSnap());
    expect(moveToCount(w.postMessage)).toBe(1); // only the initial click
    d();
    c.remove();
  });

  it("does not move on pointermove when the button is not held", () => {
    pointer("pointermove", 0, canvas, 0);
    pointer("pointermove", 0, canvas, 0);
    expect(moveToCount(worker.postMessage)).toBe(0);
  });

  it("stops re-targeting after the button is released", () => {
    pointer("pointerdown");
    pointer("pointerup", 0, window); // release may land outside the canvas
    pointer("pointermove", 0, canvas, 0);
    expect(moveToCount(worker.postMessage)).toBe(1); // only the initial down
  });

  it("ignores non-left buttons", () => {
    pointer("pointerdown", 2);
    pointer("pointermove", 0, canvas, 2);
    expect(moveToCount(worker.postMessage)).toBe(0);
  });

  it("r key does NOT reset the sim — that wiped the character's inventory", () => {
    // `reset` rebuilds the core as `new WorkerCore(42)`: no characterId, no
    // hydrate, so the live character is replaced by an empty seed-42 lab one and
    // the next durable change persists that emptiness. It was a greybox-lab
    // affordance that outlived the lab, and it fires on the dev server too, which
    // is where it was actually losing people's gear.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
    expect(worker.postMessage).not.toHaveBeenCalledWith({ type: "reset" });
  });

  it("numpad keys post spawn messages", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "2", code: "Numpad2", bubbles: true }));
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "spawn", what: "pack" });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "0", code: "Numpad0", bubbles: true }));
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "spawn", what: "clear" });
  });

  it("g key picks up the nearest in-range ground item", () => {
    const w = { postMessage: vi.fn() };
    const c = document.createElement("canvas");
    document.body.appendChild(c);
    const { detach: d, onSnapshot } = attachBindings(c, w as unknown as Worker, fakeScene());
    onSnapshot(
      makeSnap([
        { id: 55, kind: "groundItem", x: 0, y: 0, inRange: true },
      ]),
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    expect(intentCount(w.postMessage, "pickupItem")).toBe(1);
    expect(w.postMessage).toHaveBeenCalledWith({ type: "intent", intent: { kind: "pickupItem", entityId: 55 } });
    d();
    c.remove();
  });

  it("approach() walks to a ground item and picks it up once it is in range", () => {
    const w = { postMessage: vi.fn() };
    const c = document.createElement("canvas");
    document.body.appendChild(c);
    const { detach: d, onSnapshot, approach } = attachBindings(c, w as unknown as Worker, fakeScene());
    approach(77, 4, 6);
    // Fixed-point on the wire: raw snapshot floats quantised to ~0 and walked
    // every distant approach to the map origin instead of the target.
    expect(w.postMessage).toHaveBeenCalledWith({ type: "intent", intent: { kind: "moveTo", x: fp(4), y: fp(6) } });
    // Still walking: out of range means no pickup yet.
    onSnapshot(makeSnap([{ id: 77, kind: "groundItem", x: 4, y: 6, inRange: false }]));
    expect(intentCount(w.postMessage, "pickupItem")).toBe(0);
    onSnapshot(makeSnap([{ id: 77, kind: "groundItem", x: 4, y: 6, inRange: true }]));
    expect(w.postMessage).toHaveBeenCalledWith({ type: "intent", intent: { kind: "pickupItem", entityId: 77 } });
    // Fires once, not on every later snapshot.
    onSnapshot(makeSnap([{ id: 77, kind: "groundItem", x: 4, y: 6, inRange: true }]));
    expect(intentCount(w.postMessage, "pickupItem")).toBe(1);
    d();
    c.remove();
  });

  it("g key picks the nearest in-range item, ignoring a closer out-of-range one", () => {
    const w = { postMessage: vi.fn() };
    const c = document.createElement("canvas");
    document.body.appendChild(c);
    const { detach: d, onSnapshot } = attachBindings(c, w as unknown as Worker, fakeScene());
    // Player at origin. 56 is the nearest in-range; 66 is closer but out of range.
    onSnapshot(
      makeSnap([
        { id: 55, kind: "groundItem", x: 10, y: 0, inRange: true },
        { id: 56, kind: "groundItem", x: 2, y: 0, inRange: true },
        { id: 57, kind: "groundItem", x: 5, y: 5, inRange: true },
        { id: 66, kind: "groundItem", x: 1, y: 0, inRange: false },
      ]),
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    expect(intentCount(w.postMessage, "pickupItem")).toBe(1);
    expect(w.postMessage).toHaveBeenCalledWith({ type: "intent", intent: { kind: "pickupItem", entityId: 56 } });
    d();
    c.remove();
  });

  it("g key ignores ground items that are not in range", () => {
    const w = { postMessage: vi.fn() };
    const c = document.createElement("canvas");
    document.body.appendChild(c);
    const { detach: d, onSnapshot } = attachBindings(c, w as unknown as Worker, fakeScene());
    onSnapshot(
      makeSnap([
        { id: 55, kind: "groundItem", x: 0, y: 0, inRange: false },
      ]),
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    expect(intentCount(w.postMessage, "pickupItem")).toBe(0);
    d();
    c.remove();
  });

  it("a numpad key never doubles as its skill-row twin", () => {
    // Both report key "1"; only the code separates spawning from casting.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", code: "Numpad1", bubbles: true }));
    const casts = worker.postMessage.mock.calls.filter(
      (c) => c[0]?.type === "intent" && c[0]?.intent?.kind === "useSkill",
    );
    expect(casts.length).toBe(0);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", code: "Digit1", bubbles: true }));
    expect(
      worker.postMessage.mock.calls.filter(
        (c) => c[0]?.type === "intent" && c[0]?.intent?.kind === "useSkill",
      ).length,
    ).toBe(1);
  });
});

describe("attachBindings aim", () => {
  /**
   * A ray that leans one world unit sideways per unit of drop, so where it lands
   * depends on the HEIGHT of the plane it is met at: the floor at y=0 and the
   * plane a bolt flies in are different points, which a straight-down ray hides.
   */
  function slantScene(ground: { x: number; z: number }): Scene {
    return {
      createPickingRay: () => ({ origin: { x: ground.x - 10, y: 10, z: ground.z }, direction: { x: 1, y: -1, z: 0 } }),
      pick: () => ({ hit: true, pickedMesh: null }),
    } as unknown as Scene;
  }

  function lastIntent(post: ReturnType<typeof vi.fn>, kind: string) {
    const calls = post.mock.calls.filter((c) => c[0]?.type === "intent" && c[0]?.intent?.kind === kind);
    return calls[calls.length - 1]?.[0].intent;
  }

  function attach(scene: Scene) {
    const c = document.createElement("canvas");
    document.body.appendChild(c);
    const w = { postMessage: vi.fn() };
    const { detach } = attachBindings(
      c, w as unknown as Worker, scene,
      undefined, undefined, undefined, undefined, undefined, defaultSkillForKey,
      (button) => (button === 2 ? "skill.ember_bolt.v1" : MOVE_SOCKET),
    );
    const cleanup = () => { detach(); c.remove(); };
    return { c, w, cleanup };
  }

  const move = (c: HTMLCanvasElement) =>
    c.dispatchEvent(new MouseEvent("pointermove", { button: 0, buttons: 0, clientX: 50, clientY: 50, bubbles: true }));
  const cast = (key: string) =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key, code: `Digit${key}`, bubbles: true }));

  it("re-picks the cursor's world point when the camera moved under a still mouse", () => {
    // Hold-to-move keeps the mouse perfectly still while the camera follows the
    // player, so the same pixel is over a DIFFERENT world point every frame. A
    // cast taken from the point the pointer last MOVED over aims behind the player.
    const at = { x: 1, z: 2 };
    const { c, w, cleanup } = attach(slantScene(at));
    move(c);
    at.x = 9; at.z = 4; // the player ran; the camera came with him
    cast("1");
    expect(lastIntent(w.postMessage, "useSkill")).toMatchObject({ tx: fp(9 - 0.8), ty: fp(4) });
    cleanup();
  });

  it("aims a projectile at the height it flies at, not the floor under the cursor", () => {
    const { c, w, cleanup } = attach(slantScene({ x: 6, z: 3 }));
    move(c);
    cast("1"); // ember bolt
    expect(lastIntent(w.postMessage, "useSkill")).toMatchObject({ tx: fp(6 - 0.8), ty: fp(3) });
    cleanup();
  });

  it("aims a ground-targeted skill at the floor, where its cinders are painted", () => {
    const { c, w, cleanup } = attach(slantScene({ x: 6, z: 3 }));
    move(c);
    cast("2"); // cinder ground
    expect(lastIntent(w.postMessage, "useSkill")).toMatchObject({ tx: fp(6), ty: fp(3) });
    cleanup();
  });

  it("aims a blink at the floor: the destination is a place to stand", () => {
    const { c, w, cleanup } = attach(slantScene({ x: 6, z: 3 }));
    move(c);
    cast("3"); // blink
    expect(lastIntent(w.postMessage, "useSkill")).toMatchObject({ tx: fp(6), ty: fp(3) });
    cleanup();
  });

  it("walks to the floor even though skills aim above it", () => {
    const { c, w, cleanup } = attach(slantScene({ x: 6, z: 3 }));
    c.dispatchEvent(new MouseEvent("pointerdown", { button: 0, buttons: 1, clientX: 50, clientY: 50, bubbles: true }));
    expect(lastIntent(w.postMessage, "moveTo")).toMatchObject({ x: fp(6), y: fp(3) });
    cleanup();
  });

  it("uses the same aim plane for a mouse-button cast", () => {
    const { c, w, cleanup } = attach(slantScene({ x: 6, z: 3 }));
    c.dispatchEvent(new MouseEvent("pointerdown", { button: 2, buttons: 2, clientX: 50, clientY: 50, bubbles: true }));
    expect(lastIntent(w.postMessage, "useSkill")).toMatchObject({ tx: fp(6 - 0.8), ty: fp(3) });
    cleanup();
  });
});

// Scene where every pick hits a mapDevice child mesh (root carries interactKind).
function fakeMapDeviceScene(entityId = 7): Scene {
  const root = { name: `entity-${entityId}`, metadata: { interactKind: "mapDevice" }, parent: null };
  const childMesh = { name: `entity-${entityId}-pi`, metadata: null, parent: root };
  return {
    createPickingRay: () => downRay(5, 7),
    pick: () => ({ hit: true, pickedPoint: { x: 5, z: 7 }, pickedMesh: childMesh }),
  } as unknown as Scene;
}

function intentCount(post: ReturnType<typeof vi.fn>, kind: string): number {
  return post.mock.calls.filter(
    (c) => c[0]?.type === "intent" && c[0]?.intent?.kind === kind,
  ).length;
}

describe("attachBindings map device", () => {
  it("opens the panel and does NOT interact when a mapDevice is in range", () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const worker = { postMessage: vi.fn() };
    const onOpenPanel = vi.fn();
    const { detach, onSnapshot } = attachBindings(
      canvas,
      worker as unknown as Worker,
      fakeMapDeviceScene(7),
      undefined,
      undefined,
      onOpenPanel,
    );

    // Click the device: queues an approach (pendingInteractId = 7).
    canvas.dispatchEvent(new MouseEvent("pointerdown", { button: 0, clientX: 50, clientY: 50, bubbles: true }));
    // Device reports in range → open the panel instead of firing interact.
    onSnapshot(makeSnap([{ id: 7, kind: "mapDevice", inRange: true }]));

    expect(onOpenPanel).toHaveBeenCalledTimes(1);
    expect(intentCount(worker.postMessage, "interact")).toBe(0);

    detach();
    canvas.remove();
  });

  it("still interacts (no panel) for a non-device interactable in range", () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const worker = { postMessage: vi.fn() };
    const onOpenPanel = vi.fn();
    const { detach, onSnapshot } = attachBindings(
      canvas,
      worker as unknown as Worker,
      fakeInteractScene(42), // portal
      undefined,
      undefined,
      onOpenPanel,
    );

    canvas.dispatchEvent(new MouseEvent("pointerdown", { button: 0, clientX: 50, clientY: 50, bubbles: true }));
    onSnapshot(makeSnap([{ id: 42, kind: "portal", inRange: true }]));

    expect(onOpenPanel).not.toHaveBeenCalled();
    expect(intentCount(worker.postMessage, "interact")).toBe(1);

    detach();
    canvas.remove();
  });
});

describe("attachBindings proximity close", () => {
  it("closes the stash again once the player walks out of its range", () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const worker = { postMessage: vi.fn() };
    const onStash = vi.fn();
    const { detach, onSnapshot } = attachBindings(
      canvas,
      worker as unknown as Worker,
      fakeMapDeviceScene(7),
      undefined,
      undefined,
      undefined,
      onStash,
    );

    canvas.dispatchEvent(new MouseEvent("pointerdown", { button: 0, clientX: 50, clientY: 50, bubbles: true }));
    onSnapshot(makeSnap([{ id: 7, kind: "stash", inRange: true }]));
    expect(onStash).toHaveBeenLastCalledWith(true);

    // Standing there is not a reason to keep re-opening it: the player may have
    // shut the panel with its X while still at the stash.
    onSnapshot(makeSnap([{ id: 7, kind: "stash", inRange: true }]));
    expect(onStash).toHaveBeenCalledTimes(1);

    // Walked off: the panel goes with the character, once.
    onSnapshot(makeSnap([{ id: 7, kind: "stash", inRange: false }]));
    expect(onStash).toHaveBeenLastCalledWith(false);
    onSnapshot(makeSnap([{ id: 7, kind: "stash", inRange: false }]));
    expect(onStash).toHaveBeenCalledTimes(2);

    detach();
    canvas.remove();
  });

  it("leaves a panel it never opened alone", () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const worker = { postMessage: vi.fn() };
    const onOpenPanel = vi.fn();
    const { detach, onSnapshot } = attachBindings(
      canvas,
      worker as unknown as Worker,
      fakeMapDeviceScene(7),
      undefined,
      undefined,
      onOpenPanel,
    );

    // No map device anywhere near, and none was ever opened: pressing I for the
    // inventory must not be undone by a device the player has not visited.
    onSnapshot(makeSnap([{ id: 7, kind: "stash", inRange: false }]));
    expect(onOpenPanel).not.toHaveBeenCalled();

    detach();
    canvas.remove();
  });
});

describe("attachBindings hover", () => {
  function move(canvas: HTMLCanvasElement) {
    canvas.dispatchEvent(new MouseEvent("pointermove", { clientX: 50, clientY: 50, bubbles: true }));
  }

  it("hovering an interactable invokes the callback once with its id", () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const onHover = vi.fn();
    const { detach } = attachBindings(
      canvas,
      { postMessage: vi.fn() } as unknown as Worker,
      fakeInteractScene(42),
      undefined,
      onHover,
    );

    move(canvas);
    expect(onHover).toHaveBeenCalledTimes(1);
    expect(onHover).toHaveBeenCalledWith(42);

    detach();
    canvas.remove();
  });

  it("moving within the same entity does NOT invoke the callback again", () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const onHover = vi.fn();
    const { detach } = attachBindings(
      canvas,
      { postMessage: vi.fn() } as unknown as Worker,
      fakeInteractScene(42),
      undefined,
      onHover,
    );

    move(canvas);
    move(canvas); // still over entity-42
    move(canvas);
    expect(onHover).toHaveBeenCalledTimes(1); // fired exactly once on first enter

    detach();
    canvas.remove();
  });

  it("moving off to ground invokes the callback once with null", () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const onHover = vi.fn();
    // Start over an interactable, then switch to a ground scene
    let useInteract = true;
    const switchingScene = {
      createPickingRay: () => (useInteract ? downRay(1, 1) : downRay(2, 2)),
      pick: () =>
        useInteract
          ? { hit: true, pickedPoint: { x: 1, z: 1 }, pickedMesh: { name: "entity-7-pi", metadata: null, parent: { name: "entity-7", metadata: { interactKind: "portal" }, parent: null } } }
          : { hit: true, pickedPoint: { x: 2, z: 2 }, pickedMesh: null },
    } as unknown as Scene;
    const { detach } = attachBindings(
      canvas,
      { postMessage: vi.fn() } as unknown as Worker,
      switchingScene,
      undefined,
      onHover,
    );

    move(canvas); // hover entity-7 → callback(7)
    useInteract = false;
    move(canvas); // hover ground → callback(null)

    expect(onHover).toHaveBeenCalledTimes(2);
    expect(onHover).toHaveBeenNthCalledWith(1, 7);
    expect(onHover).toHaveBeenNthCalledWith(2, null);

    detach();
    canvas.remove();
  });

  /**
   * The disenchanter stands on a thin torus ring (`meshes.ts`), so a click between
   * his legs goes through the hole in it and lands on the floor: the man reads as
   * bare ground. The forgiving pick is a column at his position, tested only when
   * the mesh pick found no interactable.
   */
  it("a pick that slips between an NPC's legs still finds him", () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const onHover = vi.fn();
    // Mesh pick misses everything; the ray goes straight down through (1, 2).
    const { detach, onSnapshot } = attachBindings(
      canvas,
      { postMessage: vi.fn() } as unknown as Worker,
      fakeScene(),
      undefined,
      onHover,
    );

    onSnapshot(makeSnap([{ id: 5, kind: "vendor", x: 1.15, y: 2.2, inRange: false }]));
    move(canvas);
    expect(onHover).toHaveBeenCalledWith(5);

    detach();
    canvas.remove();
  });

  it("does not find him from a stride away", () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const onHover = vi.fn();
    const { detach, onSnapshot } = attachBindings(
      canvas,
      { postMessage: vi.fn() } as unknown as Worker,
      fakeScene(),
      undefined,
      onHover,
    );

    onSnapshot(makeSnap([{ id: 5, kind: "vendor", x: 3, y: 2, inRange: false }]));
    move(canvas);
    expect(onHover).not.toHaveBeenCalledWith(5);

    detach();
    canvas.remove();
  });

  /**
   * A portal is the one interactable whose stolen click costs something: it ends
   * the map and spends one of the six. Loot is the other exclusion, for the
   * opposite reason — a column round every dropped item would eat the movement
   * clicks in the middle of a fight.
   */
  it("forgives furniture and people, never a portal or an item", () => {
    for (const kind of ["portal", "groundItem"] as const) {
      const canvas = document.createElement("canvas");
      document.body.appendChild(canvas);
      const onHover = vi.fn();
      const { detach, onSnapshot } = attachBindings(
        canvas,
        { postMessage: vi.fn() } as unknown as Worker,
        fakeScene(),
        undefined,
        onHover,
      );

      onSnapshot(makeSnap([{ id: 5, kind, x: 1, y: 2, inRange: false }]));
      move(canvas);
      expect(onHover).not.toHaveBeenCalledWith(5);

      detach();
      canvas.remove();
    }
  });

  it("pointerleave on the canvas fires callback with null", () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const onHover = vi.fn();
    const { detach } = attachBindings(
      canvas,
      { postMessage: vi.fn() } as unknown as Worker,
      fakeInteractScene(9),
      undefined,
      onHover,
    );

    move(canvas); // enter entity-9
    canvas.dispatchEvent(new MouseEvent("pointerleave", { bubbles: false }));

    expect(onHover).toHaveBeenCalledTimes(2);
    expect(onHover).toHaveBeenNthCalledWith(2, null);

    detach();
    canvas.remove();
  });
});
