// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { testPlayer } from "./test-fixtures";
import type { Snapshot } from "@exiled/protocol";

// The App effect instantiates a real Babylon Engine (WebGL) + Worker, neither of
// which exists in jsdom. Mock the WebGL/worker-touching pieces so App can mount;
// the real Babylon + Worker integration is verified manually in Task 23.
// `render/rig` and `render/level` are mocked for their imports as much as their
// behaviour: rig pulls in skirt.ts, which builds Vector3 scratch vectors at module
// scope, so leaving it real drags the whole solver through this stub.
const hoisted = vi.hoisted(() => ({
  worker: null as { onmessage: ((e: { data: unknown }) => void) | null } | null,
  openPanel: null as ((open: boolean) => void) | null,
  openStash: null as ((open: boolean) => void) | null,
  openVendor: null as ((open: boolean) => void) | null,
}));

vi.mock("@babylonjs/core", () => ({
  Engine: vi.fn(() => ({
    runRenderLoop: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
    getRenderWidth: () => 1920, getRenderHeight: () => 1080,
  })),
  Vector3: class { static Project = vi.fn(() => ({ x: 0, y: 0, z: 0.5 })); },
  Matrix: { Identity: vi.fn() },
}));
vi.mock("./render/engine", () => ({
  createScene: () => ({
    scene: { render: vi.fn(), getTransformMatrix: vi.fn() },
    camera: { viewport: { toGlobal: vi.fn() }, setTarget: vi.fn() },
    detachZoom: vi.fn(),
  }),
}));
vi.mock("./render/renderer", () => ({
  SnapshotRenderer: vi.fn(() => ({ apply: vi.fn(), cyclePlayerOutfit: vi.fn(), setHoveredEntity: vi.fn() })),
}));
vi.mock("./render/rig", () => ({ loadPlayerRig: () => Promise.resolve(), resetPlayerRig: vi.fn() }));
vi.mock("./render/props", () => ({ loadProps: () => Promise.resolve(), resetProps: vi.fn() }));
vi.mock("./render/rocks", () => ({ loadRocks: () => Promise.resolve(), resetRocks: vi.fn() }));
vi.mock("./render/level", () => ({ buildLevel: vi.fn() }));
vi.mock("./input/bindings", () => ({
  attachBindings: (
    _canvas: unknown, _worker: unknown, _scene: unknown, _cycle: unknown, _hover: unknown,
    onPanel: (open: boolean) => void,
    onStash: (open: boolean) => void,
    onVendor: (open: boolean) => void,
  ) => {
    hoisted.openPanel = onPanel;
    hoisted.openStash = onStash;
    hoisted.openVendor = onVendor;
    return { detach: () => {}, onSnapshot: () => {}, approach: () => {} };
  },
}));

import { App } from "./App";

const makeSnap = (): Snapshot => ({
  tick: 1, area: "hideout", portalsLeft: 0, mapOpen: false, areaTier: 0,
  atlasSeed: 0, completedNodes: [], waystones: [],
  player: testPlayer(),
  entities: [],
  inventory: { cols: 12, rows: 5, items: [] },
  stash: { cols: 12, rows: 12, items: [] },
  vendor: { cols: 12, rows: 12, items: [] },
  equipment: {},
  shards: {},
});

beforeAll(() => {
  vi.stubGlobal(
    "Worker",
    vi.fn(() => {
      const w = {
        postMessage: vi.fn(), onmessage: null, terminate: vi.fn(),
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
      };
      hoisted.worker = w;
      return w;
    }),
  );
});

/** Mount App and push one snapshot in, which is what gates every panel's render. */
function mountWithSnapshot() {
  const utils = render(<App />);
  act(() => { hoisted.worker?.onmessage?.({ data: { type: "snapshot", snapshot: makeSnap() } }); });
  return utils;
}

// Every case here mounts its own App, and App's keydown listener is on `window`:
// a mount left standing answers the next test's key presses too.
afterEach(cleanup);

describe("App", () => {
  it("renders a canvas element", () => {
    const { container } = render(<App />);
    expect(container.querySelector("canvas")).not.toBeNull();
  });

  it("Escape closes every open overlay at once", () => {
    mountWithSnapshot();
    act(() => {
      fireEvent.keyDown(window, { key: "i" });
      hoisted.openStash?.(true);
      hoisted.openPanel?.(true);
    });
    expect(screen.getByTestId("inventory-panel")).toBeTruthy();
    expect(screen.getByTestId("stash-panel")).toBeTruthy();
    expect(screen.getByTestId("prep-panel")).toBeTruthy();

    act(() => { fireEvent.keyDown(window, { key: "Escape" }); });

    expect(screen.queryByTestId("inventory-panel")).toBeNull();
    expect(screen.queryByTestId("stash-panel")).toBeNull();
    expect(screen.queryByTestId("prep-panel")).toBeNull();
  });

  it("Escape closes the character sheet and the vendor too", () => {
    mountWithSnapshot();
    act(() => { hoisted.openVendor?.(true); });
    expect(screen.getByTestId("vendor-panel")).toBeTruthy();
    act(() => { fireEvent.keyDown(window, { key: "Escape" }); });
    expect(screen.queryByTestId("vendor-panel")).toBeNull();
    expect(screen.queryByTestId("inventory-panel")).toBeNull();

    act(() => { fireEvent.keyDown(window, { key: "c" }); });
    expect(screen.getByTestId("character-panel")).toBeTruthy();
    act(() => { fireEvent.keyDown(window, { key: "Escape" }); });
    expect(screen.queryByTestId("character-panel")).toBeNull();
  });

  // The sheet is cut from the stash's pane and docks in the same place, so two of
  // them up at once is one pane hidden exactly behind the other.
  it("the left dock holds one of stash, vendor and character sheet", () => {
    mountWithSnapshot();
    act(() => { fireEvent.keyDown(window, { key: "c" }); });
    expect(screen.getByTestId("character-panel")).toBeTruthy();

    act(() => { hoisted.openStash?.(true); });
    expect(screen.getByTestId("stash-panel")).toBeTruthy();
    expect(screen.queryByTestId("character-panel")).toBeNull();

    act(() => { fireEvent.keyDown(window, { key: "c" }); });
    expect(screen.getByTestId("character-panel")).toBeTruthy();
    expect(screen.queryByTestId("stash-panel")).toBeNull();
  });
});
