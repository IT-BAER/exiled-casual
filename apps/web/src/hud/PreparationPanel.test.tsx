// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { areaLevel, atlasGraph, atlasNodeTier } from "@exiled/rules";
import { PreparationPanel } from "./PreparationPanel.js";
import type { SocketedStone } from "./PreparationPanel.js";

/** A tier-1 stone at grid cell (0,0) — the minimum needed to enter node 0. */
function stone(overrides?: Partial<SocketedStone>): SocketedStone {
  return { seed: 42, tier: 1, x: 0, y: 0, ...overrides };
}

describe("PreparationPanel", () => {
  const atlasSeed = 42;

  afterEach(cleanup);

  it("activates with the selected node and waystone, and shows its area level", () => {
    const onActivate = vi.fn();
    const s = stone();
    render(
      <PreparationPanel
        atlasSeed={atlasSeed} completedNodes={[]} socketedStone={s}
        onEject={() => {}} onActivate={onActivate} onClose={() => {}}
      />,
    );
    const node = atlasGraph(atlasSeed)[0]!;

    fireEvent.click(screen.getByTestId(`prep-node-${node.id}`));

    expect(screen.getByTestId("prep-arealevel").textContent).toContain(String(areaLevel(s.tier)));

    fireEvent.click(screen.getByTestId("prep-activate"));
    expect(onActivate).toHaveBeenCalledWith(node.id, s.x, s.y);
  });

  it("seats a stone in a page the browser has translated", () => {
    // Safari and Chrome translation swap each text node for a <font> holding the
    // translation. React still points at the old node, so inserting a sibling
    // before it threw NotFoundError at the socket (Safari 27, 0.6.0 telemetry).
    const panel = (s: SocketedStone | null) => (
      <PreparationPanel atlasSeed={atlasSeed} completedNodes={[]} socketedStone={s}
        onEject={() => {}} onActivate={() => {}} onClose={() => {}} />
    );
    const { rerender, container } = render(panel(null));
    fireEvent.click(screen.getByTestId(`prep-node-${atlasGraph(atlasSeed)[0]!.id}`));
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode as Text);
    for (const t of texts) {
      const font = document.createElement("font");
      font.textContent = t.data;
      t.replaceWith(font);
    }
    expect(() => rerender(panel(stone({ tier: 1 })))).not.toThrow();
    expect(screen.getByTestId("prep-arealevel").textContent).toContain("Tier 1");
  });

  it("opens below a node when the screen has no room for the panel above it", () => {
    // 2048x962: the node field is 396 px tall from y 96, and the panel is 386 px.
    const nodes = atlasGraph(atlasSeed);
    const node = nodes.find((n) => n.y >= 0.42 && n.y <= 0.7)!;
    const rect = (top: number, height: number) => ({ top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) });
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === "prep-popup" ? rect(0, 386) : rect(96, 396);
    });
    vi.stubGlobal("innerHeight", 962);
    try {
      render(
        <PreparationPanel
          atlasSeed={atlasSeed} completedNodes={nodes.map((n) => n.id)} socketedStone={null}
          onEject={() => {}} onActivate={() => {}} onClose={() => {}}
        />,
      );
      fireEvent.click(screen.getByTestId(`prep-node-${node.id}`));
      const popup = screen.getByTestId("prep-popup");
      expect(popup.style.top).not.toBe("");
      expect(popup.style.bottom).toBe("");
    } finally {
      spy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("says nothing about a place until one is clicked", () => {
    render(
      <PreparationPanel
        atlasSeed={atlasSeed} completedNodes={[]} socketedStone={null}
        onEject={() => {}} onActivate={() => {}} onClose={() => {}}
      />,
    );
    // The Atlas is the world first: no place is open, so there is no panel and
    // nothing to activate.
    expect(screen.queryByTestId("prep-popup")).toBeNull();
    expect(screen.queryByTestId("prep-activate")).toBeNull();
  });

  it("opens the place over its own node, with its name, its lore and an empty socket", () => {
    render(
      <PreparationPanel
        atlasSeed={atlasSeed} completedNodes={[]} socketedStone={null}
        onEject={() => {}} onActivate={() => {}} onClose={() => {}}
      />,
    );
    const node = atlasGraph(atlasSeed)[0]!;
    fireEvent.click(screen.getByTestId(`prep-node-${node.id}`));

    const popup = screen.getByTestId("prep-popup");
    expect(screen.getByTestId("prep-popup-name").textContent).toBe(node.name);
    expect(popup.textContent).toContain(node.flavour);
    // Anchored to the node it belongs to, not to the middle of the screen.
    expect(popup.style.left).toContain(`${parseFloat(Math.min(88, Math.max(12, node.x * 100)).toFixed(2))}%`);
    // Empty until a stone goes in, and the button says no while it is.
    expect(screen.queryByTestId("prep-socket-stone")).toBeNull();
    expect((screen.getByTestId("prep-activate") as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the place's panel under the inventory, which docks over the map as in PoE", () => {
    // The panel's z-index competes in the HUD's layer, beside the inventory's 2: at 3
    // it covered the backpack's first column, and a stone there could not be dragged.
    render(
      <PreparationPanel
        atlasSeed={atlasSeed} completedNodes={[]} socketedStone={null}
        onEject={() => {}} onActivate={() => {}} onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId(`prep-node-${atlasGraph(atlasSeed)[0]!.id}`));
    const z = Number(screen.getByTestId("prep-popup").style.zIndex);
    expect(z).toBeGreaterThanOrEqual(1);
    expect(z).toBeLessThan(2);
  });

  it("moves a place's panel clear of a panel docked on the right, so its socket stays reachable", () => {
    // 1366x768: the inventory docks at x 982 and a right-side node's panel ran to 1135.
    const box = (x: number, y: number, w: number, h: number) =>
      ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect;
    const nudgeOf = (el: HTMLElement) => Number(/- ([\d.]+)px/.exec(el.style.left)?.[1] ?? 0);
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.dataset.hudPanel !== undefined) return box(982, 0, 384, 768);
      if (this.dataset.testid === "prep-popup") return box(875 - nudgeOf(this), 200, 260, 300);
      return box(0, 0, 1366, 768);
    });
    render(
      <>
        <PreparationPanel
          atlasSeed={atlasSeed} completedNodes={[]} socketedStone={null}
          onEject={() => {}} onActivate={() => {}} onClose={() => {}}
        />
        <div data-hud-panel="" />
      </>,
    );
    fireEvent.click(screen.getByTestId(`prep-node-${atlasGraph(atlasSeed)[0]!.id}`));
    const popup = screen.getByTestId("prep-popup");
    expect(875 - nudgeOf(popup) + 260).toBeLessThanOrEqual(982);
    // Not further than it has to: still beside its node, not thrown across the map.
    expect(nudgeOf(popup)).toBeLessThan(200);
    rect.mockRestore();
  });

  it("shows the stone in the socket; clicking the socket ejects it", () => {
    const onEject = vi.fn();
    const s = stone();
    render(
      <PreparationPanel
        atlasSeed={atlasSeed} completedNodes={[]} socketedStone={s}
        onEject={onEject} onActivate={() => {}} onClose={() => {}}
      />,
    );
    const node = atlasGraph(atlasSeed)[0]!;
    fireEvent.click(screen.getByTestId(`prep-node-${node.id}`));
    // The stone shows as its own item art in the slot; the tier it brings reads
    // off the line under it, with the numbers.
    expect(screen.getByTestId("prep-socket-stone")).toBeTruthy();
    expect(screen.getByTestId("prep-arealevel").textContent).toContain(`Tier ${s.tier}`);

    fireEvent.click(screen.getByTestId("prep-socket"));
    expect(onEject).toHaveBeenCalledTimes(1);
  });

  it("closes the place when its node is clicked again", () => {
    render(
      <PreparationPanel
        atlasSeed={atlasSeed} completedNodes={[]} socketedStone={null}
        onEject={() => {}} onActivate={() => {}} onClose={() => {}}
      />,
    );
    const node = atlasGraph(atlasSeed)[0]!;
    fireEvent.click(screen.getByTestId(`prep-node-${node.id}`));
    fireEvent.click(screen.getByTestId(`prep-node-${node.id}`));
    expect(screen.queryByTestId("prep-popup")).toBeNull();
  });

  it("a completed node stays clickable: cleared marks it, it does not lock it", () => {
    const done = atlasGraph(atlasSeed)[0]!.id;
    render(
      <PreparationPanel
        atlasSeed={atlasSeed} completedNodes={[done]} socketedStone={null}
        onEject={() => {}} onActivate={() => {}} onClose={() => {}}
      />,
    );
    expect((screen.getByTestId(`prep-node-${done}`) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the fog: only the first node is enterable on a fresh atlas", () => {
    const graph = atlasGraph(atlasSeed);
    render(
      <PreparationPanel
        atlasSeed={atlasSeed} completedNodes={[]} socketedStone={null}
        onEject={() => {}} onActivate={() => {}} onClose={() => {}}
      />,
    );
    const shut = graph.find((n) => n.id !== graph[0]!.id && !graph[0]!.links.includes(n.id))!;
    expect((screen.getByTestId(`prep-node-${graph[0]!.id}`) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId(`prep-node-${shut.id}`) as HTMLButtonElement).disabled).toBe(true);
  });

  it("draws the world map: a node sits at its own position and its routes are drawn", () => {
    const graph = atlasGraph(atlasSeed);
    render(
      <PreparationPanel
        atlasSeed={atlasSeed} completedNodes={[]} socketedStone={null}
        onEject={() => {}} onActivate={() => {}} onClose={() => {}}
      />,
    );
    const first = graph[0]!;
    const tile = screen.getByTestId(`prep-node-${first.id}`);
    // Left/top are a percentage of the map field, so a node's place on the world
    // map is its graph position and not a slot in a list.
    expect(tile.style.left).toBe(`${(first.x * 100).toFixed(2)}%`);
    expect(tile.style.top).toBe(`${(first.y * 100).toFixed(2)}%`);
    for (const other of first.links) {
      expect(screen.getByTestId(`prep-route-${[first.id, other].sort().join("-")}`)).toBeTruthy();
    }
  });

  it("opens the neighbours of a cleared node", () => {
    const graph = atlasGraph(atlasSeed);
    render(
      <PreparationPanel
        atlasSeed={atlasSeed}
        completedNodes={[graph[0]!.id]}
        socketedStone={null}
        onEject={() => {}}
        onActivate={() => {}}
        onClose={() => {}}
      />,
    );
    const neighbour = graph[0]!.links[0]!;
    expect((screen.getByTestId(`prep-node-${neighbour}`) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("a place demands a Waystone of its own tier", () => {
  afterEach(cleanup);
  const atlasSeed = 42;
  const graph = atlasGraph(atlasSeed);

  it("stamps the tier it wants on the medallion", () => {
    render(
      <PreparationPanel
        atlasSeed={atlasSeed} completedNodes={[]} socketedStone={null}
        onEject={() => {}} onActivate={() => {}} onClose={() => {}}
      />,
    );
    expect(screen.getByTestId(`prep-node-${graph[0]!.id}-tier`).textContent).toBe("1");
    const neighbour = graph[0]!.links[0]!;
    expect(screen.getByTestId(`prep-node-${neighbour}-tier`).textContent).toBe(String(atlasNodeTier(graph, neighbour)));
  });

  it("refuses to activate when the stone is under the place's tier, and says which tier it wants", () => {
    const neighbour = graph[0]!.links[0]!;
    const need = atlasNodeTier(graph, neighbour);
    // Open the popup with no stone (node is "open"), then seat an under-tier stone.
    const { rerender } = render(
      <PreparationPanel
        atlasSeed={atlasSeed} completedNodes={[graph[0]!.id]}
        socketedStone={null}
        onEject={() => {}} onActivate={() => {}} onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId(`prep-node-${neighbour}`));
    // Re-render with an under-tier stone: the popup stays open (nodeId is internal state).
    rerender(
      <PreparationPanel
        atlasSeed={atlasSeed} completedNodes={[graph[0]!.id]}
        socketedStone={stone({ tier: need - 1 })}
        onEject={() => {}} onActivate={() => {}} onClose={() => {}}
      />,
    );

    expect((screen.getByTestId("prep-activate") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("prep-undertier").textContent).toContain(String(need));
  });

  it("a place the seated stone is too weak for still opens, so the stone can be taken out there", () => {
    const neighbour = graph[0]!.links[0]!;
    const need = atlasNodeTier(graph, neighbour);
    const onEject = vi.fn();
    render(
      <PreparationPanel
        atlasSeed={atlasSeed} completedNodes={[graph[0]!.id]}
        socketedStone={stone({ tier: need - 1 })}
        onEject={onEject} onActivate={() => {}} onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId(`prep-node-${neighbour}`));
    expect(screen.getByTestId("prep-undertier").textContent).toContain(String(need));
    fireEvent.click(screen.getByTestId("prep-socket"));
    expect(onEject).toHaveBeenCalledOnce();
  });

  it("activates once the stone is good enough", () => {
    const neighbour = graph[0]!.links[0]!;
    const need = atlasNodeTier(graph, neighbour);
    const goodStone = stone({ tier: need, x: 3, y: 5 });
    const onActivate = vi.fn();
    render(
      <PreparationPanel
        atlasSeed={atlasSeed} completedNodes={[graph[0]!.id]}
        socketedStone={goodStone}
        onEject={() => {}} onActivate={onActivate} onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId(`prep-node-${neighbour}`));
    fireEvent.click(screen.getByTestId("prep-activate"));
    expect(onActivate).toHaveBeenCalledWith(neighbour, goodStone.x, goodStone.y);
  });
});

describe("the atlas pans by drag, as PoE's does", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  const atlasSeed = 42;
  // jsdom has no PointerEvent: fireEvent.pointerDown would drop the coordinates.
  const pointer = (el: Element | Window, type: string, x: number, y: number) =>
    fireEvent(el, new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }));
  const panel = () => render(
    <PreparationPanel atlasSeed={atlasSeed} completedNodes={[]} socketedStone={null}
      onEject={() => {}} onActivate={() => {}} onClose={() => {}} />,
  );
  /** A 1366x768 screen, the size the inventory hid a third of the atlas on. */
  const screen1366 = () => vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    { x: 0, y: 0, left: 0, top: 0, width: 1366, height: 768, right: 1366, bottom: 768, toJSON: () => ({}) } as DOMRect,
  );
  const offset = () => screen.getByTestId("prep-map").style.transform;

  it("moves the map with a drag over empty ground", () => {
    screen1366();
    panel();
    const map = screen.getByTestId("prep-map");
    pointer(map, "pointerdown", 900, 400);
    pointer(window, "pointermove", 700, 380);
    pointer(window, "pointerup", 700, 380);
    expect(offset()).toBe("translate(-200px, -20px)");
  });

  it("a drag that starts on a place moves the map and does not open the place", () => {
    screen1366();
    panel();
    const node = screen.getByTestId(`prep-node-${atlasGraph(atlasSeed)[0]!.id}`);
    pointer(node, "pointerdown", 500, 300);
    pointer(window, "pointermove", 440, 300);
    pointer(node, "pointerup", 440, 300);
    fireEvent.click(node);
    expect(offset()).toBe("translate(-60px, 0px)");
    expect(screen.queryByTestId("prep-popup")).toBeNull();
  });

  it("a press that wobbles a pixel or two is still a click: the place opens and the map stays put", () => {
    screen1366();
    panel();
    const node = screen.getByTestId(`prep-node-${atlasGraph(atlasSeed)[0]!.id}`);
    pointer(node, "pointerdown", 500, 300);
    pointer(window, "pointermove", 502, 301);
    pointer(node, "pointerup", 502, 301);
    fireEvent.click(node);
    expect(offset()).toBe("translate(0px, 0px)");
    expect(screen.getByTestId("prep-popup")).toBeTruthy();
  });

  it("stops at half a screen each way, so the world can never be dragged off it", () => {
    screen1366();
    panel();
    const map = screen.getByTestId("prep-map");
    pointer(map, "pointerdown", 900, 400);
    pointer(window, "pointermove", -1500, 2400);
    pointer(window, "pointerup", -1500, 2400);
    expect(offset()).toBe("translate(-683px, 384px)");
    // A second drag starts from where the first stopped, and is held at the same edge.
    pointer(map, "pointerdown", 100, 100);
    pointer(window, "pointermove", 3000, -3000);
    pointer(window, "pointerup", 3000, -3000);
    expect(offset()).toBe("translate(683px, -384px)");
  });

  it("a press on the open place's panel is not a drag: the socket keeps its clicks", () => {
    screen1366();
    const onEject = vi.fn();
    render(
      <PreparationPanel atlasSeed={atlasSeed} completedNodes={[]} socketedStone={stone()}
        onEject={onEject} onActivate={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByTestId(`prep-node-${atlasGraph(atlasSeed)[0]!.id}`));
    const socket = screen.getByTestId("prep-socket");
    pointer(socket, "pointerdown", 600, 300);
    pointer(window, "pointermove", 640, 300);
    pointer(socket, "pointerup", 640, 300);
    fireEvent.click(socket);
    expect(offset()).toBe("translate(0px, 0px)");
    expect(onEject).toHaveBeenCalledOnce();
  });
});

describe("the place's biome", () => {
  it("names what the node is made of, under its name", () => {
    render(
      <PreparationPanel
        atlasSeed={7}
        completedNodes={[]}
        socketedStone={null}
        onEject={() => {}}
        onActivate={() => {}}
        onClose={() => {}}
      />,
    );
    // The Wrackline is node 0, and node 0 is always reachable, so its popup opens.
    fireEvent.click(screen.getByTestId(`prep-node-${atlasGraph(7)[0]!.id}`));
    expect(screen.getByTestId("prep-popup-name").textContent).toBe("The Wrackline");
    expect(screen.getByTestId("prep-popup-biome").textContent).toBe("Coast");
  });
});
