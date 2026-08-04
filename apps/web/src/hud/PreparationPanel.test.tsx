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

  it("disables a completed node", () => {
    const done = atlasGraph(atlasSeed)[0]!.id;
    render(
      <PreparationPanel
        atlasSeed={atlasSeed} completedNodes={[done]} socketedStone={null}
        onEject={() => {}} onActivate={() => {}} onClose={() => {}}
      />,
    );
    expect((screen.getByTestId(`prep-node-${done}`) as HTMLButtonElement).disabled).toBe(true);
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
    expect(screen.getByTestId("prep-popup-biome").textContent).toBe("Strand");
  });
});
