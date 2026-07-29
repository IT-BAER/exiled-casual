// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { testPlayer } from "./test-fixtures";
import { DEFAULT_SETTINGS } from "./settings";
import type { Snapshot } from "@exiled/protocol";

// The GameView effect instantiates a real Babylon Engine (WebGL) + Worker, neither of
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
  /** The render loop's callback, so a test can drive exactly one frame. */
  frame: null as (() => void) | null,
  /** The scene's pending executeWhenReady callback, held rather than run. */
  ready: null as (() => void) | null,
}));

vi.mock("@babylonjs/core", () => ({
  Engine: vi.fn(() => ({
    // Captured rather than dropped: the loading plate comes down on a PAINTED
    // frame, so a suite that never runs one would sit under the plate forever.
    runRenderLoop: (fn: () => void) => { hoisted.frame = fn; },
    resize: vi.fn(), dispose: vi.fn(),
    getRenderWidth: () => 1920, getRenderHeight: () => 1080,
  })),
  Vector3: class { static Project = vi.fn(() => ({ x: 0, y: 0, z: 0.5 })); },
  Matrix: { Identity: vi.fn() },
}));
vi.mock("./render/engine", () => ({
  createScene: () => ({
    scene: {
      render: vi.fn(),
      getTransformMatrix: vi.fn(),
      // Held, not called: real Babylon defers this behind a timeout and only
      // fires it once the new area's materials and textures are in. Running it
      // straight through would make "armed before the build" and "armed after
      // it" indistinguishable, which is the one thing worth pinning here.
      executeWhenReady: (fn: () => void) => { hoisted.ready = fn; },
    },
    camera: { viewport: { toGlobal: vi.fn() }, setTarget: vi.fn() },
    detachZoom: vi.fn(),
  }),
  applyGraphics: vi.fn(),
}));
vi.mock("./render/renderer", () => ({
  SnapshotRenderer: vi.fn(() => ({ apply: vi.fn(), cyclePlayerOutfit: vi.fn(), setHoveredEntity: vi.fn() })),
}));
vi.mock("./render/rig", () => ({ loadPlayerRig: () => Promise.resolve(), resetPlayerRig: vi.fn() }));
vi.mock("./render/props", () => ({ loadProps: () => Promise.resolve(), resetProps: vi.fn() }));
vi.mock("./render/rocks", () => ({ loadRocks: () => Promise.resolve(), resetRocks: vi.fn() }));
vi.mock("./render/level", () => ({
  buildLevel: vi.fn(), applyTilesetFloor: vi.fn(), applyBiomeTint: vi.fn(),
}));
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

import { GameView } from "./GameView";

const makeSnap = (): Snapshot => ({
  tick: 1, area: "hideout", portalsLeft: 0, mapOpen: false, areaTier: 0,
  atlasSeed: 0, completedNodes: [],
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

/** Mount GameView and push one snapshot in, which is what gates every panel's render. */
function mountWithSnapshot(props: Partial<React.ComponentProps<typeof GameView>> = {}) {
  const utils = render(<GameView {...props} />);
  act(() => {
    hoisted.worker?.onmessage?.({
      data: { type: "snapshot", snapshot: { ...makeSnap(), entities: [DROP] } },
    });
  });
  return utils;
}

/** One drop on the ground, which is what makes a loot plate exist to hide. */
const DROP = { id: 7, kind: "groundItem" as const, x: 1, y: 1, rarity: "normal" as const };

// Every case here mounts its own GameView, and its keydown listener is on `window`:
// a mount left standing answers the next test's key presses too.
afterEach(cleanup);

describe("GameView", () => {
  it("renders a canvas element", () => {
    const { container } = render(<GameView />);
    expect(container.querySelector("canvas")).not.toBeNull();
  });

  it("draws the loot plates by default and not when the UI tab turns them off", () => {
    mountWithSnapshot();
    expect(screen.getByTestId(`loot-label-${DROP.id}`)).toBeTruthy();
    cleanup();

    mountWithSnapshot({
      settings: { ...DEFAULT_SETTINGS, ui: { ...DEFAULT_SETTINGS.ui, lootLabels: false } },
    });
    expect(screen.queryByTestId(`loot-label-${DROP.id}`)).toBeNull();
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

  // --- the loading plate ---

  /**
   * Mount and let the asset promises settle. `runRenderLoop` is registered inside
   * `Promise.all(...).then`, so before that flush there is no frame to drive and
   * the plate could never come down.
   */
  async function mountGame() {
    render(<GameView />);
    await act(async () => { await Promise.resolve(); });
    // A frame cannot be painted without a snapshot to paint — `renderFrame`
    // returns early until one lands — so the plate legitimately stays up until
    // the sim has spoken. The worker sends its area first and then these.
    act(() => {
      hoisted.worker?.onmessage?.({ data: { type: "snapshot", snapshot: makeSnap() } });
    });
  }

  /** Hand the client an area, the way the worker does when a place is built. */
  function sendArea(mapBaseId: string) {
    act(() => {
      hoisted.worker?.onmessage?.({
        data: {
          type: "area",
          area: mapBaseId ? "map" : "hideout",
          layout: { grid: { w: 1, h: 1, cells: [0] } },
          mapBaseId,
        },
      });
    });
  }

  /** The scene reports its new area's materials and textures in. */
  function becomeReady() {
    act(() => { hoisted.ready?.(); });
  }

  /** One turn of the render loop, which is the only thing that lowers the plate. */
  function paintFrame() {
    act(() => { hoisted.frame?.(); });
  }

  it("covers the screen from mount and stays up until a frame is actually painted", async () => {
    await mountGame();
    // Up before anything: the canvas at this point is a black rectangle.
    expect(screen.getByTestId("loading-screen")).toBeTruthy();

    sendArea("map.swamp");
    expect(screen.getByTestId("loading-area-name").textContent).toBe("Swamp");

    // A built area is not a drawn one. Both of these must land, in this order,
    // before the player is shown anything.
    becomeReady();
    expect(screen.getByTestId("loading-screen")).toBeTruthy();
    paintFrame();
    expect(screen.queryByTestId("loading-screen")).toBeNull();
  });

  it("does not lower the plate on a frame painted before the scene was ready", async () => {
    // The bug this pins is the ordering: disarm, build, THEN arm on ready. Arm
    // first and a frame that was already in flight lowers the plate onto an area
    // whose textures have not landed, which is the pop the plate exists to hide.
    await mountGame();
    sendArea("map.forest");
    paintFrame();
    expect(screen.getByTestId("loading-screen")).toBeTruthy();

    becomeReady();
    paintFrame();
    expect(screen.queryByTestId("loading-screen")).toBeNull();
  });

  it("comes back for the next area and names where the player is going", async () => {
    await mountGame();
    sendArea("map.desert");
    becomeReady();
    paintFrame();
    expect(screen.queryByTestId("loading-screen")).toBeNull();

    // Back to the hideout: no map base, so it falls back to the one area that is
    // not a biome, and the plate is up again for the whole of that transition.
    sendArea("");
    expect(screen.getByTestId("loading-screen")).toBeTruthy();
    expect(screen.getByTestId("loading-area-name").textContent).toBe("Hideout");
    becomeReady();
    paintFrame();
    expect(screen.queryByTestId("loading-screen")).toBeNull();
  });
});
