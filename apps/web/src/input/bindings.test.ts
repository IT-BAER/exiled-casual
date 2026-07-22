// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { attachBindings } from "./bindings";
import type { Scene } from "@babylonjs/core";
import type { Snapshot } from "@pact/protocol";

// Minimal fake scene: every pick hits the ground at a fixed world point.
function fakeScene(): Scene {
  return { pick: () => ({ hit: true, pickedPoint: { x: 1, z: 2 }, pickedMesh: null }) } as unknown as Scene;
}

// Fake scene where every pick hits a portal child mesh (entity-42).
function fakeInteractScene(entityId = 42): Scene {
  // The root carries interactKind; the child (what the pick returns) does not.
  const root = { name: `entity-${entityId}`, metadata: { interactKind: "portal" }, parent: null };
  const childMesh = { name: `entity-${entityId}-pi`, metadata: null, parent: root };
  return {
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
    player: { id: 0, x: 0, y: 0, life: 100, maxLife: 100, mana: 60, maxMana: 60, cooldowns: {}, alive: true, casting: false },
    entities: entityOverrides as Snapshot["entities"],
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
    ({ detach } = attachBindings(canvas, worker as unknown as Worker, fakeScene()));
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

  it("numpad keys post spawn messages", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "2", code: "Numpad2", bubbles: true }));
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "spawn", what: "pack" });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "0", code: "Numpad0", bubbles: true }));
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "spawn", what: "clear" });
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

// Scene where every pick hits a mapDevice child mesh (root carries interactKind).
function fakeMapDeviceScene(entityId = 7): Scene {
  const root = { name: `entity-${entityId}`, metadata: { interactKind: "mapDevice" }, parent: null };
  const childMesh = { name: `entity-${entityId}-pi`, metadata: null, parent: root };
  return {
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
