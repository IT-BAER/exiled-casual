// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { offerWaystones, areaLevel, atlasGraph, WAYSTONE_OFFER_COUNT, waystoneRarity, waystoneMods } from "@exiled/rules";
import { PreparationPanel } from "./PreparationPanel.js";

/** The three stones a fresh character owns, exactly as combat-sim seeds them. */
function ownedFor(seed: number) {
  return offerWaystones(seed, WAYSTONE_OFFER_COUNT).map((w, i) => ({ id: `ws-${i}`, seed: w.seed, tier: w.tier }));
}

describe("PreparationPanel", () => {
  const atlasSeed = 42;

  afterEach(cleanup);

  it("activates with the selected node and waystone, and shows its area level", () => {
    const onActivate = vi.fn();
    render(
      <PreparationPanel atlasSeed={atlasSeed} waystones={ownedFor(atlasSeed)} completedNodes={[]} onActivate={onActivate} onClose={() => {}} />,
    );
    const node = atlasGraph(atlasSeed)[0]!;
    const ws = offerWaystones(atlasSeed, WAYSTONE_OFFER_COUNT)[0]!;

    fireEvent.click(screen.getByTestId(`prep-node-${node.id}`));
    fireEvent.click(screen.getByTestId(`prep-ws-${ws.id}`));

    expect(screen.getByTestId("prep-arealevel").textContent).toContain(String(areaLevel(ws.tier)));

    fireEvent.click(screen.getByTestId("prep-activate"));
    expect(onActivate).toHaveBeenCalledWith(node.id, ws.id);
  });

  it("disables activate until both a node and a waystone are chosen", () => {
    render(
      <PreparationPanel atlasSeed={atlasSeed} waystones={ownedFor(atlasSeed)} completedNodes={[]} onActivate={() => {}} onClose={() => {}} />,
    );
    expect((screen.getByTestId("prep-activate") as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables a completed node", () => {
    const done = atlasGraph(atlasSeed)[0]!.id;
    render(
      <PreparationPanel atlasSeed={atlasSeed} waystones={ownedFor(atlasSeed)} completedNodes={[done]} onActivate={() => {}} onClose={() => {}} />,
    );
    expect((screen.getByTestId(`prep-node-${done}`) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the fog: only the first node is enterable on a fresh atlas", () => {
    const graph = atlasGraph(atlasSeed);
    render(
      <PreparationPanel atlasSeed={atlasSeed} waystones={ownedFor(atlasSeed)} completedNodes={[]} onActivate={() => {}} onClose={() => {}} />,
    );
    const shut = graph.find((n) => n.id !== graph[0]!.id && !graph[0]!.links.includes(n.id))!;
    expect((screen.getByTestId(`prep-node-${graph[0]!.id}`) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId(`prep-node-${shut.id}`) as HTMLButtonElement).disabled).toBe(true);
  });

  it("draws the world map: a node sits at its own position and its routes are drawn", () => {
    const graph = atlasGraph(atlasSeed);
    render(
      <PreparationPanel atlasSeed={atlasSeed} waystones={ownedFor(atlasSeed)} completedNodes={[]} onActivate={() => {}} onClose={() => {}} />,
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
        atlasSeed={atlasSeed} waystones={ownedFor(atlasSeed)}
        completedNodes={[graph[0]!.id]}
        onActivate={() => {}}
        onClose={() => {}}
      />,
    );
    const neighbour = graph[0]!.links[0]!;
    expect((screen.getByTestId(`prep-node-${neighbour}`) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("a Waystone shows what it will do to the run", () => {
  afterEach(cleanup);

  // The offers come from the atlas seed, so a seed is picked whose first stone
  // rolls modifiers — the panel's whole job is to make that legible before entry.
  function seedWhoseFirstStoneIs(rarity: string): number {
    for (let s = 1; s < 100_000; s++) {
      const ws = offerWaystones(s, WAYSTONE_OFFER_COUNT)[0]!;
      if (waystoneRarity(ws.seed) === rarity) return s;
    }
    throw new Error(`no atlas seed offers a ${rarity} first`);
  }

  it("names its rarity and prints every modifier it rolled", () => {
    const atlasSeed = seedWhoseFirstStoneIs("rare");
    const ws = offerWaystones(atlasSeed, WAYSTONE_OFFER_COUNT)[0]!;
    render(<PreparationPanel atlasSeed={atlasSeed} waystones={ownedFor(atlasSeed)} completedNodes={[]} onClose={() => {}} onActivate={() => {}} />);

    expect(screen.getByTestId(`prep-ws-${ws.id}-rarity`).textContent).toBe("Rare Waystone");
    const mods = waystoneMods(ws.seed);
    expect(mods.length).toBe(4);
    for (const m of mods) {
      expect(screen.getByTestId(`prep-ws-${ws.id}-mod-${m.id}`).textContent).toBe(m.label);
    }
  });

  it("says so plainly when a stone has nothing on it", () => {
    const atlasSeed = seedWhoseFirstStoneIs("normal");
    const ws = offerWaystones(atlasSeed, WAYSTONE_OFFER_COUNT)[0]!;
    render(<PreparationPanel atlasSeed={atlasSeed} waystones={ownedFor(atlasSeed)} completedNodes={[]} onClose={() => {}} onActivate={() => {}} />);
    expect(screen.getByTestId(`prep-ws-${ws.id}-rarity`).textContent).toBe("Waystone");
    expect(screen.getByTestId(`prep-ws-${ws.id}`).textContent).toContain("No modifiers");
  });
});
